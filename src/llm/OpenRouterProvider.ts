import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages } from "@openrouter/sdk/models";
import type { LlmProvider } from "./LlmProvider.js";
import type {
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
} from "./types.js";

const DEFAULT_MODEL = "openrouter/free";

export interface OpenRouterProviderOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Backend-only OpenRouter implementation. Do not import this module from the
 * Electron renderer or preload script: its API key must remain in the main
 * process (or another trusted Node.js process).
 */
export class OpenRouterProvider implements LlmProvider {
  private readonly client: OpenRouter;
  private readonly model: string;

  constructor(options: OpenRouterProviderOptions = {}) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key is not configured.");
    }

    this.client = new OpenRouter({ apiKey });
    this.model = options.model?.trim() || DEFAULT_MODEL;
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): OpenRouterProvider {
    return new OpenRouterProvider({
      apiKey: environment.OPENROUTER_API_KEY,
      model: environment.OPENROUTER_MODEL,
    });
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const messages = this.toOpenRouterMessages(request);

    try {
      const response = await this.client.chat.send({
        chatRequest: {
          model: this.model,
          messages,
          temperature: request.temperature,
          stream: false,
        },
      });

      if (!("choices" in response) || !response.model) {
        throw new Error("OpenRouter returned a malformed response.");
      }

      const content = response.choices[0]?.message.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenRouter returned an empty response.");
      }

      return {
        content,
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("OpenRouter returned")) {
        throw error;
      }

      throw this.toProviderError(error);
    }
  }

  private toOpenRouterMessages(request: LlmChatRequest): ChatMessages[] {
    const messages: LlmChatMessage[] = request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;

    if (messages.length === 0) {
      throw new Error("OpenRouter request must contain at least one message.");
    }

    return messages.map((message) => {
      switch (message.role) {
        case "system":
          return { role: "system", content: message.content };
        case "user":
          return { role: "user", content: message.content };
        case "assistant":
          return { role: "assistant", content: message.content };
      }
    });
  }

  private toProviderError(error: unknown): Error {
    const statusCode = this.getStatusCode(error);
    if (statusCode === 401) {
      return new Error("OpenRouter request failed with HTTP 401.");
    }
    if (statusCode === 429) {
      return new Error("OpenRouter request was rate limited (HTTP 429).");
    }
    if (typeof statusCode === "number") {
      return new Error(`OpenRouter request failed with HTTP ${statusCode}.`);
    }

    if (error instanceof Error) {
      return new Error("OpenRouter network request failed.", { cause: error });
    }

    return new Error("OpenRouter request failed.");
  }

  private getStatusCode(error: unknown): number | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
    ) {
      return error.statusCode;
    }

    return undefined;
  }
}
