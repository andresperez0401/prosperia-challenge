import { prisma } from "../db/client.js";
import { getOcrProvider } from "./ocr/index.js";
import { getAiProvider } from "./ai/index.js";
import { parseReceipt } from "./parsing/parseReceipt.js";
import {
  extractAllTotalCandidates,
  extractAllSubtotalCandidates,
  extractAllTaxCandidates,
  extractRawLabeledFields,
  extractVendorCandidates,
  extractCustomerCandidates,
  extractClassifiedIdentifications,
} from "./parsing/parser.js";
import { categorize } from "./parsing/categorizer.js";
import { detectCurrency } from "./parsing/detect.currency.js";
import { pdfToImages } from "./pdf/pdfHandler.js";
import { reconstructLayout } from "./ocr/reconstructLayout.js";
import { computeFields } from "./parsing/computeFields.js";
import { logger } from "../config/logger.js";
import { ParsedReceipt } from "../types/receipt.js";
import { HttpError } from "../utils/errors.js";
import { deleteReceiptFromCloudinary, uploadReceiptToCloudinary } from "./storage/cloudinaryStorage.service.js";
import { saveReceiptLocally } from "./storage/localReceiptStorage.service.js";
import { withDownloadedReceiptFile, withTempReceiptFile } from "./storage/tempReceiptFile.service.js";

// In-memory cache for accounts list — invalidated every 60s.
// Accounts rarely change at runtime; avoids hitting the DB on every receipt.
const ACCOUNTS_TTL_MS = 60_000;
let accountsCache: { data: { id: number; name: string; type: string }[]; expiresAt: number } | null = null;

async function getAccounts() {
  const now = Date.now();
  if (accountsCache && accountsCache.expiresAt > now) return accountsCache.data;
  const data = await prisma.account
    .findMany({ select: { id: true, name: true, type: true } })
    .catch(() => [] as { id: number; name: string; type: string }[]);
  accountsCache = { data, expiresAt: now + ACCOUNTS_TTL_MS };
  return data;
}

