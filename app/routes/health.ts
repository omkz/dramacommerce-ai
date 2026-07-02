import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "~/services/db.server";
import { getVideoQueue } from "~/services/video-queue.server";

const execFileAsync = promisify(execFile);

type HealthCheck = {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
};

export async function loader() {
  const [database, redis, environment, ffmpeg] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkEnvironment(),
    checkFfmpeg(),
  ]);

  const healthy = [database, redis, environment, ffmpeg].every(
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
