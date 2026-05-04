import fs from "fs/promises";
import os from "os";
import path from "path";

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function extensionFor(originalName: string, mimeType: string) {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName) return fromName;
  return MIME_EXTENSIONS[mimeType] || ".bin";
}

export async function withTempReceiptFile<T>(
  buffer: Buffer,
  meta: { originalName: string; mimeType: string },
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prosperia-receipt-"));
  const filePath = path.join(dir, `original${extensionFor(meta.originalName, meta.mimeType)}`);

  try {
    await fs.writeFile(filePath, buffer);
    return await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function withDownloadedReceiptFile<T>(
  fileUrl: string,
  meta: { originalName: string; mimeType: string },
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Could not download receipt from Cloudinary (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return withTempReceiptFile(buffer, meta, fn);
}
