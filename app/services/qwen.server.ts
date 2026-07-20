import { ZodError } from "zod";
import { ExternalRequestError, requestJson } from "~/services/http/http-client.server";
import {
  getQwenRequestTimeoutMs,
  getQwenVisionRequestTimeoutMs,
} from "~/services/http/timeout-config.server";
import { DomainValidationError } from "~/services/domain/errors.server";

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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type QwenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function addUsage(a: QwenUsage, b: QwenChatResponse["usage"]): QwenUsage {
  return {
    promptTokens: a.promptTokens + (b?.prompt_tokens ?? 0),
    completionTokens: a.completionTokens + (b?.completion_tokens ?? 0),
    totalTokens: a.totalTokens + (b?.total_tokens ?? 0),
  };
}

const MAX_TOOL_CALL_ROUNDS = 4;

export class QwenConfigurationError extends Error {
  constructor() {
    super("Qwen environment variables are not configured.");
    this.name = "QwenConfigurationError";
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
  onUsage,
}: {
  system: string;
  user: string;
  tools?: QwenTool[];
  toolHandlers?: QwenToolHandlers;
  requiredToolNames?: string[];
  onUsage?: (usage: QwenUsage) => void;
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
  let usage: QwenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const requiredToolName = requiredToolNames.find(
      (toolName) => !calledToolNames.has(toolName),
    );

    const { data } = await requestJson<QwenChatResponse>({
      url: `${baseUrl}/chat/completions`,
      timeoutMs: getQwenRequestTimeoutMs(),
      provider: "qwen",
      operation: "chat.completions",
      init: {
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
      },
    });

    const message = data.choices?.[0]?.message;
    usage = addUsage(usage, data.usage);

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
      const parsed = JSON.parse(cleanJsonResponse(message.content));
      onUsage?.(usage);
      return parsed;
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
  onUsage,
}: {
  system: string;
  user: string;
  imageDataUrl: string;
  onUsage?: (usage: QwenUsage) => void;
}): Promise<unknown> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.QWEN_BASE_URL;
  const model = process.env.QWEN_VISION_MODEL || "qwen3-vl-flash";

  if (!apiKey || !baseUrl) {
    throw new QwenConfigurationError();
  }

  const { data } = await requestJson<QwenChatResponse>({
    url: `${baseUrl}/chat/completions`,
    timeoutMs: getQwenVisionRequestTimeoutMs(),
    provider: "qwen",
    operation: "vision.chat.completions",
    init: {
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
    },
  });

  const message = data.choices?.[0]?.message;

  if (!message?.content) {
    throw new QwenResponseError("Qwen returned an empty response.");
  }

  try {
    const parsed = JSON.parse(cleanJsonResponse(message.content));
    onUsage?.(addUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }, data.usage));
    return parsed;
  } catch (error) {
    throw new QwenResponseError("Qwen returned invalid JSON.");
  }
}

export function getQwenErrorMessage(error: unknown): string {
  if (error instanceof QwenConfigurationError) {
    return "Qwen is not configured. Set DASHSCOPE_API_KEY and QWEN_BASE_URL before generating.";
  }

  if (error instanceof ExternalRequestError) {
    if (error.category === "auth_config") {
      return "Qwen request failed authentication. Check DASHSCOPE_API_KEY and QWEN_BASE_URL.";
    }

    if (error.category === "timeout") {
      return `Qwen request timed out after ${error.timeoutMs}ms. The provider may be slow or unreachable — try again.`;
    }

    if (error.category === "rate_limit") {
      return "Qwen rate limit reached. Try again shortly.";
    }

    return `Qwen request failed (${error.category}${error.status ? `, status ${error.status}` : ""}). Check the API key, base URL, model, or provider status.`;
  }

  if (error instanceof QwenResponseError) {
    return "Qwen returned an invalid response. Try again, or adjust the prompt/schema if this keeps happening.";
  }

  if (error instanceof DomainValidationError) {
    if (error.category === "invalid_ai_output") {
      return "Qwen's generated show plan failed a consistency check across agents (e.g. reference-image usage vs. the brief). Try again.";
    }

    if (error.category === "invalid_persisted_data") {
      return "This job's saved product brief no longer matches the expected format and can't be generated. Start a new brief.";
    }

    if (error.category === "invalid_worker_payload") {
      return "This job's queue payload was invalid and can't be retried. Start a new brief.";
    }

    return "Qwen returned data that failed validation. Try again.";
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
