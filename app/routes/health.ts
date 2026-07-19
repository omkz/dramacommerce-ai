import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "~/services/db.server";
import { getVideoQueue } from "~/services/video-queue.server";
import { getMediaStorage } from "~/services/storage/media-storage.server";
import { getOutboxStats } from "~/services/outbox.server";

const execFileAsync = promisify(execFile);

type HealthCheck = {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
};

type OutboxHealthCheck = HealthCheck & {
  pendingCount?: number;
  oldestPendingAgeSeconds?: number | null;
  failedCount?: number;
};

export async function loader() {
  const [database, redis, environment, ffmpeg, storage, outbox] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkEnvironment(),
    checkFfmpeg(),
    checkStorage(),
    checkOutbox(),
  ]);

  const healthy = [database, redis, environment, ffmpeg, storage, outbox].every(
    (check) => check.status === "ok",
  );

  return Response.json(
    {
      status: healthy ? "ok" : "error",
      checks: {
        database,
        redis,
        environment,
        ffmpeg,
        storage,
        outbox,
      },
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
    },
  );
}

async function checkDatabase(): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await pool.query("SELECT 1");

    return {
      status: "ok",
      latencyMs: getLatency(startedAt),
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: getLatency(startedAt),
      message: getErrorMessage(error),
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await getVideoQueue().getJobCounts("waiting");

    return {
      status: "ok",
      latencyMs: getLatency(startedAt),
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: getLatency(startedAt),
      message: getErrorMessage(error),
    };
  }
}

async function checkEnvironment(): Promise<HealthCheck> {
  const requiredEnv = [
    "DATABASE_URL",
    "REDIS_URL",
    "DASHSCOPE_API_KEY",
    "QWEN_BASE_URL",
    "DASHSCOPE_VIDEO_BASE_URL",
    // Missing any of these breaks every page, not just video generation:
    // auth.server.ts reads them eagerly at module load, so the whole
    // app-layout loader (and therefore every route under it) throws.
    "AUTH_SECRET",
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    ...(process.env.MEDIA_STORAGE_DRIVER === "oss"
      ? ["OSS_REGION", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"]
      : []),
  ];
  const missing = requiredEnv.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    return {
      status: "error",
      message: `Missing required environment variables: ${missing.join(", ")}`,
    };
  }

  return { status: "ok" };
}

// Local mode: verifies the uploads/ directory is actually writable (not
// just present) via a real write+delete probe. OSS mode: verifies required
// config is present, then performs a lightweight connectivity check. Never
// includes credentials in the response — the driver's healthCheck() already
// returns a sanitized {status, message}.
async function checkStorage(): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    const result = await getMediaStorage().healthCheck();

    return {
      status: result.status,
      latencyMs: getLatency(startedAt),
      message: result.message,
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: getLatency(startedAt),
      message: getErrorMessage(error),
    };
  }
}

const OUTBOX_STALE_THRESHOLD_SECONDS = Number(
  process.env.OUTBOX_HEALTH_STALE_THRESHOLD_SECONDS || "120",
);

// There's no direct way to "ping" a separate dispatcher process, so its
// health is inferred from outbox freshness: a pending event that's been
// sitting for longer than a normal dispatch cycle strongly suggests no
// dispatcher instance is running (or it can't reach Postgres/Redis). Counts
// only — never event payloads, which may carry user-submitted brief text.
async function checkOutbox(): Promise<OutboxHealthCheck> {
  const startedAt = performance.now();

  try {
    const stats = await getOutboxStats();
    const isStale =
      stats.oldestPendingAgeSeconds !== null &&
      stats.oldestPendingAgeSeconds > OUTBOX_STALE_THRESHOLD_SECONDS;

    return {
      status: isStale ? "error" : "ok",
      latencyMs: getLatency(startedAt),
      message: isStale
        ? `Oldest pending outbox event is ${stats.oldestPendingAgeSeconds}s old (threshold ${OUTBOX_STALE_THRESHOLD_SECONDS}s) — the outbox dispatcher may not be running.`
        : undefined,
      pendingCount: stats.pendingCount,
      oldestPendingAgeSeconds: stats.oldestPendingAgeSeconds,
      failedCount: stats.failedCount,
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: getLatency(startedAt),
      message: getErrorMessage(error),
    };
  }
}

async function checkFfmpeg(): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 3_000 });

    return {
      status: "ok",
      latencyMs: getLatency(startedAt),
    };
  } catch (error) {
    return {
      status: "error",
      latencyMs: getLatency(startedAt),
      message: `ffmpeg is required for voice-over muxing, product image overlay, and final stitching. ${getErrorMessage(error)}`,
    };
  }
}

function getLatency(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
