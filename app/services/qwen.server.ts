import { ZodError } from "zod";

type QwenMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: QwenToolCall[];
  tool_call_id?: string;
};

export type QwenTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type QwenToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type QwenToolHandlers = Record<
  string,
  (args: Record<string, unknown>) => unknown
>;

type QwenChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: QwenToolCall[];
    };
  }>;
};

const MAX_TOOL_CALL_ROUNDS = 4;

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
  tools,
  toolHandlers,
  requiredToolNames = [],
}: {
  system: string;
  user: string;
  tools?: QwenTool[];
  toolHandlers?: QwenToolHandlers;
  requiredToolNames?: string[];
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
  const calledToolNames = new Set<string>();

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const requiredToolName = requiredToolNames.find(
      (toolName) => !calledToolNames.has(toolName),
    );

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
        // Qwen's OpenAI-compatible endpoint hangs indefinitely (confirmed
        // live — the request never returns) when response_format:json_object
        // is combined with tools. Only force JSON mode on tool-free calls;
        // agents using tools rely on the "Return only valid JSON" system
        // prompt instruction instead, same as before response_format existed.
        ...(tools
          ? {
              tools,
              ...(requiredToolName
                ? {
                    tool_choice: {
                      type: "function",
                      function: { name: requiredToolName },
                    },
                  }
                : {}),
            }
          : { response_format: { type: "json_object" } }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new QwenApiError(response.status, errorText);
    }

    const data = (await response.json()) as QwenChatResponse;
    const message = data.choices?.[0]?.message;

    if (process.env.QWEN_DEBUG) {
      console.log(`[qwen debug] round ${round}:`, JSON.stringify(message, null, 2));
    }

    if (!message) {
      throw new QwenResponseError("Qwen returned an empty response.");
    }

    if (message.tool_calls?.length && toolHandlers) {
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        const handler = toolHandlers[toolCall.function.name];
        const args = parseToolArguments(toolCall.function.arguments);
        const result = handler
          ? await handler(args)
          : { error: `Unknown tool: ${toolCall.function.name}` };

        calledToolNames.add(toolCall.function.name);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      continue;
    }

    if (!message.content) {
      throw new QwenResponseError("Qwen returned an empty response.");
    }

    const missingRequiredTool = requiredToolNames.find(
      (toolName) => !calledToolNames.has(toolName),
    );

    if (missingRequiredTool) {
      throw new QwenResponseError(
        `Qwen returned JSON before calling required tool: ${missingRequiredTool}.`,
      );
    }

    try {
      return JSON.parse(cleanJsonResponse(message.content));
    } catch (error) {
      throw new QwenResponseError("Qwen returned invalid JSON.");
    }
  }

  throw new QwenResponseError(
    `Qwen tool-calling loop did not resolve after ${MAX_TOOL_CALL_ROUNDS} rounds.`,
  );
}

export async function callQwenVisionJson({
  system,
  user,
  imageDataUrl,
}: {
  system: string;
  user: string;
  imageDataUrl: string;
}): Promise<unknown> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.QWEN_BASE_URL;
  const model = process.env.QWEN_VISION_MODEL || "qwen3-vl-flash";

  if (!apiKey || !baseUrl) {
    throw new QwenConfigurationError();
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new QwenApiError(response.status, errorText);
  }

  const data = (await response.json()) as QwenChatResponse;
  const message = data.choices?.[0]?.message;

  if (!message?.content) {
    throw new QwenResponseError("Qwen returned an empty response.");
  }

  try {
    return JSON.parse(cleanJsonResponse(message.content));
  } catch (error) {
    throw new QwenResponseError("Qwen returned invalid JSON.");
  }
}

export function getQwenErrorMessage(error: unknown): string {
  if (error instanceof QwenConfigurationError) {
    return "Qwen is not configured. Set DASHSCOPE_API_KEY and QWEN_BASE_URL before generating.";
  }

  if (error instanceof QwenApiError) {
    return `Qwen request failed with status ${error.status}. Check the API key, base URL, model, or provider status.`;
  }

  if (error instanceof QwenResponseError) {
    return "Qwen returned an invalid response. Try again, or adjust the prompt/schema if this keeps happening.";
  }

  if (error instanceof ZodError) {
    return "Qwen returned a show plan that does not match the required schema.";
  }

  return "Unable to generate a show plan with Qwen. Try again later.";
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    return JSON.parse(rawArguments || "{}");
  } catch {
    return {};
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
