import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Rasterize a PDF to one PNG per page using pdfjs-dist + @napi-rs/canvas.
 * Pure-JS path — no GraphicsMagick / Ghostscript required.
 */
export async function rasterizePdf(
  filePath: string,
  outputDir: string,
  base: string,
  scale = 2.5,
): Promise<string[]> {
  // pdfjs-dist v5 ships an ESM legacy build that works in Node
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const data = new Uint8Array(fs.readFileSync(filePath));

  const cmapsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const cmapsUrl = pathToFileURL(path.join(cmapsDir, "cmaps") + path.sep).toString();
  const standardFontDataUrl = pathToFileURL(
    path.join(cmapsDir, "standard_fonts") + path.sep,
  ).toString();

  const loadingTask = pdfjs.getDocument({
    data,
    cMapUrl: cmapsUrl,
    cMapPacked: true,
    standardFontDataUrl,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx: any = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    const out = path.join(outputDir, `${base}-page-${pageNum}.png`);
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    pages.push(out);
    page.cleanup();
  }
  await doc.cleanup();
  await doc.destroy();

  return pages;
}
