import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function saveUploadedImage(
  file: FormDataEntryValue | null,
): Promise<{ imageName: string; imageUrl?: string }> {
  if (!(file instanceof File) || !file.name) {
    return {
      imageName: "No image uploaded",
    };
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPG, PNG, WebP, and GIF images are allowed.");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Image must be smaller than 5MB.");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const extension = getSafeExtension(file.name);
  const filename = `${randomUUID()}${extension}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  const arrayBuffer = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return {
    imageName: file.name,
    imageUrl: `/uploads/${filename}`,
  };
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

function getSafeExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();

  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
    return extension;
  }

  return ".jpg";
}
