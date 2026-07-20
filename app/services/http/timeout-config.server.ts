// Central place every timeout/max-size env var is parsed and validated.
// Unset -> the documented default. Set but non-numeric/zero/negative/absurdly
// large -> throws (fail loud at first use) rather than silently falling back
// to "no timeout" — a typo here must not quietly disable the protection this
// whole module exists to provide. Mirrored in scripts/lib/timeout-config.mjs
// for scripts/video-worker.mjs, which runs via plain `node` and cannot import
// this TS module (see CLAUDE.md's note on that worker's duplication pattern).
// If you change a default or add a var here, change both.

const MAX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — beyond this a "timeout" isn't protecting anything.
const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GB — generous ceiling for a single media file.

const cache = new Map<string, number>();

function parseBoundedInt(name: string, defaultValue: number, maxValue: number): number {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const raw = process.env[name];
  let value: number;

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

export function getQwenRequestTimeoutMs(): number {
  return parseBoundedInt("QWEN_REQUEST_TIMEOUT_MS", 60_000, MAX_TIMEOUT_MS);
}

export function getQwenVisionRequestTimeoutMs(): number {
  return parseBoundedInt("QWEN_VISION_REQUEST_TIMEOUT_MS", 45_000, MAX_TIMEOUT_MS);
}

export function getWanCreateTimeoutMs(): number {
  return parseBoundedInt("WAN_CREATE_TIMEOUT_MS", 30_000, MAX_TIMEOUT_MS);
}

export function getWanPollTimeoutMs(): number {
  return parseBoundedInt("WAN_POLL_TIMEOUT_MS", 15_000, MAX_TIMEOUT_MS);
}

export function getTtsRequestTimeoutMs(): number {
  return parseBoundedInt("TTS_REQUEST_TIMEOUT_MS", 60_000, MAX_TIMEOUT_MS);
}

export function getMediaDownloadTimeoutMs(): number {
  return parseBoundedInt("MEDIA_DOWNLOAD_TIMEOUT_MS", 120_000, MAX_TIMEOUT_MS);
}

export function getMediaDownloadMaxBytes(): number {
  return parseBoundedInt("MEDIA_DOWNLOAD_MAX_BYTES", 200 * 1024 * 1024, MAX_BYTES);
}

export function getOssRequestTimeoutMs(): number {
  return parseBoundedInt("OSS_REQUEST_TIMEOUT_MS", 10_000, MAX_TIMEOUT_MS);
}

export function getHealthCheckTimeoutMs(): number {
  return parseBoundedInt("HEALTH_CHECK_TIMEOUT_MS", 5_000, MAX_TIMEOUT_MS);
}

// Test-only: clears the memoization cache so a test can set env vars and
// re-derive config within the same process.
export function __resetTimeoutConfigCacheForTests(): void {
  cache.clear();
}
