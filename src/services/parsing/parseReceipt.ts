import { ParsedReceipt } from "../../types/receipt.js";
import { ParserContext, ParserResult } from "./parsers/parserInterface.js";
import { GenericReceiptParser } from "./parsers/genericReceiptParser.js";
import { SeniatVenezuelaParser } from "./parsers/seniatVenezuelaParser.js";
import { PanamaDgiParser } from "./parsers/panamaDgiParser.js";
import { logger } from "../../config/logger.js";

const generic = new GenericReceiptParser();
const seniat = new SeniatVenezuelaParser();
const panamaDgi = new PanamaDgiParser();

/** Specialized parsers checked in order — first with score > 0.5 wins overlay */
const SPECIALIZED = [panamaDgi, seniat];

/**
 * Parse a receipt:
 *   1. Always run the generic parser to get base fields.
 *   2. Check specialized parsers; highest-confidence one overlays its fields.
 */
export function parseReceipt(ctx: ParserContext): ParserResult {
  logger.info({ msg: "parseReceipt: start", mimeType: ctx.mimeType, textLength: ctx.rawText.length });

  const baseResult = generic.parse(ctx);
  const merged: Partial<ParsedReceipt> = { ...baseResult.fields };
  const warnings = [...baseResult.warnings];
  let parserName = baseResult.parserName;

  // Pick the highest-confidence specialized parser (if any)
  let bestScore = 0;
  let bestParser = null as typeof SPECIALIZED[0] | null;
  for (const sp of SPECIALIZED) {
    const score = sp.detect(ctx);
    if (score > bestScore) { bestScore = score; bestParser = sp; }
  }

  if (bestParser && bestScore > 0.5) {
    const sp = bestParser.parse(ctx);
    parserName += ` + ${sp.parserName}`;
    warnings.push(...sp.warnings);
    for (const key of Object.keys(sp.fields) as (keyof ParsedReceipt)[]) {
      const v = sp.fields[key];
      if (v !== null && v !== undefined) {
        // @ts-ignore
        merged[key] = v;
      }
    }
  }

  const finalFields: Partial<ParsedReceipt> = {
    amount: merged.amount ?? null,
    subtotalAmount: merged.subtotalAmount ?? null,
    taxAmount: merged.taxAmount ?? null,
    taxPercentage: merged.taxPercentage ?? null,
    date: merged.date ?? null,
    invoiceNumber: merged.invoiceNumber ?? null,
    vendorName: merged.vendorName ?? null,
    vendorIdentifications: merged.vendorIdentifications ?? [],
    customerName: merged.customerName ?? null,
    customerIdentifications: merged.customerIdentifications ?? [],
    paymentMethod: merged.paymentMethod ?? null,
    currency: merged.currency ?? null,
    items: merged.items ?? [],
    type: merged.type ?? "expense",
  };

  return {
    fields: finalFields,
    parserName,
    warnings,
  };
}
