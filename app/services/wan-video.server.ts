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

export type VideoGenerationStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "UNKNOWN";

export async function createWanTextToVideoTask(prompt: string): Promise<{
  taskId: string;
  status: VideoGenerationStatus;
}> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_VIDEO_BASE_URL;
  const model = process.env.WAN_VIDEO_MODEL || "wan2.1-t2v-turbo";

  if (!apiKey || !baseUrl) {
    throw new Error("Wan video environment variables are not configured.");
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
  );

  const data = (await readJsonResponse(response)) as WanCreateTaskResponse;


  if (!response.ok) {
    throw new Error(
      data.message || data.code || `Wan API error: ${response.status}`,
    );
  }

  const taskId = data.output?.task_id;
  const status = normalizeStatus(data.output?.task_status);

  if (!taskId) {
    throw new Error("Wan did not return a task_id.");
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
    throw new Error("Wan video environment variables are not configured.");
  }

  const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = (await readJsonResponse(response)) as WanQueryTaskResponse;

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

function normalizeStatus(status: string | undefined): VideoGenerationStatus {
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

async function readJsonResponse(response: Response): Promise<unknown> {
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
