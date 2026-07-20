import { cleanupOutboxEvents } from "~/services/outbox.server";
import {
  dispatchPendingEvents,
  type DispatchHandlerRegistry,
} from "~/services/outbox-dispatch.server";
import {
  SHOWRUNNER_QUEUE_NAME,
  enqueueShowrunnerGenerateJob,
} from "~/services/showrunner-queue.server";
import {
  VIDEO_QUEUE_NAME,
  enqueueVideoCreateJob,
  enqueueVideoStitchJob,
} from "~/services/video-queue.server";
import {
  showrunnerGenerateJobDataSchema,
  videoCreateJobDataSchema,
  videoStitchJobDataSchema,
} from "~/services/domain/queue-payload-schemas.server";
import { buildDomainValidationError } from "~/services/domain/errors.server";
import type { z } from "zod";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS || "2000");
const BATCH_SIZE = Number(process.env.OUTBOX_DISPATCH_BATCH_SIZE || "25");
const CLEANUP_INTERVAL_MS = Number(
  process.env.OUTBOX_CLEANUP_INTERVAL_MS || 60 * 60 * 1000,
);

// outbox_events.payload is jsonb — Postgres guarantees valid JSON, never a
// guaranteed-correct shape (a schema drift between when the event was
// written and when it's dispatched, or direct DB tampering, are both
// possible in principle). Validating here means a malformed payload never
// reaches BullMQ at all; it's treated as any other dispatch failure
// (retried per the existing outbox backoff, eventually marked FAILED) — see
// CLAUDE.md for why the outbox dispatcher doesn't have its own permanent-
// vs-retryable distinction the way the BullMQ workers do.
function validated<T>(schema: z.ZodType<T>, payload: unknown, contextLabel: string): T {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw buildDomainValidationError("invalid_worker_payload", contextLabel, result.error);
  }

  return result.data;
}

// The only place in the app that calls queue.add() — every other write path
// goes through the outbox instead. Keyed by (queue, jobName) exactly as
// written by project-store.server.ts's *WithOutbox functions.
const DISPATCH_HANDLERS: DispatchHandlerRegistry = {
  [SHOWRUNNER_QUEUE_NAME]: {
    "showrunner.generate": (payload, jobId) =>
      enqueueShowrunnerGenerateJob(
        validated(showrunnerGenerateJobDataSchema, payload, "Invalid showrunner.generate outbox payload"),
        jobId,
      ),
  },
  [VIDEO_QUEUE_NAME]: {
    "video.create": (payload, jobId) =>
      enqueueVideoCreateJob(
        validated(videoCreateJobDataSchema, payload, "Invalid video.create outbox payload"),
        jobId,
      ),
    "video.stitch": (payload, jobId) =>
      enqueueVideoStitchJob(
        validated(videoStitchJobDataSchema, payload, "Invalid video.stitch outbox payload"),
        jobId,
      ),
  },
};

let stopping = false;
let currentTick: Promise<void> | null = null;

async function dispatchOnce(): Promise<void> {
  // dispatchPendingEvents logs each event's outcome itself (see
  // outbox-dispatch.server.ts) — this is just the poll-loop driver.
  await dispatchPendingEvents(DISPATCH_HANDLERS, BATCH_SIZE);
}

async function runCleanupTick(): Promise<void> {
  try {
    const result = await cleanupOutboxEvents();

    if (result.deliveredDeleted > 0 || result.failedDeleted > 0) {
      console.log(
        `[outbox] cleanup: removed ${result.deliveredDeleted} delivered, ${result.failedDeleted} failed events`,
      );
    }
  } catch (error) {
    console.error("[outbox] cleanup tick failed:", error);
  }
}

function scheduleNextTick(): void {
  if (stopping) {
    return;
  }

  setTimeout(() => {
    currentTick = dispatchOnce()
      .catch((error) => console.error("[outbox] dispatch tick failed:", error))
      .finally(scheduleNextTick);
  }, POLL_INTERVAL_MS);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[outbox] received ${signal}, finishing current tick and exiting...`);
  stopping = true;
  await currentTick;
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `Outbox dispatcher started. Poll interval: ${POLL_INTERVAL_MS}ms. Batch size: ${BATCH_SIZE}.`,
);

currentTick = dispatchOnce()
  .catch((error) => console.error("[outbox] dispatch tick failed:", error))
  .finally(scheduleNextTick);

setInterval(runCleanupTick, CLEANUP_INTERVAL_MS);
