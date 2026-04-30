import { ParsedReceipt, Item } from "../../types/receipt.js";
import { logger } from "../../config/logger.js";
import { normalizeAmount } from "./normalizers/normalizeAmount.js";
import { normalizeDate } from "./normalizers/normalizeDate.js";

// ── Public re-exports expected by tests ──────────────────────────────────────
export { normalizeAmount as parseAmount };
export { normalizeDate as extractDate };

export interface TotalCandidate {
  label: string;
  value: number;
}

/**
 * Extract ALL lines containing "total" and their rightmost amount.
 * Sent verbatim to the AI so it can pick the correct final total.
 */
export function extractAllTotalCandidates(text: string): TotalCandidate[] {
  const seen = new Set<string>();
  const results: TotalCandidate[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/\btotal\b/i.test(trimmed)) continue;

    const nums: number[] = [];
    for (const m of trimmed.matchAll(/([\d.,]+)/g)) {
      const n = normalizeAmount(m[0]);
      if (n !== null && n > 0) nums.push(n);
    }
    if (nums.length === 0) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ label: trimmed, value: nums[nums.length - 1] });
  }

  return results;
}

const SKIP_VENDOR =
  /^(seniat|sentat|sen[il]at|providencia|administraci[oó]n\s+tributaria|servicio\s+nacional|ministerio|repúblic|gobierno|national\s+tax|iva\b|tax\s+auth|fecha\b|factura\b|invoice\b|recibo\b|receipt\b|tel[eé]f|fax|e-?mail|www\.|http|rif\b|ruc\b|nit\b|dv\b|comprobante\b|dgi\b|factura\s+de\s+operaci[oó]n|tipo\s+de\s+receptor|emisor\b|cliente\b|receptor\b|direcci[oó]n\b|punto\s+de\s+facturaci[oó]n)/i;

/** Returns key→value pairs found by label scanning — sent verbatim to the AI for verification */
export function extractRawLabeledFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const LABELS = [
    // Vendor
    { key: "Emisor", re: /Emisor\s*:\s*(.+)/i },
    { key: "Proveedor", re: /Proveedor\s*:\s*(.+)/i },
    { key: "Vendedor", re: /Vendedor\s*:\s*(.+)/i },
    { key: "Razón Social Emisor", re: /Raz[oó]n\s*Social\s*:\s*(.+)/i },
    // IDs
    { key: "RUC", re: /RUC\s*:\s*([\w\d\-\.]+)/i },
    { key: "RIF", re: /RIF\s*[:\-]?\s*([\w\d\-\.]+)/i },
    { key: "RFC", re: /RFC\s*:\s*([\w\d\-\.]+)/i },
    { key: "NIT", re: /NIT\s*:\s*([\w\d\-\.]+)/i },
    { key: "CUIT", re: /CUIT\s*:\s*([\w\d\-\.]+)/i },
    // Customer
    { key: "Cliente", re: /Cliente\s*:\s*(.+)/i },
    { key: "Receptor", re: /Receptor\s*:\s*(.+)/i },
    { key: "Comprador", re: /Comprador\s*:\s*(.+)/i },
    { key: "Adquiriente", re: /Adquir(?:iente|ente)\s*:\s*(.+)/i },
    { key: "RUC_Cédula_Pasaporte", re: /RUC\/C[eé]dula\/Pasaporte\s*:\s*([\w\d\-\.\/]+)/i },
    // Invoice meta
    { key: "Número", re: /N[úu]mero\s*:\s*(\S+)/i },
    { key: "Fecha de Emisión", re: /Fecha de Emisi[óo]n\s*:\s*(\S+)/i },
    { key: "Tipo de Receptor", re: /Tipo de Receptor\s*:\s*(.+)/i },
    // Address
    { key: "Dirección", re: /Direcci[oó]n\s*:\s*(.+)/i },
  ];
  for (const { key, re } of LABELS) {
    const m = text.match(re);
    if (m?.[1]?.trim()) out[key] = m[1].trim().slice(0, 120);
  }
  return out;
}

