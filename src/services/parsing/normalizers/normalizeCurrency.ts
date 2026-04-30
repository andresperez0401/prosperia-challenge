/**
 * Detect currency from receipt text.
 * Venezuelan receipts with "Bs" should NEVER return USD.
 */
export function normalizeCurrency(text: string, aiCur?: string | null): string {
  if (!text) return aiCur ?? "USD";

  const t = text;

  // Unambiguous signals — check these first
  if (/€/.test(t)) return "EUR";
  if (/\bEUR\b/.test(t)) return "EUR";
  if (/£/.test(t)) return "GBP";

  // Venezuelan Bolívares — Bs, Bs., Bolívares, VES, VEF
  if (/\bBs\.?\s*\d/i.test(t) || /\bBs\b/i.test(t)) return "VES";
  if (/\bVES\b/i.test(t)) return "VES";
  if (/\bVEF\b/i.test(t)) return "VES";
  if (/[Bb]ol[ií]var/i.test(t)) return "VES";

  // SENIAT → Venezuela
  if (/SENIAT/i.test(t)) return "VES";

  // Explicit USD
  if (/\bUSD\b|\bUS\$\b/.test(t)) return "USD";

  // LATAM currencies
  if (/\bMXN\b|México|Mexico/i.test(t)) return "MXN";
  if (/\bCOP\b|Colombia/i.test(t)) return "COP";
  if (/\bPEN\b|S\/\.?\s?\d/i.test(t)) return "PEN";
  if (/\bARS\b/i.test(t)) return "ARS";
  if (/\bCLP\b/i.test(t)) return "CLP";
  if (/\bPAB\b/i.test(t)) return "PAB";

  // $ alone is ambiguous — trust AI or default
  return aiCur ?? "USD";
}
