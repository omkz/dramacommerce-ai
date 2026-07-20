// Shared external-request utility for every server-side call to Qwen, Wan,
// DashScope TTS, and remote media URLs. Centralizes timeout/cancellation,
// bounded response reads, streaming downloads with a hard size cap, redirect
// handling, protocol validation, and a normalized/classified error shape so
// worker retry logic can key off `.category`/`.retryable` instead of
// re-parsing error messages. Mirrored in scripts/lib/http-client.mjs for
// scripts/video-worker.mjs, which runs via plain `node` and cannot import
// this TS module — keep both in sync.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ErrorCategory =
  | "timeout"
  | "network"
  | "rate_limit"
  | "auth_config"
  | "server_temporary"
  | "invalid_response"
  | "oversized_response"
  | "permanent_client";

const RETRYABLE_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "timeout",
  "network",
  "rate_limit",
  "server_temporary",
]);

export function isRetryableCategory(category: ErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

export type ExternalRequestErrorMeta = {
  provider: string;
  operation: string;
  status?: number;
  timeoutMs?: number;
  providerMessage?: string;
};

export class ExternalRequestError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly provider: string;
  readonly operation: string;
  readonly status?: number;
  readonly timeoutMs?: number;
  // A short, sanitized excerpt of the provider's own error text (if any) —
  // useful for a human-facing message, deliberately excluded from
  // toLogFields() so it never ends up duplicated into structured logs
  // unbounded.
  readonly providerMessage?: string;

  constructor(category: ErrorCategory, message: string, meta: ExternalRequestErrorMeta) {
    super(message);
    this.name = "ExternalRequestError";
    this.category = category;
    this.retryable = isRetryableCategory(category);
    this.provider = meta.provider;
    this.operation = meta.operation;
    this.status = meta.status;
    this.timeoutMs = meta.timeoutMs;
    this.providerMessage = meta.providerMessage;
  }
}

// Safe, bounded fields for structured logging — never the raw error object,
// never a full provider response body, never a signed URL or bearer token.
// Callers should spread in their own identifiers (projectId, scene, ...).
export function toLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof ExternalRequestError) {
    return {
      provider: error.provider,
      operation: error.operation,
      category: error.category,
      retryable: error.retryable,
      status: error.status,
      timeoutMs: error.timeoutMs,
    };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}

const MAX_PROVIDER_MESSAGE_LENGTH = 300;

// Strips the shapes of secret we might otherwise echo back from a provider
// error body (Authorization headers echoed in some SDK errors, DashScope API
// keys, OSS/AWS-style signed-URL query params) and truncates to a bounded
// length so a misbehaving upstream can't blow up a log line or DB column.
export function sanitizeProviderText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9]{6,}/g, "[redacted-api-key]")
    .replace(
      /([?&](?:X-Amz-Signature|Signature|OSSAccessKeyId|security-token|Expires|AccessKeyId)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .trim()
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

export function classifyHttpStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) {
    return "auth_config";
  }

  if (status === 408) {
    return "timeout";
  }

  if (status === 429) {
    return "rate_limit";
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return "server_temporary";
  }

  if (status >= 500) {
    // Unrecognized 5xx: default to retryable — the safer failure mode for an
    // unknown server-side error.
    return "server_temporary";
  }

  return "permanent_client";
}

// For SDK errors that don't go through fetch() (the ali-oss client throws
// its own error shape carrying .status/.code) — classifies by the same
// status-code table when a status is present, otherwise infers timeout/auth/
// network from the SDK's own error code, and always sanitizes the resulting
// message before it can reach a log or DB errorMessage column.
export function wrapProviderError(
  error: unknown,
  meta: { provider: string; operation: string },
): ExternalRequestError {
  if (error instanceof ExternalRequestError) {
    return error;
  }

  const err = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : undefined;
  const code = typeof err.code === "string" ? err.code : undefined;

  let category: ErrorCategory;

  if (status !== undefined) {
    category = classifyHttpStatus(status);
  } else if (code && /timeout/i.test(code)) {
    category = "timeout";
  } else if (code === "AccessDenied" || code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") {
    category = "auth_config";
  } else {
    category = "network";
  }

  const detail = [code, typeof err.message === "string" ? err.message : undefined]
    .filter(Boolean)
    .join(": ");

  return new ExternalRequestError(
    category,
    `${meta.provider} ${meta.operation} failed: ${sanitizeProviderText(detail || "Unknown error")}`,
    { ...meta, status },
  );
}

