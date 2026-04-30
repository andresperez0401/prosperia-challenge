import path from "path";
import fs from "fs";
import { logger } from "../../config/logger.js";
import { rasterizePdf } from "./pdfRasterize.js";

/**
 * Convert PDF to images for OCR.
 *
 * Order of attempts:
 *   1. pdf-parse           → use embedded text if PDF has it (cheapest, no binaries)
 *   2. pdf-to-png-converter → pure-JS rasterizer, works on Windows w/o native deps
 *   3. pdf2pic              → fallback, requires GraphicsMagick + Ghostscript on PATH
 *                             (install with Chocolatey: `choco install graphicsmagick ghostscript`)
 */
export async function pdfToImages(
  filePath: string,
): Promise<{ pages: string[]; directText: string | null; method: "direct" | "ocr" }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`pdfToImages: file not found: ${filePath}`);
  }

  // 1. Try direct text extraction
  let directText: string | null = null;
  try {
    const buffer = fs.readFileSync(filePath);
    const text = (await parsePdfText(buffer)).trim();

    if (text.length >= 80 && hasUsefulContent(text)) {
      logger.info({ msg: "pdfToImages: using embedded text", textLength: text.length });
      return { pages: [], directText: text, method: "direct" };
    }
    directText = text.length > 0 ? text : null;
    logger.info({ msg: "pdfToImages: embedded text too short, will rasterize", length: text.length });
  } catch (err) {
    logger.warn({ msg: "pdfToImages: pdf-parse failed", error: errMsg(err) });
  }

  // 2. Pure-JS rasterizer via pdfjs-dist + @napi-rs/canvas (no native deps)
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const outputDir = path.join(dir, `${base}-pages`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  try {
    // Scale 2.0 ≈ 144 DPI — adequate for OCR, ~36% less RAM/CPU than 2.5.
    const pages = await rasterizePdf(filePath, outputDir, base, 2.0);
    if (pages.length > 0) {
      logger.info({ msg: "pdfToImages: rasterized via pdfjs-dist", pageCount: pages.length });
      return { pages, directText, method: "ocr" };
    }
  } catch (err) {
    logger.warn({ msg: "pdfToImages: pdfjs-dist rasterize failed", error: errMsg(err) });
  }

  // 3. pdf2pic fallback (requires GraphicsMagick + Ghostscript)
  try {
    const pages = await rasterizeWithPdf2pic(filePath, outputDir, base);
    if (pages.length > 0) {
      logger.info({ msg: "pdfToImages: rasterized via pdf2pic", pageCount: pages.length });
      return { pages, directText, method: "ocr" };
    }
  } catch (err) {
    logger.warn({
      msg: "pdfToImages: pdf2pic failed (install GraphicsMagick + Ghostscript via Chocolatey for highest quality)",
      error: errMsg(err),
    });
  }

  // Last resort: any text we got
  if (directText && directText.length > 10) {
    return { pages: [], directText, method: "direct" };
  }

  throw new Error("pdfToImages: could not extract text from PDF by any method");
}

async function rasterizeWithPdf2pic(
  filePath: string,
  outputDir: string,
  base: string,
): Promise<string[]> {
  const { fromPath } = await import("pdf2pic");
  const converter = fromPath(filePath, {
    density: 300,
    saveFilename: `${base}-page`,
    savePath: outputDir,
    format: "png",
    width: 2200,
    quality: 100,
  });

  const results = await converter.bulk(-1, { responseType: "image" });
  const pages: string[] = [];
  for (const r of results) {
    if (r.path && fs.existsSync(r.path)) pages.push(r.path);
  }
  return pages;
}

type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;

async function parsePdfText(buffer: Buffer): Promise<string> {
  const pdfParseModule: any = await import("pdf-parse");
  const PDFParseCtor = pdfParseModule.PDFParse;
  if (typeof PDFParseCtor === "function") {
    const parser = new PDFParseCtor({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text ?? "";
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy();
    }
  }

  const candidates = [
    pdfParseModule.default,
    pdfParseModule.pdfParse,
    pdfParseModule.default?.default,
    pdfParseModule,
  ];
  for (const c of candidates) {
    if (typeof c === "function") {
      const data = await (c as PdfParseFn)(buffer);
      return data?.text ?? "";
    }
  }
  throw new Error("pdf-parse: could not resolve parser function");
}

function hasUsefulContent(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 3);
  if (lines.length < 3) return false;
  const hasNumbers = /\d{2,}/.test(text);
  const hasWords = /[a-záéíóúñ]{3,}/i.test(text);
  return hasNumbers && hasWords;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
