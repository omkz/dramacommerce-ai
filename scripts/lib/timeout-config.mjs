// Plain-JS mirror of app/services/http/timeout-config.server.ts for
// scripts/video-worker.mjs (runs via plain `node`, cannot import TS modules —
// see CLAUDE.md's note on that worker's duplication pattern). Keep both in
// sync: same var names, same defaults, same validation.

const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024 * 1024;

const cache = new Map();

function parseBoundedInt(name, defaultValue, maxValue) {
  if (cache.has(name)) {
    return cache.get(name);
  }

  const raw = process.env[name];
  let value;

  if (raw === undefined || raw.trim() === "") {
    value = defaultValue;
  } else {
    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid ${name}="${raw}": must be a positive integer (milliseconds or bytes).`,
      );
    }

    if (parsed > maxValue) {
      throw new Error(`Invalid ${name}="${raw}": exceeds the maximum allowed value of ${maxValue}.`);
    }

    value = parsed;
  }

  cache.set(name, value);
  return value;
}

export function getWanCreateTimeoutMs() {
  return parseBoundedInt("WAN_CREATE_TIMEOUT_MS", 30_000, MAX_TIMEOUT_MS);
}

export function getWanPollTimeoutMs() {
  return parseBoundedInt("WAN_POLL_TIMEOUT_MS", 15_000, MAX_TIMEOUT_MS);
}

export function getTtsRequestTimeoutMs() {
  return parseBoundedInt("TTS_REQUEST_TIMEOUT_MS", 60_000, MAX_TIMEOUT_MS);
}

export function getMediaDownloadTimeoutMs() {
  return parseBoundedInt("MEDIA_DOWNLOAD_TIMEOUT_MS", 120_000, MAX_TIMEOUT_MS);
}

export function getMediaDownloadMaxBytes() {
  return parseBoundedInt("MEDIA_DOWNLOAD_MAX_BYTES", 200 * 1024 * 1024, MAX_BYTES);
}

export function getOssRequestTimeoutMs() {
  return parseBoundedInt("OSS_REQUEST_TIMEOUT_MS", 10_000, MAX_TIMEOUT_MS);
}
