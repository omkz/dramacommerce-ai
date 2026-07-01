type QwenMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type QwenChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class QwenConfigurationError extends Error {
  constructor() {
    super("Qwen environment variables are not configured.");
    this.name = "QwenConfigurationError";
  }
}

export class QwenApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Qwen API error: ${status} ${message}`);
    this.name = "QwenApiError";
  }
}

export class QwenResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QwenResponseError";
  }
}

export async function callQwenJson({
  system,
  user,
}: {
  system: string;
  user: string;
}): Promise<unknown> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.QWEN_BASE_URL;
  const model = process.env.QWEN_MODEL || "qwen-plus";

  if (!apiKey || !baseUrl) {
    throw new QwenConfigurationError();
  }

  const messages: QwenMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new QwenApiError(response.status, errorText);
  }

  const data = (await response.json()) as QwenChatResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new QwenResponseError("Qwen returned an empty response.");
  }

  try {
    return JSON.parse(cleanJsonResponse(content));
  } catch (error) {
    throw new QwenResponseError("Qwen returned invalid JSON.");
  }
}

function cleanJsonResponse(content: string): string {
  return content
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}
