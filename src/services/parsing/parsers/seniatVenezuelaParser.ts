import { ParserContext, ParserResult, ReceiptParser } from "./parserInterface.js";
import { ParsedReceipt } from "../../../types/receipt.js";

export class SeniatVenezuelaParser implements ReceiptParser {
  name = "SeniatVenezuelaParser";

  detect(ctx: ParserContext): number {
    const text = ctx.rawText.toUpperCase();
    if (text.includes("SENIAT") || text.includes("PROVIDENCIA")) return 0.9;
    if (text.includes("RIF")) return 0.85;
    if (text.includes(" BS ") || text.includes(" BS.") || text.includes(" VES ")) return 0.7;
    return 0;
  }

  parse(ctx: ParserContext): ParserResult {
    const lines = ctx.lines;
    const fields: Partial<ParsedReceipt> = {};
    const warnings: string[] = [];

    // Lines that are NEVER the vendor (tax authority headers, noise)
    const NOT_VENDOR =
      /^(seniat|sentat|sen[il]at|providencia|administraci[oó]n|fiscal|repúblic|gobierno|impresor|impresora|ministerio|tribut|servicio\s+nac|nacional\s+int)/i;

    let vendorName: string | null = null;
    let rif: string | null = null;
    let invoiceNumber: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const upper = line.toUpperCase();

      // Extract first RIF found (vendor identification)
      if (!rif && /\bRIF\s*[:\-]?\s*[JGVE]/i.test(upper)) {
        const m = upper.match(/RIF\s*[:\-]?\s*([JGVE]-?\d{6,9}-?\d)/);
        if (m) {
          rif = m[1];
          // Normalise to J-NNNNNNN-D format
          const digits = rif.replace(/[^0-9]/g, "");
          const letter = rif[0].toUpperCase();
          if (digits.length >= 7) {
            rif = `${letter}-${digits.slice(0, -1)}-${digits.slice(-1)}`;
          }

          // Try to find vendor adjacent to the RIF line
          if (!vendorName) {
            for (const probe of [lines[i - 1], lines[i - 2], lines[i + 1], lines[i + 2]]) {
              if (!probe) continue;
              const candidate = probe.trim();
              if (candidate.length < 3 || candidate.length > 80) continue;
              if (NOT_VENDOR.test(candidate)) continue;
              if (/^RIF\b|^C\.?I\.?\b|^RAZ[OÓ]N|^FECHA|^FACTURA|^\d/i.test(candidate)) continue;
              if (/^[\d\s\.\-\/,]+$/.test(candidate)) continue;
              vendorName = candidate.replace(/[,;:.]+$/, "").trim();
              break;
            }
          }
        }
      }

      // Extract invoice number after FACTURA keyword
      if (!invoiceNumber && upper.includes("FACTURA")) {
        const m = upper.match(/FACTURA\s*(?:NRO\.?|NO\.?|N[°O]\.?|#|:)?\s*([A-Z0-9][A-Z0-9\-]{3,18})/);
        if (m && !["FECHA", "SERIE", "DATE", "INVOICE"].includes(m[1])) {
          invoiceNumber = m[1];
        }
      }
    }

    // Fallback: if vendor not found near RIF, scan the top of the receipt
    if (!vendorName) {
      for (const line of lines.slice(0, 7)) {
        const candidate = line.trim();
        if (candidate.length < 3 || candidate.length > 80) continue;
        if (NOT_VENDOR.test(candidate)) continue;
        if (/^RIF\b|^C\.?I\.?\b|^RAZ[OÓ]N|^FECHA|^FACTURA|^SENIAT|^\d/i.test(candidate)) continue;
        if (/^[\d\s\.\-\/,()]+$/.test(candidate)) continue;
        vendorName = candidate.replace(/[,;:.]+$/, "").trim();
        break;
      }
    }

    if (vendorName) fields.vendorName = vendorName;
    if (rif) fields.vendorIdentifications = [rif];
    if (invoiceNumber) fields.invoiceNumber = invoiceNumber;
    fields.currency = "VES";

    return { fields, parserName: this.name, warnings };
  }
}
