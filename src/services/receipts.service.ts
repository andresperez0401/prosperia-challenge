import { prisma } from "../db/client.js";
import { getOcrProvider } from "./ocr/index.js";
import { getAiProvider } from "./ai/index.js";
import { naiveParse } from "./parsing/parser.js";
import { categorize } from "./parsing/categorizer.js";
import { detectCurrency } from "./parsing/detect.currency.js";

export async function processReceipt(
  filePath: string,
  meta: { originalName: string; mimeType: string; size: number },
) {
  const ocr = getOcrProvider();
  const ai = getAiProvider();

  // TODO: Implementar ocr.extractText con Tesseract
  const ocrOut = await ocr.extractText({ filePath, mimeType: meta.mimeType });

  // 1) Reglas rápidas: extraer campos con regex (rápido, determinístico)
  const base = naiveParse(ocrOut.text);

  // TODO: Implementar
  // 2) IA estructura los campos faltantes o ambiguos
  const aiStruct = await ai.structure(ocrOut.text).catch(() => ({} as Partial<typeof base>));

  // TODO: Implementar
  // 3) Categorización: IA relay es la fuente primaria (obligatorio según README).
  //    Si la IA falla, usamos la heurística de palabras clave como respaldo.
  let categoryId: number | null = null;
  try {
    const aiCat = await ai.categorize({
      rawText: ocrOut.text,
      items: (aiStruct as { items?: [] }).items ?? [],
      ...({ vendorName: (aiStruct as { vendorName?: string | null }).vendorName ?? base.vendorName } as object),
    } as Parameters<typeof ai.categorize>[0]);
    categoryId = (aiCat as { category?: number }).category ?? null;
  } catch {
    // silently fall through to heuristic
  }
  if (categoryId === null) {
    categoryId = await categorize(ocrOut.text).catch(() => null);
  }
  // Fallback final: README dice que categorización es obligatoria.
  // Si todo falla, usar el primer account de tipo expense disponible.
  if (categoryId === null) {
    const fallback = await prisma.account.findFirst({
      where: { type: "expense" },
      orderBy: { id: "asc" },
    });
    if (fallback) {
      console.warn("Category: using generic fallback →", fallback.name);
      categoryId = fallback.id;
    }
  }

  // detect currency — símbolo € es inequívoco; $ es ambiguo (MXN/COP/USD), se deja a la IA
  const detectedCurrency = detectCurrency(ocrOut.text, (aiStruct as { currency?: string | null }).currency ?? null);

  // enrich category with account metadata if available
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
    amount: (aiStruct as { amount?: number | null }).amount ?? base.amount ?? null,
    subtotalAmount:
      (aiStruct as { subtotalAmount?: number | null }).subtotalAmount ?? base.subtotalAmount ?? null,
    taxAmount: (aiStruct as { taxAmount?: number | null }).taxAmount ?? base.taxAmount ?? null,
    taxPercentage:
      (aiStruct as { taxPercentage?: number | null }).taxPercentage ?? base.taxPercentage ?? null,
    type: (aiStruct as { type?: string }).type ?? "expense",
    currency: detectedCurrency,
    date: (aiStruct as { date?: string | null }).date ?? base.date ?? null,
    paymentMethod: (aiStruct as { paymentMethod?: string | null }).paymentMethod ?? base.paymentMethod ?? null,
    description: (aiStruct as { description?: string | null }).description ?? null,
    invoiceNumber:
      (aiStruct as { invoiceNumber?: string | null }).invoiceNumber ?? base.invoiceNumber ?? null,
    category: categoryId,
    categoryName,
    categoryType,
    vendorId: null,
    vendorName:
      (aiStruct as { vendorName?: string | null }).vendorName ?? base.vendorName ?? null,
    vendorIdentifications:
      (aiStruct as { vendorIdentifications?: string[] }).vendorIdentifications ??
      base.vendorIdentifications ??
      [],
    customerName:
      (aiStruct as { customerName?: string | null }).customerName ?? base.customerName ?? null,
    customerIdentifications:
      (aiStruct as { customerIdentifications?: string[] }).customerIdentifications ??
      base.customerIdentifications ??
      [],
    ocrConfidence: typeof ocrOut.confidence === "number" ? +ocrOut.confidence.toFixed(2) : null,
    items: (
      ((aiStruct as { items?: unknown[] }).items?.length
        ? (aiStruct as { items?: unknown[] }).items
        : (base as { items?: unknown[] }).items) ?? []
    ) as object[],
    rawText: ocrOut.text,
  };

  const saved = await prisma.receipt.create({
    data: {
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      size: meta.size,
      storagePath: filePath,
      rawText: ocrOut.text,
      json,
      ocrProvider: process.env.OCR_PROVIDER || "tesseract",
      aiProvider: process.env.AI_PROVIDER || "mock",
    },
  });

  return saved;
}