function classifyThrownError(error: unknown): "timeout" | "network" {
  const name = error instanceof Error ? error.name : undefined;

  if (name === "AbortError" || name === "TimeoutError") {
    return "timeout";
  }

  return "network";
}

function toRequestError(
  error: unknown,
  meta: { provider: string; operation: string; timeoutMs?: number },
): ExternalRequestError {
  if (error instanceof ExternalRequestError) {
    return error;
  }

  const category = classifyThrownError(error);
  const detail = error instanceof Error ? error.message : String(error);
  const message =
    category === "timeout"
      ? `${meta.provider} ${meta.operation} timed out after ${meta.timeoutMs}ms.`
      : `${meta.provider} ${meta.operation} failed: ${sanitizeProviderText(detail)}`;

  return new ExternalRequestError(category, message, meta);
}

function tryParseJson(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractProviderMessage(bodyText: string, parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const nestedError =
      obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : undefined;
    const message =
      (typeof nestedError?.message === "string" ? nestedError.message : undefined) ??
      (typeof obj.message === "string" ? obj.message : undefined) ??
      (typeof obj.code === "string" ? obj.code : undefined);

    if (message) {
      return sanitizeProviderText(message);
    }
  }

  return bodyText.trim() ? sanitizeProviderText(bodyText) : undefined;
}

const DEFAULT_JSON_MAX_BYTES = 10 * 1024 * 1024;

async function readBoundedText(
  response: Response,
  maxBytes: number,
  meta: { provider: string; operation: string; timeoutMs?: number },
): Promise<string> {
  if (!response.body) {
    return response.text();
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "");

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ExternalRequestError(
      "oversized_response",
      `${meta.provider} ${meta.operation} declared content-length ${declaredLength} exceeds the ${maxBytes}-byte limit.`,
      { ...meta, status: response.status },
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        total += value.byteLength;

        if (total > maxBytes) {
          await reader.cancel();
          throw new ExternalRequestError(
            "oversized_response",
            `${meta.provider} ${meta.operation} response exceeded the ${maxBytes}-byte limit.`,
            { ...meta, status: response.status },
          );
        }

        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof ExternalRequestError) {
      throw error;
    }

    throw toRequestError(error, meta);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export type RequestJsonOptions = {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  provider: string;
  operation: string;
  maxBytes?: number;
};

export type RequestJsonResult<T> = { data: T; status: number };

// Fetch + AbortSignal.timeout (covers connect, headers, AND body read — the
// same signal stays attached to the response body stream, so a slow-drip
// body is caught by the same budget as a slow connect) + bounded body read +
// JSON parse, all folded into one classified-error call.
export async function requestJson<T = unknown>(
  options: RequestJsonOptions,
): Promise<RequestJsonResult<T>> {
  const { url, init, timeoutMs, provider, operation } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  const meta = { provider, operation, timeoutMs };

  let response: Response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw toRequestError(error, meta);
  }

  const bodyText = await readBoundedText(response, maxBytes, meta);
  const parsed = tryParseJson(bodyText);
  const providerMessage = extractProviderMessage(bodyText, parsed);

  if (!response.ok) {
    throw new ExternalRequestError(
      classifyHttpStatus(response.status),
      `${provider} ${operation} failed with status ${response.status}.`,
      { ...meta, status: response.status, providerMessage },
    );
  }

  if (parsed === undefined) {
    throw new ExternalRequestError(
      "invalid_response",
      bodyText.trim()
        ? `${provider} ${operation} returned a response that could not be parsed as JSON.`
        : `${provider} ${operation} returned an empty response.`,
      { ...meta, status: response.status, providerMessage },
    );
  }

  return { data: parsed as T, status: response.status };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertAllowedProtocol(
  url: string,
  allowHttp: boolean,
  meta: { provider: string; operation: string },
): void {
  let protocol: string;

  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new ExternalRequestError("permanent_client", `${meta.provider} ${meta.operation}: invalid URL.`, meta);
  }

  const allowed = protocol === "https:" || (allowHttp && protocol === "http:");

  if (!allowed) {
    throw new ExternalRequestError(
      "permanent_client",
      `${meta.provider} ${meta.operation}: unsupported URL protocol "${protocol}".`,
      meta,
    );
  }
}

