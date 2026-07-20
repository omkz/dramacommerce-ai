// Plain-JS mirror of app/services/http/http-client.server.ts for
// scripts/video-worker.mjs (runs via plain `node`, cannot import TS modules —
// see CLAUDE.md's note on that worker's duplication pattern). Same
// classification, same timeout/redirect/size-cap semantics. Keep both in
// sync — if you change one, change both.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const RETRYABLE_CATEGORIES = new Set(["timeout", "network", "rate_limit", "server_temporary"]);

export function isRetryableCategory(category) {
  return RETRYABLE_CATEGORIES.has(category);
}

export class ExternalRequestError extends Error {
  constructor(category, message, meta) {
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

export function toLogFields(error) {
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

export function sanitizeProviderText(text) {
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

export function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return "auth_config";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_temporary";
  return "permanent_client";
}

// For SDK errors that don't go through fetch() (the ali-oss client throws
// its own error shape carrying .status/.code) — classifies by the same
// status-code table when a status is present, otherwise infers timeout/auth/
// network from the SDK's own error code, and always sanitizes the resulting
// message before it can reach a log or DB errorMessage column.
export function wrapProviderError(error, meta) {
  if (error instanceof ExternalRequestError) {
    return error;
  }

  const status = typeof error?.status === "number" ? error.status : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;

  let category;

  if (status !== undefined) {
    category = classifyHttpStatus(status);
  } else if (code && /timeout/i.test(code)) {
    category = "timeout";
  } else if (code === "AccessDenied" || code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") {
    category = "auth_config";
  } else {
    category = "network";
  }

  const detail = [code, typeof error?.message === "string" ? error.message : undefined]
    .filter(Boolean)
    .join(": ");

  return new ExternalRequestError(
    category,
    `${meta.provider} ${meta.operation} failed: ${sanitizeProviderText(detail || "Unknown error")}`,
    { ...meta, status },
  );
}

function classifyThrownError(error) {
  const name = error instanceof Error ? error.name : undefined;

  if (name === "AbortError" || name === "TimeoutError") {
    return "timeout";
  }

  return "network";
}

function toRequestError(error, meta) {
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

function tryParseJson(text) {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractProviderMessage(bodyText, parsed) {
  if (parsed && typeof parsed === "object") {
    const nestedError = parsed.error && typeof parsed.error === "object" ? parsed.error : undefined;
    const message =
      (typeof nestedError?.message === "string" ? nestedError.message : undefined) ??
      (typeof parsed.message === "string" ? parsed.message : undefined) ??
      (typeof parsed.code === "string" ? parsed.code : undefined);

    if (message) {
      return sanitizeProviderText(message);
    }
  }

  return bodyText.trim() ? sanitizeProviderText(bodyText) : undefined;
}

const DEFAULT_JSON_MAX_BYTES = 10 * 1024 * 1024;

async function readBoundedText(response, maxBytes, meta) {
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
  const chunks = [];
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

// Fetch + AbortSignal.timeout (covers connect, headers, AND body read) +
// bounded body read + JSON parse, folded into one classified-error call.
export async function requestJson({ url, init, timeoutMs, provider, operation, maxBytes }) {
  const effectiveMaxBytes = maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  const meta = { provider, operation, timeoutMs };

  let response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw toRequestError(error, meta);
  }

  const bodyText = await readBoundedText(response, effectiveMaxBytes, meta);
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

  return { data: parsed, status: response.status };
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertAllowedProtocol(url, allowHttp, meta) {
  let protocol;

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

async function streamToFile(body, destPath, maxBytes, meta) {
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
    await pipeline(Readable.fromWeb(body), limiter, createWriteStream(destPath));
  } catch (error) {
    await rm(destPath, { force: true });
    throw error instanceof ExternalRequestError ? error : toRequestError(error, meta);
  }
}

const DEFAULT_MAX_REDIRECTS = 5;

// Streams a remote URL to disk with a bounded size and a manual (capped,
// protocol-revalidated-per-hop) redirect loop. Never buffers the body in
// memory.
export async function downloadToFile({
  url,
  destPath,
  timeoutMs,
  maxBytes,
  provider,
  operation,
  allowHttp,
  maxRedirects,
  expectedContentTypePrefixes,
}) {
  const effectiveMaxRedirects = maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const effectiveAllowHttp = allowHttp ?? process.env.NODE_ENV !== "production";
  const meta = { provider, operation, timeoutMs };

  let currentUrl = url;
  let response;

  for (let hop = 0; hop <= effectiveMaxRedirects; hop++) {
    assertAllowedProtocol(currentUrl, effectiveAllowHttp, meta);

    let hopResponse;

    try {
      hopResponse = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw toRequestError(error, meta);
    }

    if (isRedirectStatus(hopResponse.status)) {
      if (hop === effectiveMaxRedirects) {
        throw new ExternalRequestError(
          "permanent_client",
          `${provider} ${operation} exceeded the maximum of ${effectiveMaxRedirects} redirects.`,
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
      `${provider} ${operation} exceeded the maximum of ${effectiveMaxRedirects} redirects.`,
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

  if (expectedContentTypePrefixes?.length) {
    const contentType = response.headers.get("content-type") ?? "";
    const matches = expectedContentTypePrefixes.some((prefix) => contentType.startsWith(prefix));

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
