import { OcrProvider } from "./ocr.interface.js";
import Tesseract from "tesseract.js";
import { readFileSync } from "fs";

export class TesseractOcr implements OcrProvider {
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

  // ── Imagen → primero PSM SINGLE_BLOCK (recibos impresos limpios).
  //    Si la confianza es baja o el texto es corto (recibo manuscrito o de
  //    baja calidad), reintenta con SPARSE_TEXT y elige el mejor resultado.
  private async extractFromImage(filePath: string) {
    const primary = await this.runTesseract(filePath, Tesseract.PSM.SINGLE_BLOCK);
    if (primary.confidence >= 0.7 && primary.text.length >= 50) return primary;

    const sparse = await this.runTesseract(filePath, Tesseract.PSM.SPARSE_TEXT);
    // Score combinado: confianza ponderada por cantidad de texto extraído
    const score = (r: { text: string; confidence: number }) =>
      r.confidence * Math.log(Math.max(r.text.length, 1));
    return score(sparse) > score(primary) ? sparse : primary;
  }

  private async runTesseract(filePath: string, psm: Tesseract.PSM) {
    const worker = await Tesseract.createWorker("eng+spa");
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
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

  // ── PDF → extrae capa de texto digital con pdf-parse v2 (rápido y exacto)
  private async extractFromPdf(filePath: string) {
    const { PDFParse } = await import("pdf-parse");
    const buffer = readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    const confidence = text.length >= 40 ? 0.9 : text.length > 0 ? 0.5 : 0;
    return { text, confidence };
  }
}
