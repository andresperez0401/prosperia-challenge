import { ParsedReceipt } from "../../../types/receipt.js";

/** Data available to all parsers */
export interface ParserContext {
  rawText: string;
  reconstructedText: string;
  lines: string[];
  tableRows: { label: string; value: string }[];
  ocrConfidence: number;
  mimeType: string;
}

export interface ParserResult {
  fields: Partial<ParsedReceipt>;
  parserName: string;
  warnings: string[];
}

/** All parsers implement this interface */
export interface ReceiptParser {
  /** Name of this parser for logging */
  name: string;

  /**
   * Check if this parser should be applied to this text.
   * Returns a score 0-1 indicating how likely this parser is relevant.
   * 0 = don't use, >0 = use with this priority.
   */
  detect(ctx: ParserContext): number;

  /** Parse the receipt and return extracted fields */
  parse(ctx: ParserContext): ParserResult;
}
