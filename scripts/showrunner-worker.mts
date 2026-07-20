import { UnrecoverableError, Worker, type Job } from "bullmq";
import { getRedisConnection } from "~/services/video-queue.server";
import {
  SHOWRUNNER_QUEUE_NAME,
  type ShowrunnerGenerateJobData,
} from "~/services/showrunner-queue.server";
import { generateShowPlan } from "~/services/showrunner.server";
import { getQwenErrorMessage, QwenConfigurationError } from "~/services/qwen.server";
import {
  getShowrunnerJob,
  saveProjectAndCompleteShowrunnerJob,
  updateShowrunnerJob,
} from "~/services/project-store.server";
import { deleteUploadedFile } from "~/services/image-upload.server";
import { ExternalRequestError, toLogFields as toHttpLogFields } from "~/services/http/http-client.server";
import { showrunnerGenerateJobDataSchema } from "~/services/domain/queue-payload-schemas.server";
import { DomainValidationError, buildDomainValidationError, toLogFields as toDomainLogFields } from "~/services/domain/errors.server";

const CONCURRENCY = Number(process.env.SHOWRUNNER_WORKER_CONCURRENCY || "2");
const connection = getRedisConnection();

const worker = new Worker<ShowrunnerGenerateJobData>(
  SHOWRUNNER_QUEUE_NAME,
  async (job) => {
    if (job.name !== "showrunner.generate") {
      throw new Error(`Unknown showrunner job: ${job.name}`);
    }

    // BullMQ redelivery is at-least-once and this worker never wrote
    // job.data itself (the outbox dispatcher did) — a malformed payload
    // here would otherwise crash on job.data.showrunnerJobId being the
    // wrong type deep inside generateShowPlan instead of failing cleanly.
    const payloadResult = showrunnerGenerateJobDataSchema.safeParse(job.data);

    if (!payloadResult.success) {
      const payloadError = buildDomainValidationError(
        "invalid_worker_payload",
        "Invalid showrunner.generate job payload",
        payloadResult.error,
      );
      console.error(`[showrunner-worker] job ${job.id} has an invalid payload:`, toDomainLogFields(payloadError));
      throw new UnrecoverableError(payloadError.message);
    }

    const { showrunnerJobId, userId } = payloadResult.data;

    try {
      await runShowrunnerJob(showrunnerJobId, userId);
    } catch (error) {
      const permanent = isPermanentError(error);

      if (permanent || !willRetry(job)) {
        await markShowrunnerJobFailed(showrunnerJobId, userId, error);
      }

      console.error(
        `[showrunner-worker] job ${job.id} failed${permanent ? " (permanent)" : ""}:`,
        error instanceof DomainValidationError ? toDomainLogFields(error) : toHttpLogFields(error),
      );

      // BullMQ special-cases UnrecoverableError: it skips remaining
      // configured retry attempts instead of burning a paid Qwen call on an
      // error that can't succeed (bad API key, missing config, invalid URL
      // protocol, corrupted persisted brief).
      throw permanent ? new UnrecoverableError(getQwenErrorMessage(error)) : error;
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
  `Showrunner worker started. Queue: ${SHOWRUNNER_QUEUE_NAME}. Concurrency: ${CONCURRENCY}.`,
);

function willRetry(job: Job): boolean {
  const maxAttempts = job.opts.attempts ?? 1;

  return job.attemptsMade + 1 < maxAttempts;
}

// Only network-layer failures (ExternalRequestError) and missing
// configuration are classified as permanent here — a malformed/empty JSON
// body from Qwen's own generative output (QwenResponseError) or a schema
// mismatch (ZodError) could plausibly succeed on a second sampling, so those
// are left to the existing attempts-based retry rather than short-circuited.
function isPermanentError(error: unknown): boolean {
  if (error instanceof ExternalRequestError) {
    return !error.retryable;
  }

  // A malformed job payload or corrupted persisted brief will never become
  // valid on retry; an invalid AI-output failure (a cross-agent consistency
  // check on the assembled show plan) is left retryable since a full
  // pipeline re-run is genuinely generative and could turn out differently.
  if (error instanceof DomainValidationError) {
    return error.category === "invalid_worker_payload" || error.category === "invalid_persisted_data";
  }

  return error instanceof QwenConfigurationError;
}

async function runShowrunnerJob(
  showrunnerJobId: string,
  userId: string,
): Promise<void> {
  const job = await getShowrunnerJob(showrunnerJobId, userId);

  if (!job) {
    throw new Error(`Showrunner job ${showrunnerJobId} not found.`);
  }

  // A deterministic BullMQ jobId (see showrunner-queue.server.ts) already
  // makes a duplicate *publish* of this job a no-op, but BullMQ can still
  // redeliver the same job at-least-once after a stalled/crashed worker —
  // if the first attempt already finished, exit immediately rather than
  // re-running the whole Qwen pipeline and (absent this check) creating a
  // second project for the same job.
  if (job.status === "SUCCEEDED") {
    console.log(
      `Showrunner job ${showrunnerJobId} already SUCCEEDED (projectId ${job.projectId}) — skipping duplicate delivery.`,
    );
    return;
  }

  if (job.briefSchemaStatus === "invalid") {
    throw new DomainValidationError(
      "invalid_persisted_data",
      "Showrunner job's saved brief no longer matches the expected schema.",
    );
  }

  const showPlan = await generateShowPlan(job.brief, async (stage) => {
    await updateShowrunnerJob(showrunnerJobId, { status: stage });
  });

  // Project creation and the SUCCEEDED status update commit atomically —
  // see project-store.server.ts#saveProjectAndCompleteShowrunnerJob.
  await saveProjectAndCompleteShowrunnerJob(showrunnerJobId, showPlan, userId);
}

async function markShowrunnerJobFailed(
  showrunnerJobId: string,
  userId: string,
  error: unknown,
): Promise<void> {
  const message = getQwenErrorMessage(error);
  const job = await getShowrunnerJob(showrunnerJobId, userId);

  await updateShowrunnerJob(showrunnerJobId, {
    status: "FAILED",
    errorMessage: message,
  });

  if (job?.brief.imageUrl) {
    await deleteUploadedFile(job.brief.imageUrl);
  }
}