export function naiveParse(rawText: string): Partial<ParsedReceipt> {
  const amount = extractTotal(rawText);
  const subtotal = extractSubtotal(rawText);
  let tax = extractTax(rawText);
  let pct = extractTaxPercentage(rawText);
  const date = normalizeDate(rawText);
  const invoice = findInvoice(rawText);
  const labeled = extractLabeledParties(rawText);
  const vendorName = labeled.vendorName ?? extractVendorName(rawText);
  const vendorIdentifications = labeled.vendorIds.length
    ? labeled.vendorIds
    : extractVendorIds(rawText);
  const customerName = labeled.customerName;
  const customerIdentifications = labeled.customerIds;
  const paymentMethod = extractPaymentMethod(rawText);
  const items = extractItems(rawText);

  // If invoice is explicitly exempt/zero-tax and no tax was found, lock to 0
  if (tax === null && extractZeroTaxSignal(rawText)) {
    tax = 0;
    pct = 0;
  }

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
    customerName,
    customerIdentifications,
    paymentMethod,
    items,
    rawText,
  };
}

// ── reconcile ────────────────────────────────────────────────────────────────
/**
 * Derive missing subtotal/tax using math: subtotal + tax ≈ total.
 * Never overwrites values that are already present.
 * Returns what can be inferred; values beyond inference stay null.
 */
