import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "~/services/video-queue.server";
import {
  SHOWRUNNER_QUEUE_NAME,
  type ShowrunnerGenerateJobData,
} from "~/services/showrunner-queue.server";
import { generateShowPlan } from "~/services/showrunner.server";
import { getQwenErrorMessage } from "~/services/qwen.server";
import {
  getShowrunnerJob,
  saveProject,
  updateShowrunnerJob,
} from "~/services/project-store.server";
import { deleteUploadedFile } from "~/services/image-upload.server";

const CONCURRENCY = Number(process.env.SHOWRUNNER_WORKER_CONCURRENCY || "2");
const connection = getRedisConnection();

const worker = new Worker<ShowrunnerGenerateJobData>(
  SHOWRUNNER_QUEUE_NAME,
  async (job) => {
    if (job.name !== "showrunner.generate") {
      throw new Error(`Unknown showrunner job: ${job.name}`);
    }

    try {
      await runShowrunnerJob(job.data.showrunnerJobId, job.data.userId);
    } catch (error) {
      if (!willRetry(job)) {
        await markShowrunnerJobFailed(
          job.data.showrunnerJobId,
          job.data.userId,
          error,
        );
      }

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
  `Showrunner worker started. Queue: ${SHOWRUNNER_QUEUE_NAME}. Concurrency: ${CONCURRENCY}.`,
);

function willRetry(job: Job): boolean {
  const maxAttempts = job.opts.attempts ?? 1;

  return job.attemptsMade + 1 < maxAttempts;
}

async function runShowrunnerJob(
  showrunnerJobId: string,
  userId: string,
): Promise<void> {
  const job = await getShowrunnerJob(showrunnerJobId, userId);

  if (!job) {
    throw new Error(`Showrunner job ${showrunnerJobId} not found.`);
  }

  const showPlan = await generateShowPlan(job.brief, async (stage) => {
    await updateShowrunnerJob(showrunnerJobId, { status: stage });
  });

  const project = await saveProject(showPlan, userId);

  await updateShowrunnerJob(showrunnerJobId, {
    status: "SUCCEEDED",
    projectId: project.id,
  });
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
