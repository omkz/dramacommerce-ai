import { Queue, Worker } from "bullmq";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  saveGeneratedFile,
  readManagedAsDataUrl,
  downloadToPath,
} from "./lib/media-storage.mjs";

const execFileAsync = promisify(execFile);

const VIDEO_QUEUE_NAME = "video-generation";
const POLL_DELAY_MS = Number(process.env.VIDEO_WORKER_POLL_DELAY_MS || "30000");
const CONCURRENCY = Number(process.env.VIDEO_WORKER_CONCURRENCY || "2");
// If a worker crashes after flipping a scene to RUNNING but before ever
// calling Wan (or before persisting task_id), that row is stuck RUNNING
// forever with no way to distinguish it from "another attempt is
// legitimately still in flight". Below this grace period, a retry for the
// same generation is treated as a likely-duplicate-in-progress and skipped
// (favoring "don't call Wan twice"); beyond it, the row is treated as
// abandoned and the retry proceeds (favoring "don't get stuck forever").
// See createWanTask's stale/duplicate-guard comment for the full tradeoff.
const WAN_TASK_STALE_RUNNING_GRACE_MS = Number(
  process.env.WAN_TASK_STALE_RUNNING_GRACE_MS || 5 * 60 * 1000,
);

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
    try {
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
    } catch (error) {
      await markFailedIfRetryExhausted(job, error);
      throw error;
    }
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

async function markFailedIfRetryExhausted(job, error) {
  if (willRetry(job)) {
    return;
  }

  const message = getWorkerFailureMessage(error);

  if (job.name === "video.create" || job.name === "video.poll") {
    await updateVideoJobFailure(
      job.data.projectId,
      job.data.scene,
      job.data.generationId,
      message,
    );
    return;
  }

  if (job.name === "video.stitch") {
    await updateFinalVideo(job.data.projectId, job.data.stitchGenerationId, {
      status: "FAILED",
      errorMessage: message,
    });
  }
}

function willRetry(job) {
  const maxAttempts = job.opts.attempts ?? 1;

  return job.attemptsMade + 1 < maxAttempts;
}

