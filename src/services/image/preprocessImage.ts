import sharp from "sharp";
import path from "path";
import fs from "fs";
import { logger } from "../../config/logger.js";

export interface PreprocessResult {
  imagePath: string;
  mimeType: string;
  variant: string;
}

/**
 * Preprocess an image for OCR using Sharp.
 * Returns up to 3 variants — Tesseract picks the higher-scoring one.
 * Tesseract has an early-exit when a variant scores high enough, so the
 * later variants are only run when the cheaper ones fail to produce
 * good results.
 *
 * Variants:
 *  - normalized:    grayscale + normalize + sharpen + upscale  → photos / clean scans
 *  - threshold-N:   median + binarization                      → thermal tickets / faint text
 *  - darkened:      aggressive contrast + high threshold       → low-quality phone photos,
 *                                                                whatsapp screenshots, faded
 *                                                                thermal receipts
 */
export async function preprocessImage(
  filePath: string,
  mimeType: string,
): Promise<PreprocessResult[]> {
  if (mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf")) {
    logger.warn("preprocessImage: received PDF, skipping (convert to image first)");
    return [{ imagePath: filePath, mimeType, variant: "original" }];
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`preprocessImage: file not found: ${filePath}`);
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const results: PreprocessResult[] = [];

  try {
    const meta = await sharp(filePath, { failOn: "none" }).metadata();

    // Compute mean gray level on a small preview to detect dark/inverted backgrounds
    const { data: raw } = await sharp(filePath, { failOn: "none" })
      .rotate()
      .grayscale()
      .resize({ width: 400, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let mean = 0;
    for (let i = 0; i < raw.length; i++) mean += raw[i];
    mean /= raw.length;

    const shouldInvert = mean < 110;

    logger.info({
      msg: "preprocessImage: stats",
      file: path.basename(filePath),
      width: meta.width,
      height: meta.height,
      meanGray: Math.round(mean),
      shouldInvert,
    });

    // Cap width to keep memory/CPU bounded — 1800px is plenty for OCR.
    const sourceWidth = meta.width ?? 1800;
    const targetWidth = Math.min(Math.max(sourceWidth, 1600), 2200);

    const basePipe = () => {
      let p = sharp(filePath, { failOn: "none" }).rotate();
      if (shouldInvert) p = p.negate({ alpha: false });
      return p.grayscale();
    };

    // Variant 1: normalized — grayscale + normalize + sharpen + resize
    const normalizedPath = path.join(dir, `${base}-ocr-normalized.png`);
    await basePipe()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .resize({ width: targetWidth, withoutEnlargement: false })
      .png({ compressionLevel: 6 })
      .toFile(normalizedPath);
    results.push({ imagePath: normalizedPath, mimeType: "image/png", variant: "normalized" });

    // Variant 2: threshold — binarization for low-contrast / thermal receipts.
    // Use higher threshold for dark images (already inverted), lower for normal.
    const threshValue = shouldInvert ? 140 : 160;
    const thresholdPath = path.join(dir, `${base}-ocr-threshold.png`);
    await basePipe()
      .normalize()
      .median(1)
      .threshold(threshValue)
      .resize({ width: targetWidth, withoutEnlargement: false })
      .png({ compressionLevel: 6 })
      .toFile(thresholdPath);
    results.push({ imagePath: thresholdPath, mimeType: "image/png", variant: `threshold-${threshValue}` });

    // Variant 3: darkened — aggressive sharpen + high threshold.
    // Catches phone photos with faded ink / low ambient light where the other
    // two variants merge characters or drop strokes. Heavy but cheap relative
    // to a wrong extraction.
    const darkThresh = shouldInvert ? 170 : 190;
    const darkenedPath = path.join(dir, `${base}-ocr-darkened.png`);
    await basePipe()
      .normalize()
      .linear(1.4, -20) // contrast boost: out = 1.4 * in - 20
      .sharpen({ sigma: 2.0 })
      .threshold(darkThresh)
      .resize({ width: targetWidth, withoutEnlargement: false })
      .png({ compressionLevel: 6 })
      .toFile(darkenedPath);
    results.push({ imagePath: darkenedPath, mimeType: "image/png", variant: `darkened-${darkThresh}` });

  } catch (err) {
    logger.error({
      msg: "preprocessImage: failed, using original",
      error: err instanceof Error ? err.message : err,
    });
    return [{ imagePath: filePath, mimeType, variant: "original" }];
  }

  return results;
}
