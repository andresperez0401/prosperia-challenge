import { ParsedReceipt } from "../../types/receipt.js";

// ===========================================================================
// PARSER DE REGLAS
// ---------------------------------------------------------------------------
// Extrae campos de un recibo a partir de su texto plano usando regex.
// Es la primera línea de defensa: rápida, determinística y barata.
// La IA viene después y rellena/corrige lo que las reglas no pudieron.
// ===========================================================================

export function naiveParse(rawText: string): Partial<ParsedReceipt> {
  // 1) Normalizar el texto: minúsculas + colapsar espacios. Facilita el matching.
  const norm = rawText.replace(/\t|\r/g, " ").replace(/[ ]{2,}/g, " ").toLowerCase();

  // 2) Extraer cada campo con su regla específica
  const amount = extractTotal(norm);
  const subtotal = extractSubtotal(norm);
  const tax = extractTax(norm);
  const pct = extractTaxPercentage(norm);

  // 3) Reconciliar: si subtotal o tax falta, lo deducimos del total
  const rec = reconcile(amount, subtotal, tax, pct);

  return {
    amount,
    subtotalAmount: rec.subtotal,
    taxAmount: rec.tax,
    taxPercentage: pct,
    date: extractDate(norm),
    invoiceNumber: extractInvoice(norm),
    vendorName: extractVendorName(rawText),       // se usa el texto original (mayúsculas importan)
    vendorIdentifications: extractVendorIds(norm),
    rawText,
  };
}

// ---------------------------------------------------------------------------
// parseAmount — convierte un string numérico a número, manejando formatos:
//   "1234.56"   → 1234.56
//   "1,234.56"  → 1234.56  (US)
//   "1.234,56"  → 1234.56  (EU/LATAM)
//   "1234"      → 1234
// Estrategia: el último separador (. o ,) que va seguido de 1-2 dígitos
// es el decimal. El otro separador es de miles y se elimina.
// ---------------------------------------------------------------------------
export function parseAmount(str: string): number | null {
  if (!str) return null;
  const cleaned = str.trim().replace(/\s/g, "");
  const lastSep = cleaned.match(/[,.](?=\d{1,2}$)/);

  let normalised: string;
  if (lastSep) {
    const dec = lastSep[0];
    const thousands = dec === "." ? "," : ".";
    normalised = cleaned.replace(new RegExp(`\\${thousands}`, "g"), "").replace(dec, ".");
  } else {
    normalised = cleaned.replace(/[,.]/g, "");
  }
  const n = parseFloat(normalised);
  return isFinite(n) ? n : null;
}

// Helper: probar varios patrones, devolver el primer match válido
function firstMatch(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const raw = m[2] ?? m[1];
      if (raw) return parseAmount(raw);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// TOTAL — Múltiples expresiones comunes en español/inglés
// ---------------------------------------------------------------------------
export function extractTotal(norm: string): number | null {
  return firstMatch(norm, [
    /total\s*a\s*pagar\s*[:\s]*\$?\s*([\d.,]+)/i,
    /importe\s*total\s*[:\s]*\$?\s*([\d.,]+)/i,
    /grand\s*total\s*[:\s]*\$?\s*([\d.,]+)/i,
    /amount\s*due\s*[:\s]*\$?\s*([\d.,]+)/i,
    /^total\s*[:\s=]\s*\$?\s*([\d.,]+)/im,
    /\btotal\b[^\n]{0,30}\$?\s*([\d.,]+)/i,
  ]);
}

// ---------------------------------------------------------------------------
// SUBTOTAL
// ---------------------------------------------------------------------------
export function extractSubtotal(norm: string): number | null {
  return firstMatch(norm, [
    /subtotal\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
    /sub\s*total\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
    /base\s*imponible\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
    /base\s*gravable\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
    /\bneto\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
  ]);
}

// ---------------------------------------------------------------------------
// IMPUESTO (monto)
// ---------------------------------------------------------------------------
export function extractTax(norm: string): number | null {
  return firstMatch(norm, [
    // "IVA 12%: 1.45" o "IVA (12%): 1.45"
    /(?:iva|igv|itbms|itbis|vat|tax|impuesto)\s*(?:\d{1,2}\s*%\s*)?\s*[:\s]\s*\$?\s*([\d.,]+)/i,
    /(?:iva|igv|itbms|itbis|vat|tax)\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
    /impuesto\s*[:\s=]\s*\$?\s*([\d.,]+)/i,
  ]);
}

// ---------------------------------------------------------------------------
// % DE IMPUESTO
// El (?<!\d) y (?!\d) evitan matchear "1%" dentro de "101%".
// ---------------------------------------------------------------------------
export function extractTaxPercentage(norm: string): number | null {
  const patterns = [
    /(?:iva|igv|itbms|itbis|vat|tax|impuesto)\s+(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i,
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:iva|igv|itbms|itbis|vat|tax|impuesto)/i,
    /(?<!\d)(\d{1,2}(?:[.,]\d{1,2})?)\s*%(?!\d)/i,
  ];
  for (const re of patterns) {
    const m = norm.match(re);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(",", "."));
      if (isFinite(v) && v > 0 && v <= 100) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// RECONCILIACIÓN — Si tenemos total + uno de {subtotal, tax, pct}, deducimos
// el faltante. Esto es lo que más mejora exactitud cuando el OCR falla en
// algún campo pero capta otros. Tolerancia 3% por errores de OCR.
// ---------------------------------------------------------------------------
const TOLERANCE = 0.03;
const near = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), 0.01) <= TOLERANCE;