// Scoped to generationId so an old job's exhausted retries can't mark a
// *newer* generation (the user regenerated this scene while the stale job
// was still retrying) as failed. Logs when that happens since it's a sign
// the scene was regenerated mid-flight, not an error.
async function updateVideoJobFailure(projectId, scene, generationId, errorMessage) {
  const result = await pool.query(
    `
    UPDATE video_jobs
    SET status = $1,
        error_message = $2,
        next_poll_at = NULL,
        updated_at = $3
    WHERE project_id = $4 AND scene = $5 AND generation_id = $6
  `,
    ["FAILED", errorMessage, new Date().toISOString(), projectId, scene, generationId],
  );

  if (result.rowCount === 0) {
    console.log(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: retries exhausted for a superseded generation, not marking FAILED.`,
    );
  }
}

// Claims this generation for a Wan call by conditionally transitioning
// QUEUED -> RUNNING scoped to generationId. This is the "before calling
// Wan, confirm the row still has that generation ID" check from the design
// doc, plus a bounded mitigation for the one gap that can't be closed
// without provider-side idempotency keys: a worker crashing after this
// transition but before task_id is saved leaves the row RUNNING with no
// way to tell "another attempt is still genuinely in flight" apart from
// "that attempt died and this retry should proceed". We resolve that
// ambiguity with WAN_TASK_STALE_RUNNING_GRACE_MS — see its definition above.
async function claimGenerationForWanCall(projectId, scene, generationId) {
  const claimed = await pool.query(
    `
    UPDATE video_jobs
    SET status = 'RUNNING', updated_at = $1
    WHERE project_id = $2 AND scene = $3 AND generation_id = $4 AND status = 'QUEUED'
  `,
    [new Date().toISOString(), projectId, scene, generationId],
  );

  if (claimed.rowCount > 0) {
    return "claimed";
  }

  const { rows } = await pool.query(
    `SELECT status, updated_at FROM video_jobs WHERE project_id = $1 AND scene = $2 AND generation_id = $3`,
    [projectId, scene, generationId],
  );
  const row = rows[0];

  if (!row || row.status !== "RUNNING") {
    // No row under this generation_id (superseded by a newer regenerate),
    // or it's already terminal (a duplicate delivery of a job that already
    // completed/failed) — either way, stale.
    return "stale";
  }

  const runningForMs = Date.now() - new Date(row.updated_at).getTime();

  return runningForMs < WAN_TASK_STALE_RUNNING_GRACE_MS
    ? "likely-in-progress"
    : "resumed-abandoned";
}

async function createWanTask({
  projectId,
  scene,
  prompt,
  voiceOver,
  productImageUrl,
  useProductReference,
  showOverlay,
  aspectRatio,
  generationId,
}) {
  const claim = await claimGenerationForWanCall(projectId, scene, generationId);

  if (claim === "stale") {
    console.log(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: generation superseded before the Wan call, skipping.`,
    );
    return;
  }

  if (claim === "likely-in-progress") {
    console.warn(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: already RUNNING within the ${WAN_TASK_STALE_RUNNING_GRACE_MS}ms grace period — skipping to avoid a likely duplicate Wan task. If this generation is genuinely stuck (not actually in flight), it will be retried automatically once the grace period elapses.`,
    );
    return;
  }

  if (claim === "resumed-abandoned") {
    console.warn(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: resuming a generation that has been RUNNING for over ${WAN_TASK_STALE_RUNNING_GRACE_MS}ms with no task_id saved — a duplicate Wan task is possible if the earlier attempt is still in flight server-side.`,
    );
  }

  const imgDataUrl =
    useProductReference && productImageUrl
      ? await readManagedAsDataUrl(productImageUrl)
      : null;
  const task = await createWanTextToVideoTask(prompt, imgDataUrl, aspectRatio);
  const now = new Date().toISOString();
  const nextPollAt = new Date(Date.now() + POLL_DELAY_MS).toISOString();

  const result = await pool.query(
    `
    UPDATE video_jobs
    SET task_id = $1,
        status = $2,
        attempts = attempts + 1,
        next_poll_at = $3,
        updated_at = $4
    WHERE project_id = $5 AND scene = $6 AND generation_id = $7
    RETURNING attempts
  `,
    [task.taskId, task.status, nextPollAt, now, projectId, scene, generationId],
  );

  if (result.rowCount === 0) {
    // The scene was regenerated again in the narrow window between the Wan
    // call above and this write. Wan was already asked to render task
    // ${task.taskId} — there is no provider-side cancellation available, so
    // that render completes and is billed regardless; this just avoids
    // recording its result against a generation that's no longer current.
    console.log(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: generation superseded between the Wan call and saving task_id (task ${task.taskId} discarded).`,
    );
    return;
  }

  const attempts = result.rows[0].attempts;

  await queue.add(
    "video.poll",
    {
      projectId,
      scene,
      taskId: task.taskId,
      voiceOver,
      productImageUrl,
      useProductReference,
      showOverlay,
      generationId,
    },
    {
      // Deterministic per actual poll attempt (attempts increments each
      // cycle) — cheap insurance against BullMQ-level redelivery. Not
      // routed through the outbox: see the design note in CLAUDE.md on why
      // poll self-rescheduling stays a direct queue.add() here.
      jobId: `video-poll_${projectId}_${scene}_${task.taskId}_${attempts}`,
      delay: POLL_DELAY_MS,
      attempts: 10,
      backoff: { type: "fixed", delay: POLL_DELAY_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

async function isGenerationCurrent(projectId, scene, generationId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM video_jobs WHERE project_id = $1 AND scene = $2 AND generation_id = $3`,
    [projectId, scene, generationId],
  );

  return rows.length > 0;
}

async function pollWanTask({
  projectId,
  scene,
  taskId,
  voiceOver,
  productImageUrl,
  useProductReference,
  showOverlay,
  generationId,
}) {
  // Cheap up-front check so a poll for an already-superseded generation
  // doesn't pay for TTS synthesis / storage writes it's just going to
  // discard below — the UPDATE's own generation_id match afterwards is the
  // authoritative guard (a regenerate can still race in between).
  if (!(await isGenerationCurrent(projectId, scene, generationId))) {
    console.log(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: skipping poll, generation superseded.`,
    );
    return;
  }

  const task = await queryWanVideoTask(taskId);
  const now = new Date().toISOString();
  const nextPollAt = getNextPollAt(task.status);

  let videoUrl = task.videoUrl ?? null;
  let processingWarning = null;

  if (task.status === "SUCCEEDED" && videoUrl) {
    try {
      videoUrl = await narrateAndMuxScene(
        videoUrl,
        voiceOver,
        productImageUrl,
        projectId,
        scene,
        useProductReference,
        showOverlay,
      );
    } catch (error) {
      processingWarning =
        "Scene video succeeded, but voice-over or product overlay failed: " +
        getWorkerFailureMessage(error);
      console.error(
        `Voice-over synthesis/mux failed for project ${projectId} scene ${scene}, keeping silent clip:`,
        error,
      );
    }
  }

  // The authoritative staleness guard: only writes if generation_id still
  // matches, so an old poll job can never overwrite a newer generation's
  // state (requirement: "an old poll job must not overwrite a newer
  // generation").
  const result = await pool.query(
    `
    UPDATE video_jobs
    SET status = $1,
        video_url = $2,
        error_message = $3,
        attempts = attempts + 1,
        last_polled_at = $4,
        next_poll_at = $5,
        updated_at = $6
    WHERE project_id = $7 AND scene = $8 AND generation_id = $9
    RETURNING attempts
  `,
    [
      task.status,
      videoUrl,
      processingWarning ?? task.errorMessage ?? null,
      now,
      nextPollAt,
      now,
      projectId,
      scene,
      generationId,
    ],
  );

  if (result.rowCount === 0) {
    console.log(
      `[stale] project=${projectId} scene=${scene} generationId=${generationId}: poll result discarded, generation superseded.`,
    );
    return;
  }

  if (nextPollAt) {
    const attempts = result.rows[0].attempts;

    await queue.add(
      "video.poll",
      {
        projectId,
        scene,
        taskId,
        voiceOver,
        productImageUrl,
        useProductReference,
        showOverlay,
        generationId,
      },
      {
        jobId: `video-poll_${projectId}_${scene}_${taskId}_${attempts}`,
        delay: POLL_DELAY_MS,
        attempts: 10,
        backoff: { type: "fixed", delay: POLL_DELAY_MS },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }
}

async function narrateAndMuxScene(
  videoUrl,
  voiceOver,
  productImageUrl,
  projectId,
  scene,
  useProductReference,
  showOverlay,
) {
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
    const muxedOutputPath = path.join(tempDir, `muxed-${outputFilename}`);
    await muxVideoWithAudio(videoPath, audioPath, muxedOutputPath);

    // The product image overlay is a nice-to-have on top of an already
    // successful narrated clip — if it fails (missing/unreachable image,
    // bad ffmpeg filter input, etc.), fall back to the narrated clip
    // without the overlay instead of losing the TTS work that already
    // succeeded, same graceful-degradation philosophy as the voice-over
    // fallback one level up in pollWanTask. Skipped when this scene
    // already used the real photo as Wan's i2v first frame (stamping the
    // same photo on top again would be redundant), or when the merchant
    // opted out of the overlay entirely (showOverlay === false).
    let finalPath = muxedOutputPath;

    if (productImageUrl && !useProductReference && showOverlay) {
      try {
        const productImagePath = path.join(
          tempDir,
          "product-image" + path.extname(productImageUrl),
        );
        const overlaidPath = path.join(tempDir, outputFilename);
        await downloadFile(productImageUrl, productImagePath);
        await overlayProductImage(muxedOutputPath, productImagePath, overlaidPath);
        finalPath = overlaidPath;
      } catch (error) {
        console.error(
          `Product image overlay failed for project ${projectId} scene ${scene}, keeping narrated clip without overlay:`,
          error,
        );
      }
    }

    return await saveGeneratedFile(finalPath, {
      category: "scene-videos",
      projectId,
      extension: ".mp4",
    });
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

async function overlayProductImage(videoPath, productImagePath, outputPath) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    productImagePath,
    "-filter_complex",
    "[1:v]scale=220:-1:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=0.92[product];[0:v][product]overlay=W-w-28:H-h-28:format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
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

async function stitchFinalVideo({ projectId, stitchGenerationId }) {
  const now = new Date().toISOString();

  // Conditional claim, same shape as claimGenerationForWanCall: if this
  // stitch has already been superseded by a newer re-stitch request (or
  // this is a duplicate delivery of a stitch that already ran), skip
  // entirely rather than clobbering RUNNING/terminal state that belongs to
  // the current stitch generation.
  const claimed = await pool.query(
    `UPDATE final_videos SET status = $1, updated_at = $2 WHERE project_id = $3 AND stitch_generation_id = $4`,
    ["RUNNING", now, projectId, stitchGenerationId],
  );

  if (claimed.rowCount === 0) {
    console.log(
      `[stale] project=${projectId} stitchGenerationId=${stitchGenerationId}: stitch superseded before starting, skipping.`,
    );
    return;
  }

  const { rows } = await pool.query(
    `SELECT scene, status, video_url FROM video_jobs WHERE project_id = $1 ORDER BY scene`,
    [projectId],
  );

  const missingOrFailed = rows.length < 5 || rows.some((row) => row.status !== "SUCCEEDED" || !row.video_url);

  if (missingOrFailed) {
    await updateFinalVideo(projectId, stitchGenerationId, {
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

    const finalVideoKey = await saveGeneratedFile(tempOutputPath, {
      category: "final-videos",
      projectId,
      extension: ".mp4",
    });

    await updateFinalVideo(projectId, stitchGenerationId, {
      status: "SUCCEEDED",
      videoUrl: finalVideoKey,
    });
  } catch (error) {
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Scoped to stitchGenerationId so a stale/duplicate stitch job can never
// overwrite a newer re-stitch's state (same shape as updateVideoJobFailure
// above, one level up).
async function updateFinalVideo(projectId, stitchGenerationId, { status, videoUrl, errorMessage }) {
  const result = await pool.query(
    `
    UPDATE final_videos
    SET status = $1,
        video_url = $2,
        error_message = $3,
        updated_at = $4
    WHERE project_id = $5 AND stitch_generation_id = $6
  `,
    [status, videoUrl ?? null, errorMessage ?? null, new Date().toISOString(), projectId, stitchGenerationId],
  );

  if (result.rowCount === 0) {
    console.log(
      `[stale] project=${projectId} stitchGenerationId=${stitchGenerationId}: stitch result discarded, superseded by a newer stitch.`,
    );
  }
}

async function downloadFile(url, destPath) {
  // Scene/final clips are stored via the media storage abstraction (local
  // disk or OSS, depending on MEDIA_STORAGE_DRIVER) and referenced by a
  // storage key or legacy "/uploads/..." path rather than a fetchable URL —
  // downloadToPath reads those straight from storage. Everything else
  // (Wan clip URLs, TTS audio URLs) is a real external URL, downloaded with
  // a timeout and a maximum size to bound worker memory/disk usage.
  await downloadToPath(url, destPath);
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

// wan2.1 (this app's default t2v/i2v models) predates Wan's newer
// resolution+ratio protocol, which only wan2.6/2.7 understand — wan2.1
// silently ignores an unrecognized `ratio` field and falls back to
// landscape 1280*720, regardless of WAN_VIDEO_RATIO. The legacy protocol
// wan2.1 actually speaks is a single `size: "width*height"` field.
const WAN_LEGACY_T2V_SIZES = {
  "720P": { "9:16": "720*1280", "16:9": "1280*720", "1:1": "720*720" },
  "1080P": { "9:16": "1080*1920", "16:9": "1920*1080", "1:1": "1080*1080" },
};

function getWanLegacyT2vSize(aspectRatio) {
  const resolution = process.env.WAN_VIDEO_RESOLUTION || "720P";
  const ratio = aspectRatio || process.env.WAN_VIDEO_RATIO || "9:16";

  return WAN_LEGACY_T2V_SIZES[resolution]?.[ratio] || "720*1280";
}

async function createWanTextToVideoTask(prompt, imgDataUrl, aspectRatio) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;
  const model = imgDataUrl
    ? process.env.WAN_VIDEO_I2V_MODEL || "wan2.1-i2v-turbo"
    : process.env.WAN_VIDEO_MODEL || "wan2.1-t2v-turbo";

  if (!apiKey || !baseUrl) {
    throw new Error("Wan video environment variables are not configured.");
  }

  const parameters = {
    duration: Number(process.env.WAN_VIDEO_DURATION || "5"),
    prompt_extend: true,
    watermark: true,
  };

  // i2v still speaks the resolution-based protocol (confirmed working);
  // t2v needs the legacy `size` field — see WAN_LEGACY_T2V_SIZES above.
  if (imgDataUrl) {
    parameters.resolution = process.env.WAN_VIDEO_RESOLUTION || "720P";
  } else {
    parameters.size = getWanLegacyT2vSize(aspectRatio);
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
        input: imgDataUrl ? { prompt, img_url: imgDataUrl } : { prompt },
        parameters,
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

function getWorkerFailureMessage(error) {
  const message = getErrorMessage(error);

  if (message.includes("Wan video environment variables")) {
    return "Wan video is not configured. Set DASHSCOPE_API_KEY and DASHSCOPE_VIDEO_BASE_URL, then retry this scene.";
  }

  if (message.includes("TTS environment variables")) {
    return "Voice-over failed because TTS is not configured. Set DASHSCOPE_API_KEY and DASHSCOPE_TTS_BASE_URL or DASHSCOPE_VIDEO_BASE_URL.";
  }

  if (message.includes("ffmpeg") || error?.code === "ENOENT") {
    return "Video processing failed because ffmpeg is not available on the worker server. Install ffmpeg and retry.";
  }

  if (message.includes("Failed to download clip")) {
    return "Video processing failed while downloading a generated clip. Check that provider URLs or local uploads are reachable from the worker.";
  }

  if (message.includes("non-JSON response") || message.includes("empty response")) {
    return `Provider returned an invalid response. ${message}`;
  }

  return message;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown worker error.";
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
