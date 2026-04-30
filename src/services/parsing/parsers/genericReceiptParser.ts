import { ParserContext, ParserResult, ReceiptParser } from "./parserInterface.js";
import { naiveParse } from "../parser.js";

export class GenericReceiptParser implements ReceiptParser {
  name = "GenericReceiptParser";

  detect(ctx: ParserContext): number {
    return 1.0;
  }

  parse(ctx: ParserContext): ParserResult {
    const { rawText, reconstructedText } = ctx;
    const textToUse = reconstructedText || rawText;
    
    const fields = naiveParse(textToUse);

    return {
      fields,
      parserName: this.name,
      warnings: [],
    };
  }
}
