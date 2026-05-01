import { ParserContext, ParserResult, ReceiptParser } from "./parserInterface.js";
import { ParsedReceipt } from "../../../types/receipt.js";
import { normalizeAmount } from "../normalizers/normalizeAmount.js";

export class PanamaDgiParser implements ReceiptParser {
  name = "PanamaDgiParser";

  detect(ctx: ParserContext): number {
    const t = ctx.rawText;
    if (/dgi-fep\.mef\.gob\.pa/i.test(t)) return 0.97;
    if (/\bITBMS\b/.test(t) && /Emisor\s*:/i.test(t)) return 0.95;
    if (/\bITBMS\b/.test(t) && /\bRUC\s*:/i.test(t)) return 0.85;
    if (/Comprobante Auxiliar de Factura Electr[oó]nica/i.test(t)) return 0.90;
    return 0;
  }

  parse(ctx: ParserContext): ParserResult {
    const text = ctx.rawText;
    const fields: Partial<ParsedReceipt> = {};
    const extraFields: Record<string, string | number> = {};
    const warnings: string[] = [];

    // Split text at customer boundary to avoid mixing vendor/customer IDs
    const customerBoundaryRe = /(?:Tipo de Receptor|Cliente\s*:)/i;
    const parts = text.split(customerBoundaryRe);
    const emisorSection = parts[0] ?? text;
    const afterEmisor = parts.slice(1).join("\n");

    // ── Vendor (Emisor) ──────────────────────────────────────────────────────
    const emisorMatch = text.match(/Emisor\s*:\s*(.+)/i);
    if (emisorMatch) fields.vendorName = emisorMatch[1].trim();

    const rucEmisor = emisorSection.match(/RUC\s*:\s*([\d\-]+)/i);
    if (rucEmisor) fields.vendorIdentifications = [rucEmisor[1].trim()];

    const dvEmisor = emisorSection.match(/DV\s*:\s*(\d+)/i);
    if (dvEmisor) extraFields["DV Emisor"] = dvEmisor[1];

    const dirEmisor = emisorSection.match(/Direcci[oó]n\s*:\s*(.+)/i);
    if (dirEmisor) extraFields["Dirección Emisor"] = dirEmisor[1].trim();

    // ── Customer (Receptor) ──────────────────────────────────────────────────
    const clienteMatch = text.match(/Cliente\s*:\s*(.+)/i);
    if (clienteMatch) fields.customerName = clienteMatch[1].trim();

    const rucCliente = afterEmisor.match(/RUC\/C[eé]dula\/Pasaporte\s*:\s*([\d\-\.]+)/i);
    if (rucCliente) fields.customerIdentifications = [rucCliente[1].trim()];

    const dirCliente = afterEmisor.match(/Direcci[oó]n\s*:\s*(.+)/i);
    if (dirCliente) extraFields["Dirección Cliente"] = dirCliente[1].trim();

    // ── Invoice number ───────────────────────────────────────────────────────
    const numMatch = text.match(/N[úu]mero\s*:\s*(\d+)/i);
    if (numMatch) {
      // Remove leading zeros but keep at least one digit
      fields.invoiceNumber = numMatch[1].replace(/^0+(?=\d)/, "");
    }

    // ── Date: "Fecha de Emisión: DD/MM/YYYY" ─────────────────────────────────
    const dateMatch = text.match(/Fecha de Emisi[óo]n\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dateMatch) fields.date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

    // ── Financial fields ─────────────────────────────────────────────────────
    // Total Neto = net subtotal (before ITBMS)
    const netoMatch = text.match(/Total Neto\s*[:\|]?\s*([\d,\.]+)/i);
    if (netoMatch) {
      const v = normalizeAmount(netoMatch[1]);
      if (v !== null) fields.subtotalAmount = v;
    }

    // ITBMS = tax amount (standalone "ITBMS   387.81" line, not "Monto Gravado ITBMS")
    const itbmsLineMatch = text.match(/^ITBMS\s+([\d,\.]+)\s*$/im);
    if (itbmsLineMatch) {
      const v = normalizeAmount(itbmsLineMatch[1]);
      if (v !== null) fields.taxAmount = v;
    }
    // Fallback: "Total Impuesto"
    if (fields.taxAmount === undefined || fields.taxAmount === null) {
      const impuestoMatch = text.match(/Total Impuesto\s*[:\|]?\s*([\d,\.]+)/i);
      if (impuestoMatch) {
        const v = normalizeAmount(impuestoMatch[1]);
        if (v !== null) fields.taxAmount = v;
      }
    }

    // Amount: "TOTAL PAGADO" is most explicit. Allow newline between label and value
    // (handles OCR where amount lands on the next line).
    const pagadoMatch = text.match(/TOTAL\s+PAGADO[\s:|]*([\d,\.]+)/i);
    if (pagadoMatch) {
      const v = normalizeAmount(pagadoMatch[1]);
      if (v !== null) fields.amount = v;
    } else {
      // Last standalone "Total" line — must NOT be Total Neto / Total Impuesto / Total ITBMS
      const totalMatch = text.match(/^Total\s+([\d,\.]+)\s*$/im);
      if (totalMatch) {
        const v = normalizeAmount(totalMatch[1]);
        if (v !== null) fields.amount = v;
      }
    }
    // If amount still unknown but TOTAL PAGADO is present, fall back to the
    // amount on a "Forma de Pago" line (Tarjeta de Crédito / Efectivo / Transf).
    if (fields.amount == null && /TOTAL\s+PAGADO/i.test(text)) {
      const payLine = text.match(
        /(?:Tarjeta de (?:Cr[eé]dito|D[eé]bito)|Efectivo|Transf\.?(?:\s*\/\s*Dep[oó]sito[^\n]*)?)\s*[:\|]?\s*([\d,\.]+)/i,
      );
      if (payLine) {
        const v = normalizeAmount(payLine[1]);
        if (v !== null && v > 0) fields.amount = v;
      }
    }

    // Derive taxPercentage from ITBMS breakdown if possible
    // "Monto Gravado ITBMS X" and "ITBMS Y" → pct = Y/X*100
    const gravadoMatch = text.match(/Monto Gravado ITBMS\s+([\d,\.]+)/i);
    if (gravadoMatch && fields.taxAmount != null && fields.taxAmount > 0) {
      const gravado = normalizeAmount(gravadoMatch[1]);
      if (gravado && gravado > 0) {
        fields.taxPercentage = Math.round((fields.taxAmount / gravado) * 100 * 10) / 10;
      }
    }
    if (fields.taxAmount === 0) fields.taxPercentage = 0;

    // Currency: Panama always PAB
    fields.currency = "PAB";

    // ── Payment method ────────────────────────────────────────────────────────
    if (/Tarjeta de Cr[eé]dito|Tarjeta de D[eé]bito/i.test(text)) fields.paymentMethod = "CARD";
    else if (/Transf\b|Dep[oó]sito|transferencia/i.test(text)) fields.paymentMethod = "TRANSFER";
    else if (/efectivo|cash/i.test(text)) fields.paymentMethod = "CASH";

    // ── Extra fields ──────────────────────────────────────────────────────────
    const cufeMatch = text.match(/CUFE\s*:\s*([A-Za-z0-9\-]+)/i);
    if (cufeMatch) extraFields["CUFE"] = cufeMatch[1].slice(0, 40);

    const protMatch = text.match(/Protocolo de autorizaci[oó]n\s*:\s*([\d]+)/i);
    if (protMatch) extraFields["Protocolo de autorización"] = protMatch[1];

    const puntoMatch = text.match(/Punto de Facturaci[oó]n\s*:\s*(\d+)/i);
    if (puntoMatch) extraFields["Punto de Facturación"] = puntoMatch[1];

    // ITBMS desglose summary for extra context
    const exentoMatch = text.match(/Monto Exento ITBMS\s+([\d,\.]+)/i);
    if (exentoMatch) {
      const v = normalizeAmount(exentoMatch[1]);
      if (v !== null && v > 0) extraFields["Monto Exento ITBMS"] = v;
    }

    if (/dgi-fep\.mef\.gob\.pa/i.test(text)) extraFields["Validación DGI"] = "dgi-fep.mef.gob.pa";

    if (Object.keys(extraFields).length > 0) fields.extraFields = extraFields;

    // Validate: warn if amount doesn't reconcile.
    // If tax=0 (exento) and subtotal disagrees with amount, prefer amount (TOTAL PAGADO is the
    // most reliable source; "Total Neto" can be OCR-corrupted in scanned receipts).
    if (fields.amount != null && fields.subtotalAmount != null && fields.taxAmount != null) {
      const expected = Math.round((fields.subtotalAmount + fields.taxAmount) * 100);
      const actual = Math.round(fields.amount * 100);
      if (Math.abs(expected - actual) > 5) {
        warnings.push(`Reconciliation: subtotal(${fields.subtotalAmount}) + tax(${fields.taxAmount}) ≠ total(${fields.amount})`);
        if (fields.taxAmount === 0) {
          fields.subtotalAmount = fields.amount;
        }
      }
    }

    return { fields, parserName: this.name, warnings };
  }
}
