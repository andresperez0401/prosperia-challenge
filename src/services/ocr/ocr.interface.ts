import { OcrResult } from "../../types/receipt.js";

export interface OcrProvider {
  extractText(input: {
    filePath: string;
    mimeType: string;
  }): Promise<OcrResult>;
}
