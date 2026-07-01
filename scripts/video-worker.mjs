import { Queue, Worker } from "bullmq";
import pg from "pg";

const VIDEO_QUEUE_NAME = "video-generation";
const POLL_DELAY_MS = Number(process.env.VIDEO_WORKER_POLL_DELAY_MS || "30000");
const CONCURRENCY = Number(process.env.VIDEO_WORKER_CONCURRENCY || "2");

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!redisUrl) {
  throw new Error("REDIS_URL is required.");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const connection = getRedisConnection(redisUrl);
const queue = new Queue(VIDEO_QUEUE_NAME, { connection });

await ensureDatabaseSchema();

const worker = new Worker(
  VIDEO_QUEUE_NAME,
  async (job) => {
    if (job.name === "video.create") {
      await createWanTask(job.data);
      return;
    }

    if (job.name === "video.poll") {
      await pollWanTask(job.data);
      return;
    }

    throw new Error(`Unknown video job: ${job.name}`);
  },
  {
    connection,
    concurrency: CONCURRENCY,
  },
);

worker.on("completed", (job) => {
  console.log(`Completed ${job.name} ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Failed ${job?.name ?? "unknown"} ${job?.id ?? "unknown"}:`, error);
});

console.log(
  `Video worker started. Queue: ${VIDEO_QUEUE_NAME}. Concurrency: ${CONCURRENCY}.`,
);

async function createWanTask({ projectId, scene, prompt }) {
  const task = await createWanTextToVideoTask(prompt);
  const now = new Date().toISOString();
  const nextPollAt = new Date(Date.now() + POLL_DELAY_MS).toISOString();

  await pool.query(
    `
    UPDATE video_jobs
    SET task_id = $1,
        status = $2,
        attempts = attempts + 1,
        next_poll_at = $3,
        updated_at = $4
    WHERE project_id = $5 AND scene = $6
  `,
    [task.taskId, task.status, nextPollAt, now, projectId, scene],
  );

  await queue.add(
    "video.poll",
    { projectId, scene, taskId: task.taskId },
    {
      delay: POLL_DELAY_MS,
      attempts: 10,
      backoff: { type: "fixed", delay: POLL_DELAY_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

async function pollWanTask({ projectId, scene, taskId }) {
  const task = await queryWanVideoTask(taskId);
  const now = new Date().toISOString();
  const nextPollAt = getNextPollAt(task.status);

  await pool.query(
    `
    UPDATE video_jobs
    SET status = $1,
        video_url = $2,
        error_message = $3,
        attempts = attempts + 1,
        last_polled_at = $4,
        next_poll_at = $5,
        updated_at = $6
    WHERE project_id = $7 AND scene = $8
  `,
    [
      task.status,
      task.videoUrl ?? null,
      task.errorMessage ?? null,
      now,
      nextPollAt,
      now,
      projectId,
      scene,
    ],
  );

  if (nextPollAt) {
    await queue.add(
      "video.poll",
      { projectId, scene, taskId },
      {
        delay: POLL_DELAY_MS,
        attempts: 10,
        backoff: { type: "fixed", delay: POLL_DELAY_MS },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }
}

async function createWanTextToVideoTask(prompt) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;
  const model = process.env.WAN_VIDEO_MODEL || "wan2.1-t2v-turbo";

  if (!apiKey || !baseUrl) {
    throw new Error("Wan video environment variables are not configured.");
  }

  const response = await fetch(
    `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: {
          resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
          ratio: process.env.WAN_VIDEO_RATIO || "9:16",
          duration: Number(process.env.WAN_VIDEO_DURATION || "5"),
          prompt_extend: true,
          watermark: true,
        },
      }),
    },
  );

  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.message || data.code || `Wan API error: ${response.status}`);
  }

  const taskId = data.output?.task_id;

  if (!taskId) {
    throw new Error("Wan did not return a task_id.");
  }

  return {
    taskId,
    status: normalizeStatus(data.output?.task_status),
  };
}

async function queryWanVideoTask(taskId) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;

  if (!apiKey || !baseUrl) {
    throw new Error("Wan video environment variables are not configured.");
  }

  const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      data.message || data.code || `Wan task query error: ${response.status}`,
    );
  }

  const output = data.output;

  if (!output?.task_id) {
    throw new Error("Wan returned an invalid task result.");
  }

  return {
    taskId: output.task_id,
    status: normalizeStatus(output.task_status),
    videoUrl: output.video_url,
    errorMessage: output.message,
  };
}

async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      show_plan JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_jobs (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'wan',
      queue_job_id TEXT,
      task_id TEXT,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      video_url TEXT,
      error_message TEXT,
      last_polled_at TIMESTAMPTZ,
      next_poll_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (project_id, scene)
    );
  `);
}

function getNextPollAt(status) {
  if (status === "PENDING" || status === "RUNNING" || status === "UNKNOWN") {
    return new Date(Date.now() + POLL_DELAY_MS).toISOString();
  }

  return null;
}

function normalizeStatus(status) {
  if (
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELED"
  ) {
    return status;
  }

  return "UNKNOWN";
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `Wan API returned an empty response. Status: ${response.status} ${response.statusText}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Wan API returned non-JSON response. Status: ${response.status} ${response.statusText}. Body: ${text.slice(
        0,
        500,
      )}`,
    );
  }
}

function getRedisConnection(redisUrl) {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || "0"),
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}
