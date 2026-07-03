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

export async function enqueueShowrunnerGenerateJob(
  data: ShowrunnerGenerateJobData,
): Promise<string> {
  const job = await getShowrunnerQueue().add("showrunner.generate", data, {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? "";
}
