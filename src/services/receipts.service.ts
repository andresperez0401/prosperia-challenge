import { prisma } from "../db/client.js";
import { getOcrProvider } from "./ocr/index.js";
import { getAiProvider } from "./ai/index.js";
import { parseReceipt } from "./parsing/parseReceipt.js";
import { extractAllTotalCandidates, extractRawLabeledFields } from "./parsing/parser.js";
import { categorize } from "./parsing/categorizer.js";
import { detectCurrency } from "./parsing/detect.currency.js";
import { pdfToImages } from "./pdf/pdfHandler.js";
import { reconstructLayout } from "./ocr/reconstructLayout.js";
import { computeFields } from "./parsing/computeFields.js";
import { logger } from "../config/logger.js";
import { ParsedReceipt } from "../types/receipt.js";
import fs from "fs";

export async function processReceipt(
  filePath: string,
  meta: { originalName: string; mimeType: string; size: number },
) {
  const ocr = getOcrProvider();
  const ai = getAiProvider();

  let targetFilePath = filePath;
  let ocrMimeType = meta.mimeType;
  let directText: string | null = null;
  let pdfOcrConfidence: number | null = null;
  let pdfMethod = "direct";

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
        // All pages failed — fall back to first page
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
    // directText came from multi-page PDF OCR — use its averaged confidence
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

  // 5. AI calls — structure + categorize run in parallel for speed.
  // categorize uses rules-only data (no need to wait for structure).
  const totalCandidates = extractAllTotalCandidates(reconstructedText || rawText);
  const labeledFields = extractRawLabeledFields(reconstructedText || rawText);

  const [aiStruct, aiCatResult] = await Promise.all([
    ai.structure({
      rawText,
      reconstructedText,
      partialFields: base,
      warnings: parsedResult.warnings,
      totalCandidates,
      labeledFields,
    }).catch((err) => {
      logger.error("AI Structure failed", err);
      return {} as Partial<ParsedReceipt>;
    }),
    ai.categorize({
      rawText,
      items: base.items ?? [],
      vendorName: base.vendorName ?? null,
    }).catch(() => ({} as Partial<ParsedReceipt>)),
  ]);

  // Financial fields: AI always wins — sees all total candidates and full context.
  // Identity fields: AI fills missing OR corrects obviously wrong values (terminal codes, doc titles).
  // Everything else: AI fills only what rules left empty.
  const FINANCIAL = new Set<keyof ParsedReceipt>(["amount", "subtotalAmount", "taxAmount", "taxPercentage"]);

  const mergedFields: Partial<ParsedReceipt> = { ...base };

  const isEmpty = (val: unknown) =>
    val === null || val === undefined ||
    (Array.isArray(val) && val.length === 0) ||
    (typeof val === "string" && val.trim().length === 0);

  // A rule-extracted vendor looks "bad" if it's a terminal code or doc title the AI should fix
  const BAD_VENDOR = /^(DC\d+|POS[\-\s]?\d*|TERM[\-\s]?\d+|CAJA\s*\d+|REG\s*\d+|TML\s*\d+|[A-Z]{1,3}\d{1,4}|Comprobante|Factura de Operaci[oó]n|DGI)$/i;

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

  // 5b. Compute missing financial fields using math (subtotal + tax = total)
  const computed = computeFields(mergedFields);
  if (computed.amount != null && mergedFields.amount == null) mergedFields.amount = computed.amount;
  if (computed.subtotalAmount != null && mergedFields.subtotalAmount == null) mergedFields.subtotalAmount = computed.subtotalAmount;
  if (computed.taxAmount != null && mergedFields.taxAmount == null) mergedFields.taxAmount = computed.taxAmount;
  if (computed.taxPercentage != null && mergedFields.taxPercentage == null) mergedFields.taxPercentage = computed.taxPercentage;

  // 6. Categorization — already resolved in parallel above
  let categoryId: number | null = aiCatResult.category ?? null;

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
      logger.warn("Category: using generic fallback → " + fallback.name);
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
    rawText,
    pipeline: {
      pdfMethod,
      parserUsed: parsedResult.parserName,
    }
  };

  const saved = await prisma.receipt.create({
    data: {
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      size: meta.size,
      storagePath: filePath,
      rawText,
      json,
      ocrProvider: process.env.OCR_PROVIDER || "tesseract",
      aiProvider: process.env.AI_PROVIDER || "mock",
    },
  });

  return saved;
}
