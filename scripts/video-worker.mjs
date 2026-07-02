import { Queue, Worker } from "bullmq";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

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

    if (job.name === "video.stitch") {
      await stitchFinalVideo(job.data);
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

async function createWanTask({ projectId, scene, prompt, voiceOver }) {
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
    { projectId, scene, taskId: task.taskId, voiceOver },
    {
      delay: POLL_DELAY_MS,
      attempts: 10,
      backoff: { type: "fixed", delay: POLL_DELAY_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

async function pollWanTask({ projectId, scene, taskId, voiceOver }) {
  const task = await queryWanVideoTask(taskId);
  const now = new Date().toISOString();
  const nextPollAt = getNextPollAt(task.status);

  let videoUrl = task.videoUrl ?? null;

  if (task.status === "SUCCEEDED" && videoUrl) {
    try {
      videoUrl = await narrateAndMuxScene(videoUrl, voiceOver, projectId, scene);
    } catch (error) {
      console.error(
        `Voice-over synthesis/mux failed for project ${projectId} scene ${scene}, keeping silent clip:`,
        error,
      );
    }
  }

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
      videoUrl,
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
      { projectId, scene, taskId, voiceOver },
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

async function narrateAndMuxScene(videoUrl, voiceOver, projectId, scene) {
  const tempDir = path.join(os.tmpdir(), `dramacommerce-narrate-${projectId}-${scene}`);

  try {
    await mkdir(tempDir, { recursive: true });

    const videoPath = path.join(tempDir, "video.mp4");
    const audioPath = path.join(tempDir, "audio.mp3");

    // Downloading the Wan clip and synthesizing the voice-over are
    // independent — run them concurrently instead of waiting on TTS
    // before even starting the (much larger) video download.
    const [, audioUrl] = await Promise.all([
      downloadFile(videoUrl, videoPath),
      synthesizeVoiceOver(voiceOver),
    ]);

    await downloadFile(audioUrl, audioPath);

    const outputFilename = `${randomUUID()}.mp4`;
    const tempOutputPath = path.join(tempDir, outputFilename);
    await muxVideoWithAudio(videoPath, audioPath, tempOutputPath);

    await mkdir(UPLOAD_DIR, { recursive: true });
    await copyFile(tempOutputPath, path.join(UPLOAD_DIR, outputFilename));

    return `/uploads/${outputFilename}`;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function muxVideoWithAudio(videoPath, audioPath, outputPath) {
  // -af apad pads the audio with silence if it's shorter than the video, so
  // -shortest always caps the output at the video's real length — without
  // apad, a short voice-over line would truncate the video to match it.
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-af",
    "apad",
    "-shortest",
    outputPath,
  ]);
}

async function synthesizeVoiceOver(text) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_TTS_BASE_URL || process.env.DASHSCOPE_VIDEO_BASE_URL;
  const model = process.env.DASHSCOPE_TTS_MODEL || "qwen3-tts-flash";
  const voice = process.env.DASHSCOPE_TTS_VOICE || "Cherry";

  if (!apiKey || !baseUrl) {
    throw new Error("TTS environment variables are not configured.");
  }

  const response = await fetch(
    `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: {
          text,
          voice,
          language_type: "Auto",
        },
      }),
    },
  );

  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.message || data.code || `TTS API error: ${response.status}`);
  }

  const audioUrl = data.output?.audio?.url;

  if (!audioUrl) {
    throw new Error("TTS did not return an audio URL.");
  }

  return audioUrl;
}

async function stitchFinalVideo({ projectId }) {
  const now = new Date().toISOString();

  await pool.query(
    `UPDATE final_videos SET status = $1, updated_at = $2 WHERE project_id = $3`,
    ["RUNNING", now, projectId],
  );

  const { rows } = await pool.query(
    `SELECT scene, status, video_url FROM video_jobs WHERE project_id = $1 ORDER BY scene`,
    [projectId],
  );

  const missingOrFailed = rows.length < 5 || rows.some((row) => row.status !== "SUCCEEDED" || !row.video_url);

  if (missingOrFailed) {
    await updateFinalVideo(projectId, {
      status: "FAILED",
      errorMessage: "Not all 5 scenes have a successful video yet.",
    });
    return;
  }

  const tempDir = path.join(os.tmpdir(), `dramacommerce-stitch-${projectId}`);

  try {
    await mkdir(tempDir, { recursive: true });

    // Downloaded concurrently — Promise.all preserves the input order
    // (already `ORDER BY scene` from the query) regardless of which
    // download finishes first, so the concat list stays in scene order.
    const clipPaths = await Promise.all(
      rows.map(async (row) => {
        const clipPath = path.join(tempDir, `scene-${row.scene}.mp4`);
        await downloadFile(row.video_url, clipPath);
        return clipPath;
      }),
    );

    const listPath = path.join(tempDir, "list.txt");
    const listContent = clipPaths
      .map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, listContent, "utf8");

    const outputFilename = `${randomUUID()}.mp4`;
    const tempOutputPath = path.join(tempDir, outputFilename);

    await runFfmpegConcat(listPath, tempOutputPath);

    await mkdir(UPLOAD_DIR, { recursive: true });
    await copyFile(tempOutputPath, path.join(UPLOAD_DIR, outputFilename));

    await updateFinalVideo(projectId, {
      status: "SUCCEEDED",
      videoUrl: `/uploads/${outputFilename}`,
    });
  } catch (error) {
    await updateFinalVideo(projectId, {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown stitching error.",
    });

    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function updateFinalVideo(projectId, { status, videoUrl, errorMessage }) {
  await pool.query(
    `
    UPDATE final_videos
    SET status = $1,
        video_url = $2,
        error_message = $3,
        updated_at = $4
    WHERE project_id = $5
  `,
    [status, videoUrl ?? null, errorMessage ?? null, new Date().toISOString(), projectId],
  );
}

async function downloadFile(url, destPath) {
  // Narrated scene clips are saved locally and referenced as "/uploads/..."
  // (relative paths, meant for the browser to resolve against the app's own
  // origin) rather than absolute URLs like Wan's — fetch() can't resolve a
  // relative path with no base, so read those straight off disk instead.
  // Same path-traversal guard as routes/uploads.$filename.tsx.
  if (url.startsWith("/uploads/")) {
    const filename = url.slice("/uploads/".length);

    if (!filename || filename.includes("/") || filename.includes("..")) {
      throw new Error(`Invalid upload path: ${url}`);
    }

    await copyFile(path.join(UPLOAD_DIR, filename), destPath);
    return;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download clip: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(arrayBuffer));
}

async function runFfmpegConcat(listPath, outputPath) {
  const baseArgs = ["-y", "-f", "concat", "-safe", "0", "-i", listPath];

  try {
    await execFileAsync("ffmpeg", [...baseArgs, "-c", "copy", outputPath]);
  } catch (copyError) {
    console.warn(
      "ffmpeg stream-copy concat failed, retrying with re-encode:",
      copyError.message,
    );

    await execFileAsync("ffmpeg", [
      ...baseArgs,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      outputPath,
    ]);
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
