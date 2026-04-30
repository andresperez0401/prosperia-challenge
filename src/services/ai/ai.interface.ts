import { ParsedReceipt } from "../../types/receipt.js";
import { TotalCandidate } from "../parsing/parser.js";

export interface AiProvider {
  structure(input: {
    rawText: string;
    reconstructedText?: string;
    partialFields?: Partial<ParsedReceipt>;
    warnings?: string[];
    totalCandidates?: TotalCandidate[];
    /** Key-value pairs found by label-matching rules (Emisor:, Cliente:, RUC:, etc.) */
    labeledFields?: Record<string, string>;
  }): Promise<Partial<ParsedReceipt>>;

  categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>>;
}
