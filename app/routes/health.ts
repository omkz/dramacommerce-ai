import { pool } from "~/services/db.server";
import { getVideoQueue } from "~/services/video-queue.server";

type HealthCheck = {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
};

export async function loader() {
  const [database, redis] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  const healthy = database.status === "ok" && redis.status === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "error",
      checks: {
        database,
        redis,
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

function getLatency(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
