import crypto from "crypto";
import { env } from "../../config/env.js";

export type CloudinaryUploadResult = {
  publicUrl: string;
  publicId: string;
  resourceType: string;
};

type CloudinaryParam = string | number | boolean | null | undefined;

function uploadResourceType(mimeType: string) {
  if (mimeType === "application/pdf" || mimeType.startsWith("image/")) return "image";
  return "auto";
}

function requireCloudinaryConfig() {
  const missing = [
    ["CLOUDINARY_CLOUD_NAME", env.CLOUDINARY_CLOUD_NAME],
    ["CLOUDINARY_API_KEY", env.CLOUDINARY_API_KEY],
    ["CLOUDINARY_API_SECRET", env.CLOUDINARY_API_SECRET],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing Cloudinary config: ${missing.map(([key]) => key).join(", ")}`);
  }

  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    folder: env.CLOUDINARY_FOLDER,
  };
}

function signUploadParams(params: Record<string, CloudinaryParam>, apiSecret: string) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

function appendParam(form: FormData, key: string, value: CloudinaryParam) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

async function validatePublicUrl(publicUrl: string, mimeType: string) {
  const head = await fetch(publicUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
  if (head?.ok) return;

  const get = await fetch(publicUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  }).catch(() => null);

  if (get?.ok) return;

  const status = get?.status || head?.status || "no response";
  const cloudinaryError = get?.headers.get("x-cld-error") || head?.headers.get("x-cld-error");
  const detail = cloudinaryError ? `: ${cloudinaryError}` : "";
  const pdfHint = mimeType === "application/pdf"
    ? ". Enable 'Allow delivery of PDF and ZIP files' in Cloudinary Product Environment Security settings, or use a paid Cloudinary environment where PDF delivery is enabled."
    : "";
  throw new Error(`Cloudinary URL is not publicly accessible (${status})${detail}${pdfHint}`);
}

export async function uploadReceiptToCloudinary(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}): Promise<CloudinaryUploadResult> {
  const { cloudName, apiKey, apiSecret, folder } = requireCloudinaryConfig();
  const resourceType = uploadResourceType(input.mimeType);
  const timestamp = Math.round(Date.now() / 1000);
  const uploadParams = {
    access_mode: "public",
    folder,
    overwrite: false,
    timestamp,
    type: "upload",
    unique_filename: true,
    use_filename: true,
  };
  const signature = signUploadParams(uploadParams, apiSecret);

  const form = new FormData();
  appendParam(form, "access_mode", uploadParams.access_mode);
  appendParam(form, "api_key", apiKey);
  appendParam(form, "folder", folder);
  appendParam(form, "overwrite", uploadParams.overwrite);
  appendParam(form, "timestamp", timestamp);
  appendParam(form, "type", uploadParams.type);
  appendParam(form, "unique_filename", uploadParams.unique_filename);
  appendParam(form, "use_filename", uploadParams.use_filename);
  appendParam(form, "signature", signature);
  form.append("file", new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.originalName);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: "POST",
    body: form,
  });
  const body = (await response.json().catch(() => null)) as any;

  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Cloudinary upload failed (${response.status})`;
    throw new Error(message);
  }

  const publicUrl = body?.secure_url || body?.url;
  if (typeof publicUrl !== "string" || !/^https?:\/\//i.test(publicUrl)) {
    throw new Error("Cloudinary upload did not return a valid public URL");
  }
  try {
    await validatePublicUrl(publicUrl, input.mimeType);
  } catch (err) {
    await deleteReceiptFromCloudinary({
      publicId: String(body.public_id || ""),
      resourceType: String(body.resource_type || resourceType),
    });
    throw err;
  }

  return {
    publicUrl,
    publicId: String(body.public_id || ""),
    resourceType: String(body.resource_type || resourceType),
  };
}

export async function deleteReceiptFromCloudinary(input: {
  publicId: string;
  resourceType: string;
}) {
  if (!input.publicId) return;

  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.round(Date.now() / 1000);
  const destroyParams = {
    public_id: input.publicId,
    timestamp,
  };
  const signature = signUploadParams(destroyParams, apiSecret);

  const form = new FormData();
  appendParam(form, "api_key", apiKey);
  appendParam(form, "public_id", input.publicId);
  appendParam(form, "timestamp", timestamp);
  appendParam(form, "signature", signature);

  await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${input.resourceType || "image"}/destroy`, {
    method: "POST",
    body: form,
  }).catch(() => undefined);
}