export function reconcile(
  total: number | null,
  subtotal: number | null,
  tax: number | null,
  pct: number | null,
): { subtotal: number | null; tax: number | null } {
  if (total === null) return { subtotal: null, tax: null };
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Both present — return as-is (don't overwrite even if math doesn't check out)
  if (subtotal !== null && tax !== null) return { subtotal, tax };

  // subtotal + pct → tax
  if (subtotal !== null && tax === null && pct !== null) {
    return { subtotal, tax: r2((subtotal * pct) / 100) };
  }

  // subtotal known, tax unknown → derive
  if (subtotal !== null && tax === null) {
    const d = r2(total - subtotal);
    return { subtotal, tax: d >= 0 ? d : null };
  }

  // tax known, subtotal unknown → derive
  if (subtotal === null && tax !== null) {
    const d = r2(total - tax);
    return { subtotal: d > 0 ? d : null, tax };
  }

  return { subtotal: null, tax: null };
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Universal labeled-field extraction for any structured invoice.
 * Works for Panama DGI, Mexican CFDI, Colombian, Venezuelan, etc.
 */
function extractLabeledParties(text: string): {
  vendorName: string | null;
  vendorIds: string[];
  customerName: string | null;
  customerIds: string[];
} {
  const result = {
    vendorName: null as string | null,
    vendorIds: [] as string[],
    customerName: null as string | null,
    customerIds: [] as string[],
  };

  // Boundary between vendor and customer sections
  const customerBoundary =
    /(?:Tipo de Receptor|Datos del (?:Cliente|Receptor|Comprador)|Receptor\s*:|Adquir(?:iente|ente)\s*:|Comprador\s*:|Bill(?:ed)?\s*To\s*:|Sold\s*To\s*:)/i;
  const parts = text.split(customerBoundary);
  const vendorSection = parts[0] ?? text;
  const customerSection = parts.slice(1).join("\n");

  // Vendor name — labeled fields in priority order
  const vendorLabelRe =
    /(?:Emisor|Proveedor|Vendedor|Raz[oó]n\s*Social\s*(?:Emisor)?|Empresa|Establecimiento)\s*:\s*(.+)/i;
  const vendorMatch = vendorSection.match(vendorLabelRe);
  if (vendorMatch) result.vendorName = vendorMatch[1].trim();

  // Vendor tax ID — in vendor section only
  const vendorIdRe =
    /(?:RUC|RFC|NIT|CUIT|RIF|CIF|EIN|VAT\s*(?:ID|No\.?)?)\s*[:\-]?\s*([\w\d\-\.]{5,25})/i;
  const vendorIdMatch = vendorSection.match(vendorIdRe);
  if (vendorIdMatch) result.vendorIds = [vendorIdMatch[1].trim().toUpperCase()];

  // Customer name — search in customer section (after the boundary)
  const customerLabelRe =
    /(?:Cliente|Receptor|Comprador|Adquir(?:iente|ente)|Destinatario|Customer|Bill(?:ed)?\s+To|Sold\s+To|Raz[oó]n\s*Social)\s*:\s*(.+)/i;
  const customerMatch = customerSection
    ? customerSection.match(customerLabelRe)
    : text.match(/(?:Cliente|Receptor|Comprador|Adquir(?:iente|ente)|Destinatario|Customer|Bill(?:ed)?\s+To)\s*:\s*(.+)/i);
  if (customerMatch) result.customerName = customerMatch[1].trim();

  // Customer tax ID — in customer section only
  const customerIdRe =
    /(?:RUC\/C[eé]dula\/Pasaporte|RFC|NIT|CUIT|RIF|C\.?I\.?|EIN)\s*[:\-]?\s*([\w\d\-\.\/]{4,25})/i;
  const customerIdMatch = customerSection.match(customerIdRe);
  if (customerIdMatch) result.customerIds = [customerIdMatch[1].trim().toUpperCase()];

  return result;
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

/** Like grabAmount but accepts whole numbers (for OCR column-merge cases). */
function grabAmountLoose(text: string, re: RegExp, group = 1): number | null {
  const m = text.match(re);
  if (!m) return null;
  const raw = m[group];
  if (!raw || !/\d/.test(raw)) return null;
  const n = normalizeAmount(raw);
  return n !== null && n > 0 ? n : null;
}

// ── Exported extraction functions (used by tests + pipeline) ─────────────────

export function extractTotal(text: string): number | null {
  const patterns: RegExp[] = [
    // Most specific labels first
    /total\s+a\s+pagar\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\btotal\s+factura\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bgrand\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bamount\s+due\s*[:\-=]?\s*(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\btotal\s+due\s*[:\-=]?\s*(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\bbalance\s+due\s*[:\-=]?\s*(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\bimporte\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\btotal\s+a\s+cobrar\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bmonto\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\btotal\s+general\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\bneto\s+a\s+pagar\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\bvalor\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\btotal\s+venta\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\btotal\s+pagado\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
    /\btotal\s+(?:bs|usd|\$|b\/\.)\s*[:\-=]?\s*([\d.,]+)/i,
    // Line that is just "TOTAL: 123.45" or "TOTAL 123.45"
    /^\s*total\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)\s*$/im,
    // Multi-line: TOTAL on its own line, amount on next
    /^total\s*$\s*([\d.,]+)/im,
    // Generic fallback — avoid matching IVA/TAX totals
    /\btotal\b(?!\s+(?:iva|igv|vat|tax|itbms|impuesto|de\s|items?))[^\d\n]{0,25}([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const n = grabAmount(text, re);
    if (n !== null) return n;
  }
  return null;
}

export function extractSubtotal(text: string): number | null {
  const patterns: RegExp[] = [
    /sub\s*total\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bbase\s+imponible\s*[:\-=]?\s*(?:bs\.?\s*)?([\d.,]+)/i,
    /\bnet\s+amount\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    /\btaxable\s+amount\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    // Panama DGI: "Total Neto" is the subtotal before ITBMS
    /\btotal\s+neto\s*[:\|]?\s*([\d.,]+)/i,
    // Thermal receipts: SUBT / SUBTL / SUBT. with optional noise before amount
    /^\s*subt?l?[.\s]*[:\-=]?\s*(?:\$\s*)?([\d.,]+)/im,
    /\bsubtotal\b[^\d\n]{0,25}([\d.,]+)/i,
    // Generic "neto:" (net amount without tax)
    /\bneto\s*[:\-=]?\s*(?:[\$€£]\s*)?([\d.,]+)/i,
    // "Valor Total" = sum of line items (subtotal before tax in structured invoices)
    /\bvalor\s+total\s*[:\-=]?\s*(?:bs\.?\s*)?(?:[\$€£B\/\.]\s*)?([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const n = grabAmount(text, re);
    if (n !== null) return n;
  }

  // OCR column-merge fallback: "subtotal500", "subtotal 500€", "subtotal: 500"
  // Accepts integers (no decimal required) for this specific keyword
  const mergeMatch = text.match(/\bsubtotal\s*[:\-=€$£B\/\.]?\s*(\d+(?:[.,]\d+)?)/i);
  if (mergeMatch?.[1]) {
    const n = normalizeAmount(mergeMatch[1]);
    if (n !== null && n > 0) return n;
  }

  return null;
}

export function extractTax(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/\b(iva|igv|itbms|itbis|vat|tax|impuesto|sales\s+tax)\b/i.test(line)) continue;

    // Explicit exemption → tax is definitively 0
    if (
      /\b(exento|exempt|exclu[íi]do|excluido|libre\s+de\s+iva|sin\s+iva|no\s+sujeto)\b/i.test(line)
    )
      return 0;

    const nums: number[] = [];
    for (const m of line.matchAll(/([\d.,]+)/g)) {
      const raw = m[0];
      const after = line.slice((m.index ?? 0) + raw.length).trimStart();
      if (/^%/.test(after)) continue;
      const n = normalizeAmount(raw);
      // Accept 0 explicitly (e.g. "IVA 0.00") — means no tax applied
      if (n !== null && n >= 0) nums.push(n);
    }
    if (nums.length > 0) return nums[nums.length - 1];
  }
  return null;
}

export function extractTaxPercentage(text: string): number | null {
  // Bug fix: exclude digits from the middle part ([^%\d\n]) so the regex
  // doesn't consume the leading digit of the percentage (e.g. "IVA 12%" → 12, not 2).
  const m =
    text.match(/\b(?:iva|igv|vat|tax|impuesto)\b[^%\d\n]{0,30}(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i) ||
    text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%[^%\n]{0,20}\b(?:iva|igv|vat|tax|impuesto)\b/i);
  if (m) {
    const n = parseFloat((m[1] ?? "").replace(",", "."));
    return isFinite(n) && n > 0 && n < 100 ? n : null;
  }
  return null;
}

function extractZeroTaxSignal(text: string): boolean {
  return /\b(exento|exempt|0\s*%\s*(?:iva|igv|itbms|vat)|iva\s*0[.,]?0*%?|itbms\s*0|sin\s+impuesto|libre\s+de\s+impuesto)\b/i.test(
    text,
  );
}

/** Short codes that look like terminal/POS IDs, not business names */
const SKIP_TERMINAL =
  /^(DC\d+|POS[\-\s]?\d*|TERM[\-\s]?\d+|CAJA\s*\d+|REG\s*\d+|TML\s*\d+|[A-Z]{1,3}\d{1,4})$/i;

export function extractVendorName(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (line.length < 4 || line.length > 80) continue;
    if (SKIP_VENDOR.test(line)) continue;
    if (SKIP_TERMINAL.test(line)) continue;
    if (/^[\d\s\-\/\\.,;:()+]+$/.test(line)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(line)) continue;
    if (/^\d+\s+\w{1,4}\.?\s/.test(line) && line.split(" ").length <= 4) continue;
    if (!/[a-záéíóúñA-ZÁÉÍÓÚÑ]{3,}/.test(line)) continue;
    return line.replace(/[,;:.]+$/, "").trim();
  }
  return null;
}

export function extractVendorIds(text: string): string[] {
  const ids: string[] = [];
  const patterns = [
    /rif\s*[:\-]?\s*([jgve]-?\d[\d\-]+\d)/i,
    /ruc\s*[:\-]?\s*([a-z0-9\-\.]{6,20})/i,
    /nit\s*[:\-]?\s*([\d\-\.]{6,20})/i,
    /cif\s*[:\-]?\s*([a-z0-9\-\.]{6,20})/i,
    /cuit\s*[:\-]?\s*([\d\-\.]{8,20})/i,
    /ein\s*[:\-]?\s*(\d{2}-\d{7})/i,
    /vat\s*(?:id\s*)?[:\-]?\s*([a-z]{2}[a-z0-9]{6,18})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) ids.push(m[1].toUpperCase().trim());
  }
  return Array.from(new Set(ids));
}

function findInvoice(text: string): string | null {
  const NOT_LABEL = /^(fecha|date|serie|hora|fax|tel|rif|ruc|nit|cif|vat)/i;
  const patterns: RegExp[] = [
    /(?:factura|invoice)\s*(?:nro\.?|no\.?|n[uú]m\.?|n[°o]\.?|#)?\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
    /(?:n[uú]mero|number)\s+(?:de\s+)?(?:factura|comprobante|invoice)\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
    /comprobante\s*(?:nro\.?|no\.?|#)?\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{3,19})/i,
    // Plain "Número: NNNNN" — Panama DGI and other structured invoices
    /\bn[uú]mero\s*:\s*(\d{4,20})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const candidate = m[1].toUpperCase().trim();
      if (NOT_LABEL.test(candidate)) continue;
      if (/^\d{4}[-\/]\d{2}[-\/]\d{2}$/.test(candidate)) continue;
      if (/^[A-Z]{4,}$/.test(candidate)) continue;
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
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
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

// ── Legacy internal aliases (keep naiveParse working) ────────────────────────
/** @deprecated use extractTotal */
const extractAmount = extractTotal;
/** @deprecated use extractTaxPercentage */
const extractTaxPct = extractTaxPercentage;
/** @deprecated use extractVendorName */
const guessVendorName = extractVendorName;
/** @deprecated use extractVendorIds */
const extractVendorIdentifications = extractVendorIds;
