import { ParsedReceipt, Item } from "../../types/receipt.js";
import { logger } from "../../config/logger.js";
import { normalizeAmount } from "./normalizers/normalizeAmount.js";
import { normalizeDate } from "./normalizers/normalizeDate.js";

const SKIP_VENDOR =
  /^(seniat|sentat|sen[il]at|providencia|administraci[oó]n\s+tributaria|servicio\s+nacional|ministerio|repúblic|gobierno|national\s+tax|iva\b|tax\s+auth|fecha\b|factura\b|invoice\b|recibo\b|receipt\b|tel[eé]f|fax|e-?mail|www\.|http|rif\b|ruc\b|nit\b)/i;

export function naiveParse(rawText: string): Partial<ParsedReceipt> {
  const amount = extractAmount(rawText);
  const subtotal = extractSubtotal(rawText);
  const tax = extractTax(rawText);
  const pct = extractTaxPct(rawText);
  const date = normalizeDate(rawText);
  const invoice = findInvoice(rawText);
  const vendorName = guessVendorName(rawText);
  const vendorIdentifications = extractVendorIdentifications(rawText);
  const paymentMethod = extractPaymentMethod(rawText);
  const items = extractItems(rawText);

  logger.info({
    message: "Naive Parse Result",
    parseResult: { amount, subtotal, tax, pct, date, invoice, vendorName, vendorIdentifications },
  });

  return {
    amount,
    subtotalAmount: subtotal,
    taxAmount: tax,
    taxPercentage: pct,
    date,
    invoiceNumber: invoice,
    vendorName,
    vendorIdentifications,
    paymentMethod,
    items,
    rawText,
  };
}

/**
 * Extract a numeric amount from a regex match group.
 * Requires a decimal separator to avoid matching bare integers like years or counts.
 */
function grabAmount(text: string, re: RegExp, group = 1): number | null {
  const m = text.match(re);
  if (!m) return null;
  const raw = m[group];
  if (!raw || !/[.,]\d{2}/.test(raw)) return null;
  const n = normalizeAmount(raw);
  return n !== null && n > 0 ? n : null;
}

function extractAmount(text: string): number | null {
  const patterns: RegExp[] = [
    // Most specific labels first
    /total\s+a\s+pagar\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\btotal\s+factura\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bgrand\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bamount\s+due\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    /\btotal\s+due\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    /\bimporte\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\btotal\s+a\s+cobrar\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    // Line that is just "TOTAL: 123.45" or "TOTAL 123.45"
    /^\s*total\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£]\s*)?([\d.,]+)\s*$/im,
    // Generic fallback — avoid matching IVA/TAX totals
    /\btotal\b(?!\s+(?:iva|igv|vat|tax|impuesto|de\s|items?))[^\d\n]{0,25}([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const n = grabAmount(text, re);
    if (n !== null) return n;
  }
  return null;
}

function extractSubtotal(text: string): number | null {
  const patterns: RegExp[] = [
    /sub\s*total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bbase\s+imponible\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bnet\s+amount\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    /\btaxable\s+amount\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    /\bsubtotal\b[^\d\n]{0,25}([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const n = grabAmount(text, re);
    if (n !== null) return n;
  }
  return null;
}

function extractTax(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/\b(iva|igv|itbms|itbis|vat|tax|impuesto|sales\s+tax)\b/i.test(line)) continue;
    const nums: number[] = [];
    for (const m of line.matchAll(/([\d.,]+)/g)) {
      const raw = m[0];
      // Skip values that are immediately followed by "%" — those are percentages
      const after = line.slice((m.index ?? 0) + raw.length).trimStart();
      if (/^%/.test(after)) continue;
      const n = normalizeAmount(raw);
      if (n !== null && n >= 0.5) nums.push(n);
    }
    // Return the last number on the line — amount appears after any percentage label
    if (nums.length > 0) return nums[nums.length - 1];
  }
  return null;
}

