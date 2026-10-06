import type { OpenAiToolDefinition } from "../../mcp/bridge/mcp-tool-adapter.js";

/**
 * A thin, well-typed client over the OpenRouter OpenAI-compatible chat
 * completions endpoint, scoped to what the tool-calling agent loop needs.
 *
 * This is intentionally separate from the existing OpenRouterProvider (which
 * handles simple, tool-free chat). It uses the raw REST API so we have precise
 * control over the `tools` request field and the `tool_calls` response field.
 *
 * Backend-only: never import from the renderer or preload. The API key stays in
 * this process and is never logged.
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/free";

/** A chat message in the OpenAI-compatible format, including tool roles. */
export interface ToolChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present on assistant messages that request tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool-result messages; references the originating call. */
  tool_call_id?: string;
}

/** A tool call requested by the model. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

/** Normalized token usage. */
export interface ToolChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** A single turn's response from the model. */
export interface ToolChatResponse {
  /** Assistant text content (may be empty when only tool calls are present). */
  content: string;
  /** Tool calls the model wants executed, if any. */
  toolCalls: ToolCall[];
  /** The model that produced the response. */
  model: string;
  /** Why the model stopped (e.g. "tool_calls", "stop"). */
  finishReason: string | undefined;
  usage?: ToolChatUsage;
}

export interface OpenRouterToolClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class OpenRouterToolClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OpenRouterToolClientOptions = {}) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured.");
    }
    this.apiKey = apiKey;
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
  ): OpenRouterToolClient {
    return new OpenRouterToolClient({
      apiKey: environment.OPENROUTER_API_KEY,
      model: environment.OPENROUTER_MODEL,
      baseUrl: environment.OPENROUTER_BASE_URL,
    });
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Sends one chat completion turn. Supplies the available tools so the model
   * may request tool calls. Returns a normalized response.
   */
  async send(
    messages: ToolChatMessage[],
    tools: OpenAiToolDefinition[],
    options: { temperature?: number; signal?: AbortSignal } = {},
  ): Promise<ToolChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      // Do not leak request details (which include the Authorization header).
      throw new Error("OpenRouter network request failed.");
    }

    if (!response.ok) {
      throw this.toHttpError(response.status);
    }

    let payload: OpenRouterChatCompletion;
    try {
      payload = (await response.json()) as OpenRouterChatCompletion;
    } catch {
      throw new Error("OpenRouter returned a malformed response.");
    }

    return this.normalize(payload);
  }

  private normalize(payload: OpenRouterChatCompletion): ToolChatResponse {
    const choice = payload.choices?.[0];
    if (!choice) {
      throw new Error("OpenRouter returned an empty response.");
    }

    const message = choice.message ?? { role: "assistant", content: "" };
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.filter(isValidToolCall)
      : [];
    const content = typeof message.content === "string" ? message.content : "";

    // A valid turn has either text content or at least one tool call.
    if (!content.trim() && toolCalls.length === 0) {
      throw new Error("OpenRouter returned an empty response.");
    }

    return {
      content,
      toolCalls,
      model: payload.model ?? this.model,
      finishReason: choice.finish_reason ?? undefined,
      usage: payload.usage
        ? {
            promptTokens: payload.usage.prompt_tokens,
            completionTokens: payload.usage.completion_tokens,
            totalTokens: payload.usage.total_tokens,
          }
        : undefined,
    };
  }

  private toHttpError(status: number): Error {
    if (status === 401) {
      return new Error("OpenRouter request failed with HTTP 401.");
    }
    if (status === 429) {
      return new Error("OpenRouter request was rate limited (HTTP 429).");
    }
    return new Error(`OpenRouter request failed with HTTP ${status}.`);
  }
}

function isValidToolCall(call: unknown): call is ToolCall {
  if (typeof call !== "object" || call === null) {
    return false;
  }
  const candidate = call as Record<string, unknown>;
  const fn = candidate.function as Record<string, unknown> | undefined;
  return (
    typeof candidate.id === "string" &&
    candidate.type === "function" &&
    typeof fn?.name === "string" &&
    typeof fn?.arguments === "string"
  );
}

// ── Raw OpenRouter response shape (only the fields we read) ───────────────────

interface OpenRouterChatCompletion {
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