export async function listReceiptsService(limit = 100) {
  return prisma.receipt.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getReceiptByIdService(id: string) {
  const r = await prisma.receipt.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Not found");
  return r;
}

export async function reparseReceiptService(id: string) {
  const r = await getReceiptByIdService(id);
  const storage = {
    storagePath: r.storagePath,
    fileUrl: r.fileUrl,
    cloudinaryPublicId: r.cloudinaryPublicId,
    cloudinaryResourceType: r.cloudinaryResourceType,
  };

  if (/^https?:\/\//i.test(r.storagePath)) {
    return withDownloadedReceiptFile(r.storagePath, {
      originalName: r.originalName,
      mimeType: r.mimeType,
    }, (filePath) => processReceipt(filePath, {
      originalName: r.originalName,
      mimeType: r.mimeType,
      size: r.size,
    }, storage));
  }

  return processReceipt(r.storagePath, {
    originalName: r.originalName,
    mimeType: r.mimeType,
    size: r.size,
  }, storage);
}

export async function processUploadedReceipt(
  buffer: Buffer,
  meta: { originalName: string; mimeType: string; size: number },
) {
  let cloudinaryFile: Awaited<ReturnType<typeof uploadReceiptToCloudinary>>;

  try {
    cloudinaryFile = await uploadReceiptToCloudinary({
      buffer,
      originalName: meta.originalName,
      mimeType: meta.mimeType,
    });
  } catch (err) {
    const localFile = await saveReceiptLocally({
      buffer,
      originalName: meta.originalName,
      mimeType: meta.mimeType,
    });
    logger.warn({
      msg: "Cloudinary upload failed; using local receipt storage",
      error: err instanceof Error ? err.message : err,
      storagePath: localFile.storagePath,
    });

    return processReceipt(localFile.storagePath, meta, {
      storagePath: localFile.storagePath,
      fileUrl: null,
      cloudinaryPublicId: null,
      cloudinaryResourceType: null,
    });
  }

  try {
    return await withTempReceiptFile(buffer, meta, (filePath) =>
      processReceipt(filePath, meta, {
        storagePath: cloudinaryFile.publicUrl,
        fileUrl: cloudinaryFile.publicUrl,
        cloudinaryPublicId: cloudinaryFile.publicId,
        cloudinaryResourceType: cloudinaryFile.resourceType,
      }),
    );
  } catch (err) {
    await deleteReceiptFromCloudinary({
      publicId: cloudinaryFile.publicId,
      resourceType: cloudinaryFile.resourceType,
    });
    throw err;
  }
}

export async function processReceipt(
  filePath: string,
  meta: { originalName: string; mimeType: string; size: number },
  storage?: {
    storagePath?: string;
    fileUrl?: string | null;
    cloudinaryPublicId?: string | null;
    cloudinaryResourceType?: string | null;
  },
) {
  const ocr = getOcrProvider();
  const ai = getAiProvider();

  let targetFilePath = filePath;
  let ocrMimeType = meta.mimeType;
  let directText: string | null = null;
  let pdfOcrConfidence: number | null = null;
  // pipeline.pdfMethod tracks the entry path:
  //   "direct"  -> PDF with embedded text (no OCR ran)
  //   "ocr"     -> PDF rasterized + OCR per page
  //   "image"   -> input was already an image, no PDF stage
  let pdfMethod: "direct" | "ocr" | "image" =
    meta.mimeType === "application/pdf" ? "direct" : "image";

  // 1. PDF Handling
  if (meta.mimeType === "application/pdf") {
    logger.info({ msg: "PDF: processing", filePath });
    const pdfResult = await pdfToImages(filePath);

    if (pdfResult.method === "direct" && pdfResult.directText) {
      directText = pdfResult.directText;
      pdfMethod = "direct";
      logger.info({ msg: "PDF: using embedded text", textLength: directText.length });
    } else if (pdfResult.pages.length === 1) {
      // Single page: let the normal OCR flow handle it
      targetFilePath = pdfResult.pages[0];
      ocrMimeType = "image/png";
      pdfMethod = "ocr";
      logger.info({ msg: "PDF: single page, using OCR", page: targetFilePath });
    } else if (pdfResult.pages.length > 1) {
      // Multi-page: run OCR on each page and combine the text
      pdfMethod = "ocr";
      logger.info({ msg: "PDF: multi-page OCR", pageCount: pdfResult.pages.length });
      const pageTexts: string[] = [];
      let totalConf = 0;
      for (let i = 0; i < pdfResult.pages.length; i++) {
        const pagePath = pdfResult.pages[i];
        try {
          const po = await ocr.extractText({ filePath: pagePath, mimeType: "image/png" });
          if (po.text.trim()) {
            pageTexts.push(po.text.trim());
            totalConf += po.confidence;
          }
          logger.info({ msg: `PDF: page ${i + 1} OCR`, textLength: po.text.length, confidence: po.confidence });
        } catch (err) {
          logger.warn({ msg: `PDF: page ${i + 1} OCR failed`, error: err instanceof Error ? err.message : err });
        }
      }
      if (pageTexts.length > 0) {
        directText = pageTexts.join("\n\n");
        pdfOcrConfidence = totalConf / pageTexts.length;
        logger.info({ msg: "PDF: combined pages", pages: pageTexts.length, textLength: directText.length });
      } else {
        // All pages failed - fall back to first page
        targetFilePath = pdfResult.pages[0];
        ocrMimeType = "image/png";
      }
    }
  }

  // 2. OCR Extraction
  let rawText = directText || "";
  let ocrConfidence = 1.0;
  let ocrOut: any = { text: rawText, confidence: 1.0, words: [], lines: [] };

  if (!directText) {
    ocrOut = await ocr.extractText({ filePath: targetFilePath, mimeType: ocrMimeType });
    rawText = ocrOut.text;
    ocrConfidence = ocrOut.confidence || 0.5;
  } else if (pdfOcrConfidence !== null) {
    // directText came from multi-page PDF OCR - use its averaged confidence
    ocrConfidence = pdfOcrConfidence;
  }

  // 3. Reconstruct Layout
  const reconstructedLayout = directText
    ? { text: directText, lines: directText.split("\n"), tableRows: [] }
    : reconstructLayout(ocrOut.words || [], ocrOut.lines || [], rawText);
  const reconstructedText = reconstructedLayout.text;

  // 4. Run rules-based parsing pipeline
  const parseCtx = {
    rawText,
    reconstructedText,
    lines: reconstructedLayout.lines,
    tableRows: reconstructedLayout.tableRows,
    ocrConfidence,
    mimeType: meta.mimeType,
  };

  const parsedResult = parseReceipt(parseCtx);
  const base = parsedResult.fields;

  // 5. AI structuring + categorization in a SINGLE call (saves tokens vs. two prompts).
  // The AI receives every candidate it might need (totals, subtotals, taxes, vendor/customer
  // names, classified IDs, accounts list) and decides which value belongs in each field.
  const ctxText = reconstructedText || rawText;
  const totalCandidates = extractAllTotalCandidates(ctxText);
  const subtotalCandidates = extractAllSubtotalCandidates(ctxText);
  const taxCandidates = extractAllTaxCandidates(ctxText);
  const labeledFields = extractRawLabeledFields(ctxText);
  const vendorCandidates = extractVendorCandidates(ctxText);
  const customerCandidates = extractCustomerCandidates(ctxText);
  const identifications = extractClassifiedIdentifications(ctxText);

  // Load accounts (cached) so the AI can pick a category in the same call.
  const accounts = await getAccounts();

  const aiStruct = await ai
    .structure({
      rawText,
      reconstructedText,
      partialFields: base,
      warnings: parsedResult.warnings,
      totalCandidates,
      subtotalCandidates,
      taxCandidates,
      labeledFields,
      vendorCandidates,
      customerCandidates,
      identifications,
      tableRows: reconstructedLayout.tableRows,
      accounts,
    })
    .catch((err) => {
      logger.error("AI Structure failed", err);
      return {} as Partial<ParsedReceipt>;
    });

  // Financial fields: AI always wins - sees all total candidates and full context.
  // Identity fields: AI fills missing OR corrects obviously wrong values (terminal codes, doc titles).
  // Everything else: AI fills only what rules left empty.
  const FINANCIAL = new Set<keyof ParsedReceipt>(["amount", "subtotalAmount", "taxAmount", "taxPercentage"]);

  const mergedFields: Partial<ParsedReceipt> = { ...base };

  const isEmpty = (val: unknown) =>
    val === null || val === undefined ||
    (Array.isArray(val) && val.length === 0) ||
    (typeof val === "string" && val.trim().length === 0);

  // A rule-extracted vendor looks "bad" if it's a terminal code or doc title the AI should fix
  const BAD_VENDOR = /^(DC\d+|POS[\-\s]?\d*|TERM[\-\s]?\d+|CAJA\s*\d+|REG\s*\d+|TML\s*\d+|[A-Z]{1,3}\d{1,4}|Comprobante|Factura de Operaci[o\u00f3]n|DGI)$/i;

  for (const key of Object.keys(aiStruct) as (keyof ParsedReceipt)[]) {
    const aiVal = aiStruct[key];
    if (aiVal === null || aiVal === undefined) continue;
    const baseVal = base[key];

    let shouldOverride = isEmpty(baseVal) || key === "extraFields" || FINANCIAL.has(key);

    // Identity: AI corrects only if rules returned nothing or an obviously bad value
    if (!shouldOverride && (key === "vendorName" || key === "customerName")) {
      shouldOverride = typeof baseVal === "string" && BAD_VENDOR.test(baseVal.trim());
    }
    if (!shouldOverride && (key === "vendorIdentifications" || key === "customerIdentifications")) {
      shouldOverride = Array.isArray(baseVal) && baseVal.length === 0;
    }

    if (shouldOverride) {
      // @ts-ignore
      mergedFields[key] = aiVal;
    }
  }

  // 5a-bis. Sanitize identity fields. The AI sometimes echoes raw OCR lines
  // including cross-column noise (e.g. "DERMA MEDICAL CENTER S.A.        Rodin ity as:").
  // Truncate everything past 4+ consecutive spaces - that gap signals a column boundary.
  // Also strip trailing fragmentary words that got glued from neighbouring columns.
  const stripColumnNoise = (s: string | null | undefined): string | null => {
    if (!s) return s ?? null;
    let out = s.replace(/\s{4,}.*$/, "").trim();
    // Drop short trailing tokens that are obvious OCR fragments (1-3 chars + ":" / "-")
    out = out.replace(/(\s+\b\w{1,3}[:\-])+$/, "").trim();
    return out || null;
  };
  if (mergedFields.vendorName) mergedFields.vendorName = stripColumnNoise(mergedFields.vendorName);
  if (mergedFields.customerName) mergedFields.customerName = stripColumnNoise(mergedFields.customerName);

  // 5b. Compute missing financial fields using math (subtotal + tax = total)
  const computed = computeFields(mergedFields);
  if (computed.amount != null && mergedFields.amount == null) mergedFields.amount = computed.amount;
  if (computed.subtotalAmount != null && mergedFields.subtotalAmount == null) mergedFields.subtotalAmount = computed.subtotalAmount;
  if (computed.taxAmount != null && mergedFields.taxAmount == null) mergedFields.taxAmount = computed.taxAmount;
  if (computed.taxPercentage != null && mergedFields.taxPercentage == null) mergedFields.taxPercentage = computed.taxPercentage;

  // 6. Categorization - already resolved by structure() above
  let categoryId: number | null = aiStruct.category ?? null;

  if (categoryId === null) {
    categoryId = await categorize(rawText, {
      vendorName: mergedFields.vendorName,
      items: mergedFields.items,
    }).catch(() => null);
  }

  if (categoryId === null) {
    const fallback = await prisma.account.findFirst({
      where: { type: "expense" },
      orderBy: { id: "asc" },
    });
    if (fallback) {
      logger.warn("Category: using generic fallback -> " + fallback.name);
      categoryId = fallback.id;
    }
  }

  // Currency detection
  const detectedCurrency = detectCurrency(rawText, mergedFields.currency ?? null);

  // Enrich category
  let categoryName: string | null = null;
  let categoryType: string | null = null;
  if (categoryId !== null) {
    const acc = await prisma.account.findUnique({ where: { id: categoryId } });
    if (acc) {
      categoryName = acc.name;
      categoryType = String(acc.type);
    }
  }

  const aiWarnings = (aiStruct as { _aiWarnings?: string[] })._aiWarnings;
  if (aiWarnings?.length) {
    mergedFields.extraFields = mergedFields.extraFields || {};
    mergedFields.extraFields["Advertencias IA"] = aiWarnings.join(" | ");
  }

  const json = {
    amount: mergedFields.amount ?? null,
    subtotalAmount: mergedFields.subtotalAmount ?? null,
    taxAmount: mergedFields.taxAmount ?? null,
    taxPercentage: mergedFields.taxPercentage ?? null,
    type: mergedFields.type ?? "expense",
    currency: detectedCurrency,
    date: mergedFields.date ?? null,
    paymentMethod: mergedFields.paymentMethod ?? null,
    description: mergedFields.description ?? null,
    invoiceNumber: mergedFields.invoiceNumber ?? null,
    category: categoryId,
    categoryName,
    categoryType,
    vendorId: null,
    vendorName: mergedFields.vendorName ?? null,
    vendorIdentifications: mergedFields.vendorIdentifications ?? [],
    customerName: mergedFields.customerName ?? null,
    customerIdentifications: mergedFields.customerIdentifications ?? [],
    extraFields: mergedFields.extraFields ?? {},
    ocrConfidence: typeof ocrConfidence === "number" ? +ocrConfidence.toFixed(2) : null,
    items: mergedFields.items ?? [],
    pipeline: {
      pdfMethod,
      parserUsed: parsedResult.parserName,
    },
  };

  const aiProviderUsed = (aiStruct as { _aiProviderUsed?: string })._aiProviderUsed;
  const saved = await prisma.receipt.create({
    data: {
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      size: meta.size,
      storagePath: storage?.storagePath || filePath,
      fileUrl: storage?.fileUrl || null,
      cloudinaryPublicId: storage?.cloudinaryPublicId || null,
      cloudinaryResourceType: storage?.cloudinaryResourceType || null,
      rawText,
      json,
      ocrProvider: process.env.OCR_PROVIDER || "tesseract",
      aiProvider: aiProviderUsed || process.env.AI_PROVIDER || "mock",
    },
  });

  return saved;
}