function extractTaxPct(text: string): number | null {
  const m =
    text.match(/\b(?:iva|igv|vat|tax|impuesto)\b[^%\n]{0,30}(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i) ||
    text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%[^%\n]{0,20}\b(?:iva|igv|vat|tax|impuesto)\b/i);
  if (m) {
    const n = parseFloat((m[1] ?? "").replace(",", "."));
    return isFinite(n) && n > 0 && n < 100 ? n : null;
  }
  return null;
}

function guessVendorName(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 80) continue;
    if (SKIP_VENDOR.test(line)) continue;
    // Skip lines that are pure numbers, symbols, or dates
    if (/^[\d\s\-\/\\.,;:()+]+$/.test(line)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(line)) continue;
    return line.replace(/[,;:.]+$/, "").trim();
  }
  return lines[0]?.slice(0, 80) ?? null;
}

function extractVendorIdentifications(text: string): string[] {
  const ids: string[] = [];
  const patterns = [
    /rif\s*[:\-]?\s*([jgve]-?\d[\d\-]+\d)/i,
    /ruc\s*[:\-]?\s*([a-z0-9\-\.]{6,20})/i,
    /nit\s*[:\-]?\s*([\d\-\.]{6,20})/i,
    /cif\s*[:\-]?\s*([a-z0-9\-\.]{6,20})/i,
    /cuit\s*[:\-]?\s*([\d\-\.]{8,20})/i,
    /vat\s*(?:id\s*)?[:\-]?\s*([a-z]{2}[a-z0-9]{6,18})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) ids.push(m[1].toUpperCase().trim());
  }
  return Array.from(new Set(ids));
}

function findInvoice(text: string): string | null {
  // Labels that must never become invoiceNumber
  const NOT_LABEL = /^(fecha|date|serie|hora|fax|tel|rif|ruc|nit|cif|vat)/i;
  const patterns: RegExp[] = [
    /(?:factura|invoice)\s*(?:nro\.?|no\.?|n[uú]m\.?|n[°o]\.?|#)?\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
    /(?:n[uú]mero|number)\s+(?:de\s+)?(?:factura|comprobante|invoice)\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
    /comprobante\s*(?:nro\.?|no\.?|#)?\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const candidate = m[1].toUpperCase().trim();
      if (NOT_LABEL.test(candidate)) continue;
      if (/^\d{4}[-\/]\d{2}[-\/]\d{2}$/.test(candidate)) continue; // ISO date
      if (/^[A-Z]{4,}$/.test(candidate)) continue; // pure uppercase word (FECHA, DATE…)
      return candidate;
    }
  }
  return null;
}

function extractPaymentMethod(text: string): ParsedReceipt["paymentMethod"] {
  if (/(tarjeta|card)/i.test(text)) return "CARD";
  if (/(efectivo|cash)/i.test(text)) return "CASH";
  if (/(transferencia|transfer|pago\s+m[oó]vil)/i.test(text)) return "TRANSFER";
  return null;
}

function extractItems(rawText: string): Item[] {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Item[] = [];
  const RE =
    /^(.+?)\s+(\d{1,4})\s+(?:[Bb][Ss]\.?\s*)?(?:[\$€£]\s*)?([\d.,]+)\s+(?:[Bb][Ss]\.?\s*)?(?:[\$€£]\s*)?([\d.,]+)\s*$/;

  for (const line of lines) {
    if (/^(descripci[oó]n|cant|total|subtotal|iva|fecha|factura)/i.test(line)) continue;
    const m = line.match(RE);
    if (!m) continue;
    const description = m[1].trim();
    const quantity = parseInt(m[2], 10);
    const unitPrice = normalizeAmount(m[3]) ?? 0;
    const total = normalizeAmount(m[4]) ?? 0;
    if (!unitPrice || !total || quantity < 1 || quantity > 9999) continue;
    items.push({ description, quantity, unitPrice, total, category: null });
  }
  return items;
}
