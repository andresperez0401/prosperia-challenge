/** Supported currencies — limited to what the system actually handles */
export type SupportedCurrency = "VES" | "USD" | "EUR" | "COP" | "MXN" | "ARS" | "CLP" | "PAB" | "PEN";

export const VALID_CURRENCIES = new Set<string>(["VES", "USD", "EUR", "COP", "MXN", "ARS", "CLP", "PAB", "PEN"]);

export function detectCurrency(text: string, aiCur?: string | null): SupportedCurrency {
  if (!text) return sanitizeCurrency(aiCur) ?? "USD";

  // VES — "Bs"/"Bs." is unambiguous Venezuelan bolívar
  if (/\bBs\.?\s*[\d,.]|\bBs\b|\bVES\b/i.test(text)) return "VES";

  // Panama — ITBMS is Panama-specific tax; B/. is balboa notation
  if (/\bITBMS\b|\bB\/\.|\bPAB\b|Panam[aá]/i.test(text)) return "PAB";

  // Euro
  if (/€|\bEUR\b/.test(text)) return "EUR";

  // Explicit ISO codes
  if (/\bUSD\b|\bUS\$\b/.test(text)) return "USD";
  if (/\bMXN\b|M[eé]xico/i.test(text)) return "MXN";
  if (/\bCOP\b|Colombia/i.test(text)) return "COP";
  if (/\bARS\b|Argentina/i.test(text)) return "ARS";
  if (/\bCLP\b|Chile\b/i.test(text)) return "CLP";
  if (/\bPEN\b|S\/\.?\s?\d/i.test(text)) return "PEN";

  // $ alone is ambiguous — trust AI or default USD
  return sanitizeCurrency(aiCur) ?? "USD";
}

function sanitizeCurrency(cur: string | null | undefined): SupportedCurrency | null {
  if (!cur) return null;
  const upper = cur.toUpperCase().trim();
  return VALID_CURRENCIES.has(upper) ? (upper as SupportedCurrency) : null;
}
