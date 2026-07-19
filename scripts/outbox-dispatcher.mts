import { cleanupOutboxEvents } from "~/services/outbox.server";
import {
  dispatchPendingEvents,
  type DispatchHandlerRegistry,
} from "~/services/outbox-dispatch.server";
import {
  SHOWRUNNER_QUEUE_NAME,
  enqueueShowrunnerGenerateJob,
  type ShowrunnerGenerateJobData,
} from "~/services/showrunner-queue.server";
import {
  VIDEO_QUEUE_NAME,
  enqueueVideoCreateJob,
  enqueueVideoStitchJob,
  type VideoCreateJobData,
  type VideoStitchJobData,
} from "~/services/video-queue.server";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS || "2000");
const BATCH_SIZE = Number(process.env.OUTBOX_DISPATCH_BATCH_SIZE || "25");
const CLEANUP_INTERVAL_MS = Number(
  process.env.OUTBOX_CLEANUP_INTERVAL_MS || 60 * 60 * 1000,
);

// The only place in the app that calls queue.add() — every other write path
// goes through the outbox instead. Keyed by (queue, jobName) exactly as
// written by project-store.server.ts's *WithOutbox functions.
const DISPATCH_HANDLERS: DispatchHandlerRegistry = {
  [SHOWRUNNER_QUEUE_NAME]: {
    "showrunner.generate": (payload, jobId) =>
      enqueueShowrunnerGenerateJob(payload as ShowrunnerGenerateJobData, jobId),
  },
  [VIDEO_QUEUE_NAME]: {
    "video.create": (payload, jobId) =>
      enqueueVideoCreateJob(payload as VideoCreateJobData, jobId),
    "video.stitch": (payload, jobId) =>
      enqueueVideoStitchJob(payload as VideoStitchJobData, jobId),
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
