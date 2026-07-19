// Plain-JS mirror of app/services/storage/* for video-worker.mjs, which
// (like the rest of that file — see the CLAUDE.md note on video-worker.mjs)
// deliberately duplicates logic in raw JS rather than importing app TS
// modules, since it runs via plain `node`, not `tsx`/esbuild. Key format,
// path-traversal guard, and OSS wiring must stay behaviorally identical to
// the TS drivers in app/services/storage/ — if you change one, change both.
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import OSS from "ali-oss";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const CATEGORY_PREFIXES = ["product-images", "scene-videos", "final-videos"];
const LEGACY_UPLOADS_PREFIX = "/uploads/";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = Number(
  process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || "120000",
);
const DEFAULT_DOWNLOAD_MAX_BYTES = Number(
  process.env.MEDIA_DOWNLOAD_MAX_BYTES || String(200 * 1024 * 1024),
);

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
    timeout: 10_000,
  });

  return ossClient;
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required when MEDIA_STORAGE_DRIVER=oss.`);
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
      throw new Error(`OSS upload failed: ${describeOssError(error)}`);
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
    throw new Error(`Invalid storage reference: ${ref}`);
  }

  if (getStorageMode() === "oss") {
    try {
      const result = await getOssClient().get(toRelativeKey(ref));
      return result.content;
    } catch (error) {
      throw new Error(`OSS read failed: ${describeOssError(error)}`);
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

// Downloads a ref (managed storage key/legacy path, or an arbitrary
// external URL like a raw Wan/TTS provider link) to a local file. External
// downloads are timeout- and size-bounded so a slow or oversized provider
// response can't hang or exhaust worker memory/disk indefinitely.
export async function downloadToPath(ref, destPath) {
  if (isManagedRef(ref)) {
    const buffer = await readManagedBuffer(ref);
    await writeFile(destPath, buffer);
    return;
  }

  await downloadRemoteFile(ref, destPath, {
    timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
    maxBytes: DEFAULT_DOWNLOAD_MAX_BYTES,
  });
}

async function downloadRemoteFile(url, destPath, { timeoutMs, maxBytes }) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download clip: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");

  if (contentLength > maxBytes) {
    throw new Error(
      `Failed to download clip: response size ${contentLength} exceeds the ${maxBytes}-byte limit.`,
    );
  }

  let bytesRead = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytesRead += chunk.length;

      if (bytesRead > maxBytes) {
        callback(new Error(`Failed to download clip: exceeded the ${maxBytes}-byte limit.`));
        return;
      }

      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(destPath));
  } catch (error) {
    await rm(destPath, { force: true });
    throw error;
  }
}

function describeOssError(error) {
  if (error && typeof error === "object") {
    const parts = [
      typeof error.name === "string" ? error.name : undefined,
      typeof error.code === "string" ? `code=${error.code}` : undefined,
      typeof error.status === "number" ? `status=${error.status}` : undefined,
      typeof error.message === "string" ? error.message : undefined,
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return "Unknown OSS error";
}
