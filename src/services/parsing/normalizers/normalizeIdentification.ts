/**
 * Normalize Venezuelan-style identification numbers.
 * RIF: J-505056603 → J-505056603
 * C.I.: V26324525 → V-26324525
 */

export interface IdentificationResult {
  type: "RIF" | "CI" | "NIT" | "RUC" | "CIF" | "CUIT" | "EIN" | "UNKNOWN";
  value: string;
  role: "vendor" | "customer" | "unknown";
}

/**
 * Extract and classify all identifications from raw text.
 * Distinguishes vendor RIF (top of receipt) from customer CI/RIF.
 */
export function extractIdentifications(rawText: string): IdentificationResult[] {
  const results: IdentificationResult[] = [];
  const lines = rawText.split(/\n|\r/).map((l) => l.trim());

  // Track if we found customer block
  let inCustomerBlock = false;
  let vendorRifFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Detect customer block
    if (/rif\s*\/?\s*c\.?\s*i\.?\s*:?/i.test(line) ||
        /cliente/i.test(line) ||
        /facturado\s*a/i.test(line)) {
      inCustomerBlock = true;
    }

    // RIF pattern: J-505056603, G-123456789, etc.
    const rifMatch = line.match(/RIF\s*:?\s*([JGVEP]-?\d{7,9}(?:-\d)?)/i);
    if (rifMatch) {
      const value = normalizeRif(rifMatch[1]);
      const role = !vendorRifFound && !inCustomerBlock ? "vendor" : "customer";
      if (role === "vendor") vendorRifFound = true;
      results.push({ type: "RIF", value, role });
      continue;
    }

    // Standalone RIF without label (common after SENIAT header)
    const standaloneRif = line.match(/^([JGVEP])-?(\d{7,9})(?:-(\d))?$/i);
    if (standaloneRif) {
      const value = normalizeRif(standaloneRif[0]);
      const role = !vendorRifFound && !inCustomerBlock ? "vendor" : "customer";
      if (role === "vendor") vendorRifFound = true;
      results.push({ type: "RIF", value, role });
      continue;
    }

    // C.I. pattern: V26324525, V-26324525
    const ciMatch = line.match(/(?:C\.?\s*I\.?\s*:?\s*|RIF\s*\/\s*C\.?\s*I\.?\s*:?\s*)([VE]-?\d{6,10})/i);
    if (ciMatch) {
      const value = normalizeCi(ciMatch[1]);
      results.push({ type: "CI", value, role: "customer" });
      continue;
    }

    // NIT Colombia: 900123456-1
    const nitMatch = lower.match(/nit\s*:?\s*([\d.]{6,15}(?:-\d)?)/);
    if (nitMatch) {
      results.push({
        type: "NIT",
        value: nitMatch[1].replace(/\./g, "").toUpperCase(),
        role: !vendorRifFound ? "vendor" : "customer",
      });
      if (!vendorRifFound) vendorRifFound = true;
    }

    // RUC
    const rucMatch = lower.match(/ruc\s*:?\s*(\d{1,3}(?:-\d{3,8}(?:-\d{1,2})?)?|\d{6,12})/);
    if (rucMatch) {
      results.push({
        type: "RUC",
        value: rucMatch[1].toUpperCase(),
        role: !vendorRifFound ? "vendor" : "customer",
      });
      if (!vendorRifFound) vendorRifFound = true;
    }
  }

  return results;
}

function normalizeRif(raw: string): string {
  // Ensure format: X-NNNNNNNNN
  const m = raw.match(/([JGVEP])-?(\d{7,9})(?:-?(\d))?/i);
  if (!m) return raw.toUpperCase();
  const letter = m[1].toUpperCase();
  const digits = m[2];
  const check = m[3] || "";
  return check ? `${letter}-${digits}-${check}` : `${letter}-${digits}`;
}

function normalizeCi(raw: string): string {
  const m = raw.match(/([VE])-?(\d{6,10})/i);
  if (!m) return raw.toUpperCase();
  return `${m[1].toUpperCase()}-${m[2]}`;
}
