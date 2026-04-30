import { OcrProvider } from "./ocr.interface.js";
import { OcrResult, OcrWord, OcrLine } from "../../types/receipt.js";
import Tesseract from "tesseract.js";
import { logger } from "../../config/logger.js";
import { preprocessImage } from "../image/preprocessImage.js";

const RE_AMOUNTS = /\d{1,3}(?:[.,]\d{3})*[.,]\d{2}/g;
const RE_KEYWORDS = /\b(TOTAL|SUBTOTAL|IVA|TAX|FACTURA|INVOICE|RECIBO|RECEIPT|MONTO|AMOUNT|IMPUESTO|RIF|RUC|NIT|CIF|VAT)\b/gi;
const RE_IDENTIFICATIONS = /\b(RIF|RUC|NIT|CIF|VAT|NIF|CUIT|CNPJ|RFC)\b/gi;

// Reuse a single Tesseract worker across requests — creating one costs ~1s.
let workerPromise: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const langPath = process.env.TESSDATA_DIR ?? ".";
      const w = await Tesseract.createWorker("eng+spa", 1, {
        langPath,
        cacheMethod: "readOnly",
      });
      await w.setParameters({
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return w;
    })();
  }
  return workerPromise;
}

export async function shutdownTesseract() {
  if (workerPromise) {
    const w = await workerPromise;
    workerPromise = null;
    await w.terminate().catch(() => {});
  }
}

export class TesseractOcr implements OcrProvider {
  async extractText({
    filePath,
    mimeType,
  }: {
    filePath: string;
    mimeType: string;
  }): Promise<OcrResult> {
    try {
      if (mimeType === "application/pdf") {
        logger.warn("TesseractOcr: received PDF — must be converted to images first");
        return { text: "", confidence: 0, lines: [], words: [] };
      }

      logger.info({ msg: "OCR: starting", file: filePath });

      const variants = await preprocessImage(filePath, mimeType).catch((err) => {
        logger.warn({
          msg: "OCR: preprocessImage failed, using original",
          error: err instanceof Error ? err.message : err,
        });
        return [{ imagePath: filePath, mimeType, variant: "original" }];
      });

      const scored: { variant: string; psm: number; result: OcrResult; score: number }[] = [];

      for (const v of variants) {
        try {
          const { result, psm } = await this.runBestOfModes(v.imagePath);
          const score = compositeScore(result);
          scored.push({ variant: v.variant, psm, result, score });
          logger.info({
            msg: "OCR: variant scored",
            variant: v.variant,
            psm,
            score: score.toFixed(2),
            confidence: result.confidence.toFixed(3),
            textLength: result.text.length,
          });

          // Early exit across variants: first decent result wins.
          if (score >= 80 && result.confidence >= 0.75) break;
        } catch (err) {
          logger.warn({
            msg: "OCR: variant failed",
            variant: v.variant,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      if (scored.length === 0) return { text: "", confidence: 0, lines: [], words: [] };
      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      logger.info({
        msg: "OCR: best result selected",
        variant: best.variant,
        psm: best.psm,
        score: best.score.toFixed(2),
        confidence: best.result.confidence.toFixed(3),
        textLength: best.result.text.length,
      });

      return { ...best.result, selectedVariant: best.variant, selectedPsm: best.psm };
    } catch (err) {
      logger.error({
        msg: "Tesseract OCR failed",
        error: err instanceof Error ? err.message : err,
      });
      return { text: "", confidence: 0, lines: [], words: [] };
    }
  }

  /** Try PSM 4 (single column), PSM 6 (block), PSM 11 (sparse). Stop early if good. */
  private async runBestOfModes(filePath: string): Promise<{ result: OcrResult; psm: number }> {
    const psms = [Tesseract.PSM.SINGLE_COLUMN, Tesseract.PSM.SINGLE_BLOCK, Tesseract.PSM.SPARSE_TEXT];
    const candidates: { result: OcrResult; psm: number; score: number }[] = [];

    for (const psm of psms) {
      const psmNum = Number(psm);
      try {
        const result = await runTesseract(filePath, psm);
        const score = compositeScore(result);
        candidates.push({ result, psm: psmNum, score });
        if (score >= 50 && result.confidence >= 0.7) {
          return { result, psm: psmNum };
        }
      } catch (err) {
        logger.warn({
          msg: `OCR: PSM ${psmNum} failed`,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    if (candidates.length === 0) {
      return { result: { text: "", confidence: 0, lines: [], words: [] }, psm: 6 };
    }
    candidates.sort((a, b) => b.score - a.score);
    return { result: candidates[0].result, psm: candidates[0].psm };
  }
}

/**
 * Score = confidence*10
 *       + count(monetary amounts) * 5
 *       + count(fiscal keywords) * 10
 *       + count(tax IDs) * 10
 *       + length bonus (max 10)
 */
function compositeScore(r: OcrResult): number {
  const text = r.text;
  const amounts = (text.match(RE_AMOUNTS) ?? []).length;
  const keywords = (text.match(RE_KEYWORDS) ?? []).length;
  const ids = (text.match(RE_IDENTIFICATIONS) ?? []).length;
  const lengthBonus = Math.min(text.length / 100, 10);
  return r.confidence * 10 + amounts * 5 + keywords * 10 + ids * 10 + lengthBonus;
}

async function runTesseract(filePath: string, psm: Tesseract.PSM): Promise<OcrResult> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm });

  const result = await worker.recognize(filePath);
  const data = result.data;

  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];

  if (data?.words && Array.isArray(data.words)) {
    for (const w of data.words) {
      if (!w.text?.trim()) continue;
      words.push({
        text: w.text,
        confidence: (w.confidence ?? 0) / 100,
        bbox: { x0: w.bbox?.x0 ?? 0, y0: w.bbox?.y0 ?? 0, x1: w.bbox?.x1 ?? 0, y1: w.bbox?.y1 ?? 0 },
      });
    }
  }

  if (data?.lines && Array.isArray(data.lines)) {
    for (const l of data.lines) {
      if (!l.text?.trim()) continue;
      const lineWords: OcrWord[] = (l.words ?? [])
        .filter((w: any) => w.text?.trim())
        .map((w: any) => ({
          text: w.text,
          confidence: (w.confidence ?? 0) / 100,
          bbox: { x0: w.bbox?.x0 ?? 0, y0: w.bbox?.y0 ?? 0, x1: w.bbox?.x1 ?? 0, y1: w.bbox?.y1 ?? 0 },
        }));
      lines.push({
        text: l.text.trim(),
        confidence: (l.confidence ?? 0) / 100,
        words: lineWords,
        bbox: { x0: l.bbox?.x0 ?? 0, y0: l.bbox?.y0 ?? 0, x1: l.bbox?.x1 ?? 0, y1: l.bbox?.y1 ?? 0 },
      });
    }
  }

  return {
    text: data?.text?.trim() || "",
    confidence: typeof data?.confidence === "number" ? data.confidence / 100 : 0,
    lines,
    words,
  };
}
