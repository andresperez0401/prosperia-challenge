export type Item = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  category: number | null; // Account.id
};


export type ParsedReceipt = {
  amount: number | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  taxPercentage: number | null;
  type: "expense" | "income";
  currency: string | null; // ISO 4217
  date: string | null; // YYYY-MM-DD
  paymentMethod: "CARD" | "CASH" | "TRANSFER" | "OTHER" | null;
  description: string | null;
  invoiceNumber: string | null;
  category: number | null; // Account.id
  vendorId: number | null;
  vendorName?: string | null;
  vendorIdentifications?: string[];
  customerName?: string | null;
  customerIdentifications?: string[];
  ocrConfidence?: number | null;
  items: Item[];
  rawText: string;

  // Extended fields
  documentType?: string | null;
  localeHint?: string | null;
  rawDetectedFields?: Record<string, unknown>;
  extraFields?: Record<string, string | number>;
  categoryName?: string | null;
  categoryType?: string | null;
  recommendedAccountId?: number | null;
  recommendedAccountName?: string | null;
  parserUsed?: string;
  warnings?: string[];
};

/** OCR word with position data */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** OCR line with position data */
export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Extended OCR result */
export interface OcrResult {
  text: string;
  confidence: number;
  lines: OcrLine[];
  words: OcrWord[];
  rawTsv?: string;
  selectedVariant?: string;
  selectedPsm?: number;
}
