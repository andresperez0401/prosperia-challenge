import { OcrProvider } from "./ocr.interface.js";
import { OcrResult } from "../../types/receipt.js";

export class MockOcr implements OcrProvider {
  async extractText(): Promise<OcrResult> {
    return {
      text: "TOTAL: 12.34\nIVA 7%: 0.81\nFactura: ABC-123\nFecha: 2024-06-01\nUber BV RUC 12345678-9",
      confidence: 0.9,
      lines: [],
      words: [],
    };
  }
}