export function reconcile(
  total: number | null,
  subtotal: number | null,
  tax: number | null,
  pct: number | null,
): { subtotal: number | null; tax: number | null } {
  if (total === null) return { subtotal, tax };

  // Caso 1: ambos presentes y consistentes → no tocar
  if (subtotal !== null && tax !== null && near(subtotal + tax, total)) return { subtotal, tax };

  // Caso 2: subtotal + pct → deducir tax
  if (subtotal !== null && pct !== null && tax === null) {
    const derived = +(subtotal * (pct / 100)).toFixed(2);
    if (near(subtotal + derived, total)) return { subtotal, tax: derived };
  }

  // Caso 3: tax presente, falta subtotal → subtotal = total - tax
  if (subtotal === null && tax !== null) {
    return { subtotal: +(total - tax).toFixed(2), tax };
  }

  // Caso 4: subtotal presente, falta tax → tax = total - subtotal
  if (tax === null && subtotal !== null) {
    const derived = +(total - subtotal).toFixed(2);
    if (derived >= 0) return { subtotal, tax: derived };
  }

  return { subtotal, tax };
}

// ---------------------------------------------------------------------------
// FECHA — soporta YYYY-MM-DD, DD-MM-YYYY, "15 de enero de 2024"
// Salida siempre normalizada a YYYY-MM-DD.
// ---------------------------------------------------------------------------
const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

export function extractDate(text: string): string | null {
  let m = text.match(/\b(\d{4})[\/\-.](\d{2})[\/\-.](\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = text.match(/\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = text.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/i,
  );
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NÚMERO DE FACTURA
// El (?:^|[^a-z]) evita matchear "no" dentro de "nothing"
// ---------------------------------------------------------------------------
export function extractInvoice(text: string): string | null {
  const patterns = [
    /(?:^|[^a-z])(?:factura|invoice|recibo|receipt|n[oº°]\.?|no\.?)\s*[:\-#\s]\s*([a-z0-9][-a-z0-9]{2,})/im,
    /(?:^|[^a-z])(?:comprobante|folio|ticket|ref)\s*[:\-#\s]\s*([a-z0-9][-a-z0-9]{2,})/im,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// NOMBRE DEL VENDOR
// Heurística: ignorar líneas-ruido (fecha, dirección, etc.) y preferir
// líneas que parezcan nombres de empresa (todo MAYÚSCULAS).
// ---------------------------------------------------------------------------
const NOISE = /^(fecha|date|tel|fax|www\.|http|email|@|dirección|address|ruc|nit|cif|iva|rif|total|subtotal|gracias|thank|page|pagina|\d)/i;

export function extractVendorName(raw: string): string | null {
  const lines = raw.split(/\n|\r/).map((l) => l.trim()).filter((l) => l.length > 2 && !NOISE.test(l));

  // Preferir línea en mayúsculas (típico de nombre de empresa) en las primeras 6
  for (const line of lines.slice(0, 6)) {
    if (/^[A-ZÁÉÍÓÚÑÜ\s&.,'\-]{4,80}$/.test(line)) return line.slice(0, 100);
  }
  return lines[0]?.slice(0, 100) ?? null;
}

// ---------------------------------------------------------------------------
// IDENTIFICACIONES TRIBUTARIAS — RUC, NIT, CIF, RIF, CUIT, EIN
// Se devuelven como strings tal como aparecen, normalizados a MAYÚSCULAS.
// ---------------------------------------------------------------------------
const ID_PATTERNS: RegExp[] = [
  /ruc\s*[:\-]?\s*([0-9]{1,3}-[0-9]{3,8}-[0-9]{1,2})/i,    // RUC Panamá
  /ruc\s*[:\-]?\s*([0-9]{6,12})/i,                         // RUC Perú
  /nit\s*[:\-]?\s*([0-9]{6,10}(?:-\d)?)/i,                 // NIT Colombia
  /cif\s*[:\-]?\s*([a-z]\d{7}[0-9a-z])/i,                  // CIF España
  /rif\s*[:\-]?\s*([a-z]-\d{8}-\d)/i,                      // RIF Venezuela
  /cuit\s*[:\-]?\s*([\d-]{10,13})/i,                       // CUIT Argentina
  /ein\s*[:\-]?\s*(\d{2}-\d{7})/i,                         // EIN USA
];

export function extractVendorIds(text: string): string[] {
  const ids: string[] = [];
  for (const re of ID_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) ids.push(m[1].trim().toUpperCase());
  }
  return [...new Set(ids)]; // sin duplicados
}
