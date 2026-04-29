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
};
