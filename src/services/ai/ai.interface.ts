import { ParsedReceipt } from "../../types/receipt.js";
import { TotalCandidate, AmountCandidate } from "../parsing/parser.js";

export interface AccountOption {
  id: number;
  name: string;
  type: string;
}

export interface ClassifiedId {
  value: string;
  /** Section the ID was found in (vendor block / customer block / unknown) */
  section: "vendor" | "customer" | "unknown";
  label: string;
}

export interface StructureInput {
  rawText: string;
  reconstructedText?: string;
  /** Fields already extracted by deterministic rules — used as hints */
  partialFields?: Partial<ParsedReceipt>;
  warnings?: string[];
  /** All candidate lines for the final amount (with role hints) */
  totalCandidates?: TotalCandidate[];
  /** Subtotal candidates (Total Neto, Subtotal, Base Imponible, etc.) */
  subtotalCandidates?: AmountCandidate[];
  /** Tax candidates (IVA, ITBMS, VAT, IGV, Impuesto, etc.) */
  taxCandidates?: AmountCandidate[];
  /** Key-value pairs found by label-matching rules (Emisor:, Cliente:, RUC:, etc.) */
  labeledFields?: Record<string, string>;
  /** Plausible vendor names (top-of-receipt + labeled values) */
  vendorCandidates?: string[];
  /** Plausible customer names (labeled values + Razón Social in customer block) */
  customerCandidates?: string[];
  /** Tax IDs detected, classified by which section they appeared in */
  identifications?: ClassifiedId[];
  /** Available chart-of-accounts the AI may pick from for categorization */
  accounts?: AccountOption[];
  /**
   * Label/value pairs detected by reconstructLayout from word positions
   * (e.g. "TOTAL    15212.97" or "Cliente: Juan"). Pre-aligned hints that
   * help the AI confirm noisy raw text.
   */
  tableRows?: { label: string; value: string }[];
}

/** Pipeline metadata attached by FallbackAiProvider — read by receipts.service. */
export interface AiStructureMeta {
  _aiProviderUsed?: string;
  _aiWarnings?: string[];
}

export type AiStructureResult = Partial<ParsedReceipt> & AiStructureMeta;

export interface AiProvider {
  /**
   * Single AI call that performs structuring AND categorization.
   * Returns a ParsedReceipt-shaped object including `category` (Account.id) when
   * the model can pick a valid account from the supplied `accounts` list.
   */
  structure(input: StructureInput): Promise<AiStructureResult>;

  /** @deprecated kept for backward compatibility — categorization now lives inside `structure`. */
  categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>>;
}
