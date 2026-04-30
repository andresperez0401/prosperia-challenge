/**
 * Normalize a date string to ISO YYYY-MM-DD format.
 * Supports:
 *   DD-MM-YYYY, DD/MM/YYYY
 *   YYYY-MM-DD, YYYY/MM/DD
 *   "04-11-2025", "04/11/2025"
 *   "5 de enero de 2024"
 */

const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
  ene: "01", feb: "02", mar: "03", abr: "04",
  jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12",
};

export function normalizeDate(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // Look for date near FECHA label first
  const fechaMatch = t.match(
    /fecha\s*:?\s*(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{4})/i,
  );
  if (fechaMatch) {
    const [, d, m, y] = fechaMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // YYYY-MM-DD
  let m = t.match(/\b(\d{4})[\/.-](\d{2})[\/.-](\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD-MM-YYYY or DD/MM/YYYY
  m = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  // "5 de enero de 2024"
  m = t.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/i,
  );
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }

  // Short month names: "5 ene 2024"
  m = t.match(
    /\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})\b/i,
  );
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }

  return null;
}