async function streamToFile(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  maxBytes: number,
  meta: { provider: string; operation: string; timeoutMs?: number; status?: number },
): Promise<void> {
  let bytesRead = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytesRead += chunk.length;

      if (bytesRead > maxBytes) {
        callback(
          new ExternalRequestError(
            "oversized_response",
            `${meta.provider} ${meta.operation} exceeded the ${maxBytes}-byte limit while streaming.`,
            meta,
          ),
        );
        return;
      }

      callback(null, chunk);
    },
  });

  try {
    // node:stream/web's ReadableStream and the DOM lib's ReadableStream type
    // are structurally identical at runtime; Readable.fromWeb's types expect
    // the former, response.body is typed as the latter.
    await pipeline(Readable.fromWeb(body as never), limiter, createWriteStream(destPath));
  } catch (error) {
    await rm(destPath, { force: true });
    throw error instanceof ExternalRequestError ? error : toRequestError(error, meta);
  }
}

export type DownloadOptions = {
  url: string;
  destPath: string;
  timeoutMs: number;
  maxBytes: number;
  provider: string;
  operation: string;
  // Defaults to allowing http: only outside production — see
  // assertAllowedProtocol. Set explicitly to override.
  allowHttp?: boolean;
  maxRedirects?: number;
  // Soft check: if the response sets Content-Type and it matches none of
  // these prefixes, rejected before any bytes are written to disk. A missing
  // Content-Type header is not rejected (some providers omit it).
  expectedContentTypePrefixes?: string[];
};

const DEFAULT_MAX_REDIRECTS = 5;

// Streams a remote URL to disk with a bounded size and a manual (capped,
// protocol-revalidated-per-hop) redirect loop — Node's built-in
// redirect:"follow" doesn't expose a hop limit or let us inspect each hop's
// target before following it, and a redirect to file:/data:/an internal host
// is exactly the kind of thing "prevent unsupported schemes" is guarding
// against. Never buffers the body in memory.
export async function downloadToFile(options: DownloadOptions): Promise<void> {
  const { destPath, timeoutMs, maxBytes, provider, operation } = options;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowHttp = options.allowHttp ?? process.env.NODE_ENV !== "production";
  const meta = { provider, operation, timeoutMs };

  let currentUrl = options.url;
  let response: Response | undefined;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertAllowedProtocol(currentUrl, allowHttp, meta);

    let hopResponse: Response;

    try {
      hopResponse = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw toRequestError(error, meta);
    }

    if (isRedirectStatus(hopResponse.status)) {
      if (hop === maxRedirects) {
        throw new ExternalRequestError(
          "permanent_client",
          `${provider} ${operation} exceeded the maximum of ${maxRedirects} redirects.`,
          { ...meta, status: hopResponse.status },
        );
      }

      const location = hopResponse.headers.get("location");

      if (!location) {
        throw new ExternalRequestError(
          "invalid_response",
          `${provider} ${operation} returned a redirect with no Location header.`,
          { ...meta, status: hopResponse.status },
        );
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    response = hopResponse;
    break;
  }

  if (!response) {
    throw new ExternalRequestError(
      "permanent_client",
      `${provider} ${operation} exceeded the maximum of ${maxRedirects} redirects.`,
      meta,
    );
  }

  if (!response.ok || !response.body) {
    throw new ExternalRequestError(
      classifyHttpStatus(response.status),
      `${provider} ${operation} failed with status ${response.status}.`,
      { ...meta, status: response.status },
    );
  }

  if (options.expectedContentTypePrefixes?.length) {
    const contentType = response.headers.get("content-type") ?? "";
    const matches = options.expectedContentTypePrefixes.some((prefix) => contentType.startsWith(prefix));

    if (contentType && !matches) {
      throw new ExternalRequestError(
        "invalid_response",
        `${provider} ${operation} returned unexpected content-type "${contentType}".`,
        { ...meta, status: response.status },
      );
    }
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "");

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ExternalRequestError(
      "oversized_response",
      `${provider} ${operation} declared content-length ${declaredLength} exceeds the ${maxBytes}-byte limit.`,
      { ...meta, status: response.status },
    );
  }

  await streamToFile(response.body, destPath, maxBytes, { ...meta, status: response.status });
}
