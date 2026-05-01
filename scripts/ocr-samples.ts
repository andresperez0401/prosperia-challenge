// Quick diagnostic: OCR all samples + run rules-based parser, dump results
import path from "path";
import fs from "fs";
import { TesseractOcr, shutdownTesseract } from "../src/services/ocr/ocr.tesseract.js";
import { pdfToImages } from "../src/services/pdf/pdfHandler.js";
import { reconstructLayout } from "../src/services/ocr/reconstructLayout.js";
import { parseReceipt } from "../src/services/parsing/parseReceipt.js";
import { extractAllTotalCandidates, extractRawLabeledFields } from "../src/services/parsing/parser.js";

const SAMPLES = [
  "samples/factura1.jpg",
  "samples/factura2.png",
  "samples/factura3.pdf",
  "samples/factura4.pdf",
];

async function main() {
  const ocr = new TesseractOcr();
  for (const rel of SAMPLES) {
    const filePath = path.resolve(rel);
    console.log("\n\n========== " + rel + " ==========");
    let text = "";
    let conf = 1;
    try {
      if (rel.endsWith(".pdf")) {
        const r = await pdfToImages(filePath);
        if (r.directText) {
          text = r.directText;
          console.log("[PDF: direct text]");
        } else if (r.pages.length > 0) {
          const out = await ocr.extractText({ filePath: r.pages[0], mimeType: "image/png" });
          text = out.text; conf = out.confidence;
          console.log(`[PDF: OCR page1, conf=${conf.toFixed(2)}]`);
        }
      } else {
        const mt = rel.endsWith(".jpg") ? "image/jpeg" : "image/png";
        const out = await ocr.extractText({ filePath, mimeType: mt });
        text = out.text; conf = out.confidence;
        console.log(`[OCR conf=${conf.toFixed(2)}]`);
      }
    } catch (e) {
      console.error("Failed:", e instanceof Error ? e.message : e);
      continue;
    }

    console.log("---- rawText ----");
    console.log(text.slice(0, 4000));
    console.log("---- end rawText ----");

    const recon = reconstructLayout([], [], text);
    const result = parseReceipt({
      rawText: text,
      reconstructedText: recon.text,
      lines: recon.lines,
      tableRows: recon.tableRows,
      ocrConfidence: conf,
      mimeType: rel.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    });
    console.log("---- parsed ----");
    console.log(JSON.stringify(result.fields, null, 2));
    console.log("---- totalCandidates ----");
    console.log(JSON.stringify(extractAllTotalCandidates(text), null, 2));
    console.log("---- labeledFields ----");
    console.log(JSON.stringify(extractRawLabeledFields(text), null, 2));
  }
  await shutdownTesseract();
}

main().catch((e) => { console.error(e); process.exit(1); });
