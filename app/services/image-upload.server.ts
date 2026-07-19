import { fileTypeFromBuffer } from "file-type";
import { getMediaStorage } from "~/services/storage/media-storage.server";

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
  const extension = IMAGE_EXTENSIONS_BY_TYPE[validatedImage.mime] ?? ".jpg";

  const key = await getMediaStorage().saveBuffer(validatedImage.buffer, {
    category: "product-images",
    extension,
  });

  return {
    imageName: validatedImage.file.name,
    // A storage reference (key), not a browser URL — resolved to one only
    // when a route reads project data for display. See
    // project-store.server.ts's *ForDisplay helpers.
    imageUrl: key,
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
  ref: string | null | undefined,
): Promise<void> {
  if (!ref) {
    return;
  }

  await getMediaStorage().delete(ref);
}

export async function readUploadedImageAsDataUrl(
  ref: string | null | undefined,
): Promise<string> {
  if (!ref) {
    throw new Error(`Invalid uploaded image reference: ${ref}`);
  }

  return getMediaStorage().readAsDataUrl(ref);
}
