import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getQwenRequestTimeoutMs,
  getMediaDownloadMaxBytes,
  getHealthCheckTimeoutMs,
  __resetTimeoutConfigCacheForTests,
} from "~/services/http/timeout-config.server";

const ENV_KEYS = ["QWEN_REQUEST_TIMEOUT_MS", "MEDIA_DOWNLOAD_MAX_BYTES", "HEALTH_CHECK_TIMEOUT_MS"];
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  __resetTimeoutConfigCacheForTests();
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  __resetTimeoutConfigCacheForTests();
});

test("timeout config: unset env var falls back to the documented default", () => {
  assert.equal(getQwenRequestTimeoutMs(), 60_000);
});

test("timeout config: a valid override is honored", () => {
  process.env.QWEN_REQUEST_TIMEOUT_MS = "12345";
  assert.equal(getQwenRequestTimeoutMs(), 12345);
});

test("timeout config: memoizes after first read within a process", () => {
  process.env.QWEN_REQUEST_TIMEOUT_MS = "1000";
  assert.equal(getQwenRequestTimeoutMs(), 1000);

  process.env.QWEN_REQUEST_TIMEOUT_MS = "2000";
  // No cache reset — must still return the first-read value.
  assert.equal(getQwenRequestTimeoutMs(), 1000);
});

test("timeout config: non-numeric value throws instead of silently disabling the timeout", () => {
  process.env.QWEN_REQUEST_TIMEOUT_MS = "not-a-number";
  assert.throws(() => getQwenRequestTimeoutMs(), /Invalid QWEN_REQUEST_TIMEOUT_MS/);
});

test("timeout config: zero throws (a zero timeout is effectively disabled protection)", () => {
  process.env.QWEN_REQUEST_TIMEOUT_MS = "0";
  assert.throws(() => getQwenRequestTimeoutMs(), /Invalid QWEN_REQUEST_TIMEOUT_MS/);
});

test("timeout config: negative value throws", () => {
  process.env.QWEN_REQUEST_TIMEOUT_MS = "-500";
  assert.throws(() => getQwenRequestTimeoutMs(), /Invalid QWEN_REQUEST_TIMEOUT_MS/);
});

test("timeout config: NaN throws", () => {
  process.env.HEALTH_CHECK_TIMEOUT_MS = "NaN";
  assert.throws(() => getHealthCheckTimeoutMs(), /Invalid HEALTH_CHECK_TIMEOUT_MS/);
});

test("timeout config: absurdly large value throws instead of silently accepting it", () => {
  process.env.MEDIA_DOWNLOAD_MAX_BYTES = String(100 * 1024 * 1024 * 1024 * 1024); // 100TB
  assert.throws(() => getMediaDownloadMaxBytes(), /exceeds the maximum allowed/);
});

test("timeout config: a large-but-reasonable byte value is honored", () => {
  process.env.MEDIA_DOWNLOAD_MAX_BYTES = String(500 * 1024 * 1024);
  assert.equal(getMediaDownloadMaxBytes(), 500 * 1024 * 1024);
});
