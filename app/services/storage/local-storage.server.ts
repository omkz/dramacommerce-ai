import { mkdir, readFile, rm, writeFile, copyFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { buildObjectKey, isManagedRef, toRelativeKey, type SaveKeyOptions } from "~/services/storage/keys";
import type { HealthCheckResult, MediaStorageDriver } from "~/services/storage/types";

// Local disk storage — the default for single-process/shared-filesystem
// development. When the web app, showrunner worker, and video worker run as
// separate containers with no shared volume, this driver cannot see files
// another container wrote; use MEDIA_STORAGE_DRIVER=oss for that topology.
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export function createLocalStorageDriver(): MediaStorageDriver {
  return {
    mode: "local",

    async saveBuffer(buffer, options) {
      const key = buildKey(options);
      const filePath = resolveLocalPath(key);

      await mkdir(path.dirname(filePath), { recursive: true });

      try {
        await writeFile(filePath, buffer);
      } catch (error) {
        await rm(filePath, { force: true });
        throw error;
      }

      return key;
    },

    async saveFromPath(localPath, options) {
      const key = buildKey(options);
      const filePath = resolveLocalPath(key);

      await mkdir(path.dirname(filePath), { recursive: true });

      try {
        await copyFile(localPath, filePath);
      } catch (error) {
        await rm(filePath, { force: true });
        throw error;
      }

      return key;
    },

    async readBuffer(ref) {
      assertManaged(ref);
      return readFile(resolveLocalPath(ref));
    },

    async readAsDataUrl(ref) {
      assertManaged(ref);

      const buffer = await readFile(resolveLocalPath(ref));
      const detectedType = await fileTypeFromBuffer(buffer);
      const mime = detectedType?.mime ?? "image/jpeg";

      return `data:${mime};base64,${buffer.toString("base64")}`;
    },

    async delete(ref) {
      if (!isManagedRef(ref)) {
        return;
      }

      await rm(resolveLocalPath(ref), { force: true });
    },

    async resolveUrl(ref) {
      assertManaged(ref);

      if (ref.startsWith("/uploads/")) {
        return ref;
      }

      return `/uploads/${ref}`;
    },

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        await mkdir(UPLOAD_DIR, { recursive: true });

        const probePath = path.join(UPLOAD_DIR, `.health-check-${randomUUID()}.tmp`);
        await writeFile(probePath, "ok");
        await access(probePath, fsConstants.W_OK);
        await rm(probePath, { force: true });

        return { status: "ok" };
      } catch (error) {
        return {
          status: "error",
          message: `Local storage directory is not writable: ${getErrorMessage(error)}`,
        };
      }
    },
  };
}

// Used directly by the /uploads/* route, which serves local files
// regardless of the currently active driver (a stray legacy reference
// should still resolve while running in local mode).
export function resolveLocalPath(ref: string): string {
  const relative = toRelativeKey(ref);
  const resolvedRoot = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  const resolved = path.resolve(UPLOAD_DIR, relative);

  if (resolved !== UPLOAD_DIR && !resolved.startsWith(resolvedRoot)) {
    throw new Error(`Invalid storage reference: ${ref}`);
  }

  return resolved;
}

function assertManaged(ref: string): void {
  if (!isManagedRef(ref)) {
    throw new Error(`Invalid storage reference: ${ref}`);
  }
}

function buildKey(options: SaveKeyOptions): string {
  return buildObjectKey(randomUUID(), options);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
