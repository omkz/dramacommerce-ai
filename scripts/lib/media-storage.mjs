// Plain-JS mirror of app/services/storage/* for video-worker.mjs, which
// (like the rest of that file — see the CLAUDE.md note on video-worker.mjs)
// deliberately duplicates logic in raw JS rather than importing app TS
// modules, since it runs via plain `node`, not `tsx`/esbuild. Key format,
// path-traversal guard, and OSS wiring must stay behaviorally identical to
// the TS drivers in app/services/storage/ — if you change one, change both.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import OSS from "ali-oss";
import { downloadToFile, ExternalRequestError, wrapProviderError } from "./http-client.mjs";
import {
  getMediaDownloadMaxBytes,
  getMediaDownloadTimeoutMs,
  getOssRequestTimeoutMs,
} from "./timeout-config.mjs";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const CATEGORY_PREFIXES = ["product-images", "scene-videos", "final-videos"];
const LEGACY_UPLOADS_PREFIX = "/uploads/";

export function getStorageMode() {
  return process.env.MEDIA_STORAGE_DRIVER === "oss" ? "oss" : "local";
}

export function isManagedRef(ref) {
  if (!ref) {
    return false;
  }

  if (ref.startsWith(LEGACY_UPLOADS_PREFIX)) {
    return true;
  }

  return CATEGORY_PREFIXES.some((category) => ref.startsWith(`${category}/`));
}

function toRelativeKey(ref) {
  return ref.startsWith(LEGACY_UPLOADS_PREFIX)
    ? ref.slice(LEGACY_UPLOADS_PREFIX.length)
    : ref;
}

function buildObjectKey({ category, extension, projectId }) {
  const uuid = randomUUID();
  const ext = extension.startsWith(".") ? extension : `.${extension}`;

  if (category === "product-images") {
    return `${category}/${uuid}${ext}`;
  }

  return `${category}/${projectId}/${uuid}${ext}`;
}

function resolveLocalPath(ref) {
  const relative = toRelativeKey(ref);
  const resolvedRoot = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  const resolved = path.resolve(UPLOAD_DIR, relative);

  if (resolved !== UPLOAD_DIR && !resolved.startsWith(resolvedRoot)) {
    throw new Error(`Invalid storage reference: ${ref}`);
  }

  return resolved;
}

let ossClient = null;

function getOssClient() {
  if (ossClient) {
    return ossClient;
  }

  const region = requireEnv("OSS_REGION");
  const bucket = requireEnv("OSS_BUCKET");
  const accessKeyId = requireEnv("OSS_ACCESS_KEY_ID");
  const accessKeySecret = requireEnv("OSS_ACCESS_KEY_SECRET");
  const endpoint = process.env.OSS_ENDPOINT || undefined;

  ossClient = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure: true,
    timeout: getOssRequestTimeoutMs(),
  });

  return ossClient;
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new ExternalRequestError(
      "auth_config",
      `${name} is required when MEDIA_STORAGE_DRIVER=oss.`,
      { provider: "oss", operation: "config" },
    );
  }

  return value;
}

// Saves a completed local file (an ffmpeg output — narrated scene clip or
// stitched final video) into the active storage driver. Returns the
// canonical key to persist to Postgres.
export async function saveGeneratedFile(localPath, { category, extension, projectId }) {
  const key = buildObjectKey({ category, extension, projectId });

  if (getStorageMode() === "oss") {
    try {
      await getOssClient().put(key, localPath);
    } catch (error) {
      throw wrapProviderError(error, { provider: "oss", operation: "upload" });
    }

    return key;
  }

  const filePath = resolveLocalPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await copyFile(localPath, filePath);

  return key;
}

export async function readManagedBuffer(ref) {
  if (!isManagedRef(ref)) {
    throw new ExternalRequestError("permanent_client", `Invalid storage reference: ${ref}`, {
      provider: "storage",
      operation: "read",
    });
  }

  if (getStorageMode() === "oss") {
    try {
      const result = await getOssClient().get(toRelativeKey(ref));
      return result.content;
    } catch (error) {
      throw wrapProviderError(error, { provider: "oss", operation: "read" });
    }
  }

  return readFile(resolveLocalPath(ref));
}

export async function readManagedAsDataUrl(ref) {
  const buffer = await readManagedBuffer(ref);
  const detectedType = await fileTypeFromBuffer(buffer);
  const mime = detectedType?.mime ?? "image/jpeg";

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

// Downloads a ref (managed storage key/legacy path, or an arbitrary external
// URL like a raw Wan/TTS provider link) to a local file. External downloads
// go through the shared streaming downloader — timeout- and size-bounded,
// protocol-checked, redirect-capped — so a slow, oversized, or malicious
// provider response can't hang or exhaust worker memory/disk, or redirect
// this worker into fetching an unintended scheme/host.
export async function downloadToPath(ref, destPath, { expectedContentTypePrefixes } = {}) {
  if (isManagedRef(ref)) {
    const buffer = await readManagedBuffer(ref);
    await writeFile(destPath, buffer);
    return;
  }

  await downloadToFile({
    url: ref,
    destPath,
    timeoutMs: getMediaDownloadTimeoutMs(),
    maxBytes: getMediaDownloadMaxBytes(),
    provider: "media",
    operation: "download",
    expectedContentTypePrefixes,
  });
}
