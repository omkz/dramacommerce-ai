import { Queue } from "bullmq";

export type VideoCreateJobData = {
  projectId: string;
  scene: number;
  prompt: string;
};

export type VideoPollJobData = {
  projectId: string;
  scene: number;
  taskId: string;
};

export const VIDEO_QUEUE_NAME = "video-generation";

let queue: Queue<VideoCreateJobData | VideoPollJobData> | null = null;

export function getVideoQueue(): Queue<VideoCreateJobData | VideoPollJobData> {
  queue ??= new Queue<VideoCreateJobData | VideoPollJobData>(VIDEO_QUEUE_NAME, {
    connection: getRedisConnection(),
  });

  return queue;
}

export async function enqueueVideoCreateJob(
  data: VideoCreateJobData,
): Promise<string> {
  const job = await getVideoQueue().add("video.create", data, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? "";
}

export async function enqueueVideoPollJob(
  data: VideoPollJobData,
  delay = 30_000,
): Promise<string> {
  const job = await getVideoQueue().add("video.poll", data, {
    delay,
    attempts: 10,
    backoff: {
      type: "fixed",
      delay: 30_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? "";
}

export function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required.");
  }

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
