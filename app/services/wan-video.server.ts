import {
  parseVideoGenerationStatus,
  type VideoGenerationStatus,
} from "~/types/video-status";
import { ExternalRequestError, requestJson } from "~/services/http/http-client.server";
import { getWanCreateTimeoutMs, getWanPollTimeoutMs } from "~/services/http/timeout-config.server";

type WanCreateTaskResponse = {
  output?: {
    task_id?: string;
    task_status?: string;
  };
  request_id?: string;
  code?: string;
  message?: string;
};

type WanQueryTaskResponse = {
  output?: {
    task_id?: string;
    task_status?: VideoGenerationStatus;
    video_url?: string;
    code?: string;
    message?: string;
  };
  request_id?: string;
  code?: string;
  message?: string;
};

export class WanConfigurationError extends Error {
  constructor() {
    super("Wan video environment variables are not configured.");
    this.name = "WanConfigurationError";
  }
}

export async function createWanTextToVideoTask(prompt: string): Promise<{
  taskId: string;
  status: VideoGenerationStatus;
}> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;
  const model = process.env.WAN_VIDEO_MODEL || "wan2.1-t2v-turbo";

  if (!apiKey || !baseUrl) {
    throw new WanConfigurationError();
  }

  const { data } = await requestJson<WanCreateTaskResponse>({
    url: `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`,
    timeoutMs: getWanCreateTimeoutMs(),
    provider: "wan",
    operation: "video.create",
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: {
          prompt,
        },
        parameters: {
          resolution: process.env.WAN_VIDEO_RESOLUTION || "720P",
          ratio: process.env.WAN_VIDEO_RATIO || "9:16",
          duration: Number(process.env.WAN_VIDEO_DURATION || "5"),
          prompt_extend: true,
          watermark: true,
        },
      }),
    },
  });

  const taskId = data.output?.task_id;
  const status = parseVideoGenerationStatus(data.output?.task_status);

  if (!taskId) {
    throw new ExternalRequestError("invalid_response", "Wan did not return a task_id.", {
      provider: "wan",
      operation: "video.create",
    });
  }

  return {
    taskId,
    status,
  };
}

export async function queryWanVideoTask(taskId: string): Promise<{
  taskId: string;
  status: VideoGenerationStatus;
  videoUrl?: string;
  errorMessage?: string;
}> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;

  if (!apiKey || !baseUrl) {
    throw new WanConfigurationError();
  }

  const { data } = await requestJson<WanQueryTaskResponse>({
    url: `${baseUrl}/api/v1/tasks/${taskId}`,
    timeoutMs: getWanPollTimeoutMs(),
    provider: "wan",
    operation: "video.poll",
    init: {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });

  const output = data.output;

  if (!output?.task_id) {
    throw new ExternalRequestError("invalid_response", "Wan returned an invalid task result.", {
      provider: "wan",
      operation: "video.poll",
    });
  }

  return {
    taskId: output.task_id,
    status: parseVideoGenerationStatus(output.task_status),
    videoUrl: output.video_url,
    errorMessage: output.message,
  };
}
