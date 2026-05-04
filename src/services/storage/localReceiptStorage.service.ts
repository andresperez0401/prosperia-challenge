import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { env } from "../../config/env.js";

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

export async function saveReceiptLocally(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}) {
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  await fs.mkdir(uploadDir, { recursive: true });

  const fileName = `${crypto.randomUUID()}${extensionFor(input.originalName, input.mimeType)}`;
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, input.buffer);

  return {
    storagePath: filePath,
  };
}
