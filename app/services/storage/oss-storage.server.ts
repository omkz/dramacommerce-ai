import { randomUUID } from "node:crypto";
import OSS from "ali-oss";
import { fileTypeFromBuffer } from "file-type";
import {
  buildObjectKey,
  isManagedRef,
  toRelativeKey,
  type SaveKeyOptions,
} from "~/services/storage/keys";
import type { HealthCheckResult, MediaStorageDriver } from "~/services/storage/types";
import { ExternalRequestError, wrapProviderError } from "~/services/http/http-client.server";
import { getOssRequestTimeoutMs } from "~/services/http/timeout-config.server";

// Narrow structural subset of the ali-oss client we actually use, so tests
// can inject a fake without needing a real OSS connection or mocking the
// "ali-oss" module. The real client (constructed in createOssStorageDriver)
// satisfies this shape as-is.
export type OssClientLike = {
  put(name: string, file: string | Buffer): Promise<{ name: string; url: string }>;
  get(name: string): Promise<{ content: Buffer }>;
  delete(name: string): Promise<unknown>;
  signatureUrl(name: string, options?: { expires?: number }): string;
  list(query: { "max-keys": number }): Promise<{ objects?: unknown[] }>;
};

const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;

export function createOssStorageDriver(overrides?: {
  client?: OssClientLike;
}): MediaStorageDriver {
  let cachedClient: OssClientLike | null = overrides?.client ?? null;

  function getClient(): OssClientLike {
    cachedClient ??= createRealClient();
    return cachedClient;
  }

  return {
    mode: "oss",

    async saveBuffer(buffer, options) {
      const key = buildKey(options);

      try {
        await getClient().put(key, buffer);
      } catch (error) {
        throw wrapProviderError(error, { provider: "oss", operation: "upload" });
      }

      return key;
    },

    async saveFromPath(localPath, options) {
      const key = buildKey(options);

      try {
        await getClient().put(key, localPath);
      } catch (error) {
        throw wrapProviderError(error, { provider: "oss", operation: "upload" });
      }

      return key;
    },

    async readBuffer(ref) {
      assertManaged(ref);

      try {
        const result = await getClient().get(toRelativeKey(ref));
        return result.content;
      } catch (error) {
        throw wrapProviderError(error, { provider: "oss", operation: "read" });
      }
    },

    async readAsDataUrl(ref) {
      assertManaged(ref);

      const buffer = await this.readBuffer(ref);
      const detectedType = await fileTypeFromBuffer(buffer);
      const mime = detectedType?.mime ?? "image/jpeg";

      return `data:${mime};base64,${buffer.toString("base64")}`;
    },

    async delete(ref) {
      if (!isManagedRef(ref)) {
        return;
      }

      try {
        await getClient().delete(toRelativeKey(ref));
      } catch (error) {
        console.error(`OSS delete failed for ${ref}:`, wrapProviderError(error, { provider: "oss", operation: "delete" }).message);
      }
    },

    async resolveUrl(ref) {
      assertManaged(ref);

      const key = toRelativeKey(ref);
      const publicBaseUrl = process.env.OSS_PUBLIC_BASE_URL;

      if (publicBaseUrl) {
        return `${publicBaseUrl.replace(/\/+$/, "")}/${key}`;
      }

      const expiresSeconds = Number(
        process.env.OSS_SIGNED_URL_EXPIRES_SECONDS || DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
      );

      return getClient().signatureUrl(key, { expires: expiresSeconds });
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const missing = ["OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"]
        .filter((name) => !process.env[name]);

      if (missing.length > 0) {
        return {
          status: "error",
          message: `Missing required OSS environment variables: ${missing.join(", ")}`,
        };
      }

      try {
        await getClient().list({ "max-keys": 1 });
        return { status: "ok" };
      } catch (error) {
        return {
          status: "error",
          message: `OSS connectivity check failed: ${wrapProviderError(error, { provider: "oss", operation: "healthCheck" }).message}`,
        };
      }
    },
  };
}

function buildKey(options: SaveKeyOptions): string {
  return buildObjectKey(randomUUID(), options);
}

function assertManaged(ref: string): void {
  if (!isManagedRef(ref)) {
    throw new ExternalRequestError("permanent_client", `Invalid storage reference: ${ref}`, {
      provider: "storage",
      operation: "read",
    });
  }
}

function createRealClient(): OssClientLike {
  const region = requireEnv("OSS_REGION");
  const bucket = requireEnv("OSS_BUCKET");
  const accessKeyId = requireEnv("OSS_ACCESS_KEY_ID");
  const accessKeySecret = requireEnv("OSS_ACCESS_KEY_SECRET");
  const endpoint = process.env.OSS_ENDPOINT || undefined;

  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure: true,
    timeout: getOssRequestTimeoutMs(),
  }) as unknown as OssClientLike;
}

function requireEnv(name: string): string {
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
