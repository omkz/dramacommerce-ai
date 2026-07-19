import { Queue } from "bullmq";
import { getRedisConnection } from "~/services/video-queue.server";

export type ShowrunnerGenerateJobData = {
  showrunnerJobId: string;
  userId: string;
};

export const SHOWRUNNER_QUEUE_NAME = "showrunner-generation";

let queue: Queue<ShowrunnerGenerateJobData> | null = null;

export function getShowrunnerQueue(): Queue<ShowrunnerGenerateJobData> {
  queue ??= new Queue<ShowrunnerGenerateJobData>(SHOWRUNNER_QUEUE_NAME, {
    connection: getRedisConnection(),
  });

  return queue;
}

// Called only by scripts/outbox-dispatcher.mts, never directly from HTTP
// routes — see app/services/project-store.server.ts#createShowrunnerJobWithOutbox.
// jobId is the outbox event's deterministic job_key: BullMQ treats add()
// with an existing jobId as a no-op against the job already created, so a
// dispatcher retrying a delivery it's not sure succeeded is always safe.
export async function enqueueShowrunnerGenerateJob(
  data: ShowrunnerGenerateJobData,
  jobId: string,
): Promise<string> {
  const job = await getShowrunnerQueue().add("showrunner.generate", data, {
    jobId,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? jobId;
}
