import { OcrProvider } from "./ocr.interface.js";
import Tesseract from "tesseract.js";
import { readFileSync } from "fs";
import { createRequire } from "module";

// CommonJS interop: pdf-parse ejecuta un test en su index al ser importado en ESM,
// por eso lo cargamos con createRequire apuntando al archivo interno.
const require = createRequire(import.meta.url);

export class TesseractOcr implements OcrProvider {
  // TODO: Implementar extracción de información con Tesseract
  // Implementación: detectar tipo de archivo (imagen/PDF) y delegar al método correcto.
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

  // ── Imagen → Tesseract directo (eng + spa) ─────────────────────────────────
  private async extractFromImage(filePath: string) {
    const result = await Tesseract.recognize(filePath, "eng+spa");
    return {
      text: result.data?.text?.trim() || "",
      confidence: typeof result.data?.confidence === "number" ? result.data.confidence / 100 : 0,
    };
  }

  // ── PDF → primero intentamos capa de texto (rápido y exacto) ───────────────
  // Si el PDF es escaneado (imagen) y no tiene capa de texto, devolvemos lo que haya.
  private async extractFromPdf(filePath: string) {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (b: Buffer) => Promise<{ text: string }>;
    const buffer = readFileSync(filePath);
    const { text } = await pdfParse(buffer);
    const cleaned = (text ?? "").trim();

    // Confianza alta si encontramos capa de texto, baja si está vacío
    const confidence = cleaned.length >= 40 ? 0.9 : cleaned.length > 0 ? 0.5 : 0;
    return { text: cleaned, confidence };
  }
}
