import { ParsedReceipt } from "../../types/receipt.js";

export interface AiProvider {
  structure(input: {
    rawText: string;
    reconstructedText?: string;
    partialFields?: Partial<ParsedReceipt>;
    warnings?: string[];
  }): Promise<Partial<ParsedReceipt>>;
  
  categorize(input: { 
    rawText: string; 
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>>;
}
