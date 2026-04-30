// ===========================================================================
// normalizeAmount — Convierte strings de montos a números
// ---------------------------------------------------------------------------
// Soporta formatos:
//   "15.212,97"   → 15212.97  (EU/LATAM: punto=miles, coma=decimal)
//   "1,234.56"    → 1234.56   (US: coma=miles, punto=decimal)
//   "Bs 9.652,21" → 9652.21   (con prefijo moneda)
//   "Bs-3.109,70" → -3109.70  (negativo)
//   "1200,50"     → 1200.50   (sin separador de miles)
//   "15,2\n12,97" → 15212.97  (OCR split across lines)
// ===========================================================================

/**
 * Normaliza un string de monto a número.
 * Maneja formatos venezolanos, europeos y americanos.
 */
export function normalizeAmount(input: string | null | undefined): number | null {
  if (!input || typeof input !== "string") return null;

  // Limpiar: quitar símbolos de moneda, espacios extra
  let s = input
    .replace(/\b[Bb][Ss]\.?\s*/g, "") // quitar Bs / Bs.
    .replace(/[$€£¥]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Si está vacío después de limpiar
  if (!s || !/\d/.test(s)) return null;

  // Detectar signo negativo
  const isNeg = /^-|^−/.test(s) || (s.includes("-") && !s.match(/\d-\d/));
  s = s.replace(/^[-−\s]+/, "").replace(/[-−]/g, "");

  // Contar separadores para decidir formato
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;

  let normalised: string;

  if (dots > 0 && commas > 0) {
    // Ambos separadores presentes
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");

    if (lastComma > lastDot) {
      // Formato EU/LATAM: 1.234,56 → punto es miles, coma es decimal
      normalised = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Formato US: 1,234.56 → coma es miles, punto es decimal
      normalised = s.replace(/,/g, "");
    }
  } else if (commas > 0 && dots === 0) {
    // Solo comas
    if (commas === 1) {
      // Verificar si la coma es decimal o miles
      const afterComma = s.split(",")[1];
      if (afterComma && afterComma.length <= 2) {
        // "1234,56" → decimal
        normalised = s.replace(",", ".");
      } else if (afterComma && afterComma.length === 3) {
        // "1,000" → miles (ambiguo, pero 3 dígitos = miles)
        normalised = s.replace(",", "");
      } else {
        normalised = s.replace(",", ".");
      }
    } else {
      // Múltiples comas → miles separator: "1,000,000"
      normalised = s.replace(/,/g, "");
    }
  } else if (dots > 0 && commas === 0) {
    // Solo puntos
    if (dots === 1) {
      const afterDot = s.split(".")[1];
      if (afterDot && afterDot.length <= 2) {
        // "1234.56" → decimal
        normalised = s;
      } else if (afterDot && afterDot.length === 3) {
        // "1.000" → miles
        normalised = s.replace(".", "");
      } else {
        normalised = s;
      }
    } else {
      // Múltiples puntos → miles: "1.000.000"
      normalised = s.replace(/\./g, "");
    }
  } else {
    normalised = s;
  }

  // Limpiar cualquier carácter no numérico restante (excepto punto decimal)
  normalised = normalised.replace(/[^\d.]/g, "");

  const n = parseFloat(normalised);
  if (!isFinite(n)) return null;

  return isNeg ? -n : n;
}

/**
 * Intenta reconstruir un monto que fue partido por OCR en múltiples líneas.
 * Ej: "Bs 15,2" + "12,97" → "15212,97" → 15212.97
 *
 * Esto es común en tickets donde el OCR corta la línea justo en medio del número.
 */
export function reconstructSplitAmount(line1: string, line2: string): number | null {
  // Extraer dígitos y separadores del final de line1
  const tail = line1.match(/(\d[\d.,]*)\s*$/);
  // Extraer dígitos y separadores del inicio de line2
  const head = line2.match(/^\s*(\d[\d.,]*)/);

  if (!tail || !head) return null;

  // Concatenar las partes numéricas
  const combined = tail[1] + head[1];
  return normalizeAmount(combined);
}

/**
 * Extrae un monto de un texto que puede contener prefijos como "Bs", "$", etc.
 * Devuelve el primer monto encontrado.
 */
export function extractAmountFromText(text: string): number | null {
  // Patrón para encontrar montos con formato venezolano/europeo/americano
  const m = text.match(
    /[Bb][Ss]\.?\s*[-−]?\s*([\d.,]+)|[$€£]\s*[-−]?\s*([\d.,]+)|[-−]?\s*(\d+[.,][\d.,]*)/,
  );
  if (!m) return null;
  const raw = m[1] || m[2] || m[3];
  return normalizeAmount(raw);
}

/**
 * Parse a Venezuelan-format amount string.
 * Specifically handles: dot=thousands, comma=decimal.
 * E.g.: "15.212,97" → 15212.97
 *        "9.652,21" → 9652.21
 *        "2.098,34" → 2098.34
 */
export function parseVenezuelanAmount(input: string): number | null {
  if (!input) return null;

  let s = input
    .replace(/\b[Bb][Ss]\.?\s*/g, "")
    .replace(/[$€£¥]/g, "")
    .trim();

  if (!s || !/\d/.test(s)) return null;

  const isNeg = /^[-−]/.test(s);
  s = s.replace(/^[-−\s]+/, "");

  // Venezuelan format: dots are thousands, comma is decimal
  // Remove dots, replace comma with period
  const normalised = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalised);
  if (!isFinite(n)) return null;

  return isNeg ? -n : n;
}
