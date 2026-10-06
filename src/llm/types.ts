/**
 * Application-owned LLM types. Keeping these independent from a vendor SDK
 * allows future providers to implement the same contract.
 */
export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface LlmChatRequest {
  system?: string;
  messages: LlmChatMessage[];
  temperature?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmChatResponse {
  content: string;
  model: string;
  usage?: LlmUsage;
}
