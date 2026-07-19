import { Queue } from "bullmq";

export type VideoCreateJobData = {
  projectId: string;
  scene: number;
  prompt: string;
  voiceOver: string;
  productImageUrl?: string;
  useProductReference?: boolean;
  showOverlay: boolean;
  aspectRatio?: "9:16" | "1:1" | "16:9";
  // Minted when this generation was started (project-store.server.ts). The
  // worker refuses to call Wan, or to write any status update, once the
  // video_jobs row's generation_id no longer matches this value — see
  // scripts/video-worker.mjs.
  generationId: string;
};

export type VideoPollJobData = {
  projectId: string;
  scene: number;
  taskId: string;
  voiceOver: string;
  productImageUrl?: string;
  generationId: string;
};

export type VideoStitchJobData = {
  projectId: string;
  stitchGenerationId: string;
};

export const VIDEO_QUEUE_NAME = "video-generation";

type VideoJobData = VideoCreateJobData | VideoPollJobData | VideoStitchJobData;

let queue: Queue<VideoJobData> | null = null;

export function getVideoQueue(): Queue<VideoJobData> {
  queue ??= new Queue<VideoJobData>(VIDEO_QUEUE_NAME, {
    connection: getRedisConnection(),
  });

  return queue;
}

// enqueueVideoCreateJob/enqueueVideoStitchJob are called only by
// scripts/outbox-dispatcher.mts now, never directly from HTTP routes — see
// app/services/project-store.server.ts's *WithOutbox functions. jobId is
// the outbox event's deterministic job_key, doubling as BullMQ's jobId so a
// dispatcher retry after an uncertain prior attempt is always safe (add()
// no-ops against a job that already exists under that id).
export async function enqueueVideoCreateJob(
  data: VideoCreateJobData,
  jobId: string,
): Promise<string> {
  const job = await getVideoQueue().add("video.create", data, {
    jobId,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? jobId;
}

export async function enqueueVideoStitchJob(
  data: VideoStitchJobData,
  jobId: string,
): Promise<string> {
  const job = await getVideoQueue().add("video.stitch", data, {
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
