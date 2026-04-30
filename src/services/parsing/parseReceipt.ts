import { ParsedReceipt } from "../../types/receipt.js";
import { ParserContext, ParserResult } from "./parsers/parserInterface.js";
import { GenericReceiptParser } from "./parsers/genericReceiptParser.js";
import { SeniatVenezuelaParser } from "./parsers/seniatVenezuelaParser.js";
import { logger } from "../../config/logger.js";

const generic = new GenericReceiptParser();
const seniat = new SeniatVenezuelaParser();

/**
 * Parse a receipt:
 *   1. Always run the generic parser to get base fields.
 *   2. If SENIAT/Venezuela markers are detected, overlay specialized fields on top.
 */
export function parseReceipt(ctx: ParserContext): ParserResult {
  logger.info({ msg: "parseReceipt: start", mimeType: ctx.mimeType, textLength: ctx.rawText.length });

  const baseResult = generic.parse(ctx);
  const merged: Partial<ParsedReceipt> = { ...baseResult.fields };
  const warnings = [...baseResult.warnings];
  let parserName = baseResult.parserName;

  if (seniat.detect(ctx) > 0.5) {
    const sp = seniat.parse(ctx);
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
