import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const IMAGE_EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function saveUploadedImage(
  file: FormDataEntryValue | null,
): Promise<{ imageName: string; imageUrl?: string }> {
  const validatedImage = await getValidatedProductImage(file);

  await mkdir(UPLOAD_DIR, { recursive: true });

  const extension = IMAGE_EXTENSIONS_BY_TYPE[validatedImage.mime] ?? ".jpg";
  const filename = `${randomUUID()}${extension}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  await writeFile(filePath, validatedImage.buffer);

  return {
    imageName: validatedImage.file.name,
    imageUrl: `/uploads/${filename}`,
  };
}

export async function assertValidProductImage(
  file: FormDataEntryValue | null,
): Promise<void> {
  await getValidatedProductImage(file);
}

async function getValidatedProductImage(
  file: FormDataEntryValue | null,
): Promise<{ file: File; buffer: Buffer; mime: string }> {
  if (!(file instanceof File) || !file.name) {
    throw new Error("Product image is required.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Image must be smaller than 5MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = await fileTypeFromBuffer(buffer);

  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType.mime)) {
    throw new Error("Only JPG, PNG, and WebP images are allowed.");
  }

  if (file.type && file.type !== detectedType.mime) {
    throw new Error("The uploaded file content does not match its image type.");
  }

  return { file, buffer, mime: detectedType.mime };
}

export async function deleteUploadedFile(
  url: string | null | undefined,
): Promise<void> {
  if (!url || !url.startsWith("/uploads/")) {
    return;
  }

  const filename = url.slice("/uploads/".length);

  if (!filename || filename.includes("/") || filename.includes("..")) {
    return;
  }

  await rm(path.join(UPLOAD_DIR, filename), { force: true });
}
