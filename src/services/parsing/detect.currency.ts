export function detectCurrency(text: string, aiCur?: string | null) {
    if (!text) return aiCur ?? "USD";
    if (/€/.test(text)) return "EUR";
    if (/\bEUR\b/.test(text)) return "EUR";
    if (/£/.test(text)) return "GBP";
    if (/\bUSD\b|\bUS\$\b/.test(text)) return "USD";
    if (/\bMXN\b|México|Mexico/i.test(text)) return "MXN";
    if (/\bCOP\b|Colombia/i.test(text)) return "COP";
    if (/\bPEN\b|S\/\.?\s?\d/i.test(text)) return "PEN";
    // $ solo es ambiguo — confiar en la IA o defaultear USD
    return aiCur ?? "USD";
  }