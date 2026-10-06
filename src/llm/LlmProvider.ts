import type { LlmChatRequest, LlmChatResponse } from "./types.js";

/** A provider-neutral interface for backend LLM operations. */
export interface LlmProvider {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}
