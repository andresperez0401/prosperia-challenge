import { OcrProvider } from "./ocr.interface.js";
import Tesseract from "tesseract.js";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export class TesseractOcr implements OcrProvider {
  // TODO: Implementar extracción de información con Tesseract
  async extractText({ filePath, mimeType }: { filePath: string; mimeType: string }) {
    try {
      if (mimeType === "application/pdf") {
        return await this.extractFromPdf(filePath);
      }
      return await this.extractFromImage(filePath);
    } catch (err) {
      console.error("Tesseract OCR failed:", err instanceof Error ? err.message : err);
      return { text: "", confidence: 0 };
    }
  }

  // ── Imagen → Tesseract con PSM 6 (bloque de texto uniforme = mejor para recibos)
  private async extractFromImage(filePath: string) {
    const worker = await Tesseract.createWorker("eng+spa");
    try {
      await worker.setParameters({
        // PSM 6: asume un único bloque de texto uniforme — ideal para facturas/recibos
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
        // Preservar espacios entre palabras para mantener columnas legibles
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(filePath);
      return {
        text: result.data?.text?.trim() || "",
        confidence: typeof result.data?.confidence === "number"
          ? result.data.confidence / 100
          : 0,
      };
    } finally {
      await worker.terminate();
    }
  }

  // ── PDF → primero intentamos capa de texto digital (rápido y exacto)
  private async extractFromPdf(filePath: string) {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
      b: Buffer,
    ) => Promise<{ text: string }>;
    const buffer = readFileSync(filePath);
    const { text } = await pdfParse(buffer);
    const cleaned = (text ?? "").trim();
    const confidence = cleaned.length >= 40 ? 0.9 : cleaned.length > 0 ? 0.5 : 0;
    return { text: cleaned, confidence };
  }
}
