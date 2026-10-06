import type { McpBridge } from "../../mcp/bridge/mcp-bridge.js";
import {
  toOpenAiTools,
  type OpenAiToolDefinition,
} from "../../mcp/bridge/mcp-tool-adapter.js";
import {
  OpenRouterToolClient,
  type ToolCall,
  type ToolChatMessage,
  type ToolChatResponse,
} from "./openrouter-tool-client.js";

/**
 * The minimal LLM surface the agent depends on. OpenRouterToolClient satisfies
 * this; declaring it as an interface lets unit tests inject a scripted client
 * without any network access.
 */
export interface ToolCallingLlm {
  readonly modelName: string;
  send(
    messages: ToolChatMessage[],
    tools: OpenAiToolDefinition[],
    options?: { temperature?: number; signal?: AbortSignal },
  ): Promise<ToolChatResponse>;
}

/** Default safety ceiling on tool-calling iterations. */
export const DEFAULT_MAX_AGENT_ITERATIONS = 10;

/** Progress events emitted during an agent run. */
export type AgentProgress = (event: AgentProgressEvent) => void;

export interface AgentProgressEvent {
  type:
    | "llm-start"
    | "tool-requested"
    | "tool-executing"
    | "tool-result"
    | "llm-continue"
    | "final";
  message: string;
  toolName?: string;
}

export interface RunAgentOptions {
  system: string;
  prompt: string;
  maxIterations?: number;
  temperature?: number;
  signal?: AbortSignal;
  onProgress?: AgentProgress;
}

export interface AgentToolInvocation {
  llmToolName: string;
  server: string;
  mcpToolName: string;
  success: boolean;
}

export interface RunAgentResult {
  finalContent: string;
  model: string;
  iterations: number;
  toolInvocations: AgentToolInvocation[];
}

/**
 * A generic agent that lets an LLM orchestrate MCP tools via OpenRouter.
 *
 * The agent owns the loop; the LLM owns the decision of which tool to call. The
 * bridge is the execution boundary and allowlist. There is no Sitecore-specific
 * or migration-specific logic here — it works with whatever tools the bridge
 * discovered.
 */
export class McpAgent {
  constructor(
    private readonly llm: ToolCallingLlm,
    private readonly bridge: McpBridge,
  ) {}

  static fromEnvironment(
    bridge: McpBridge,
    environment: NodeJS.ProcessEnv = process.env,
  ): McpAgent {
    return new McpAgent(OpenRouterToolClient.fromEnvironment(environment), bridge);
  }

  async run(options: RunAgentOptions): Promise<RunAgentResult> {
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_AGENT_ITERATIONS;
    const onProgress = options.onProgress ?? (() => {});
    const tools = toOpenAiTools(this.bridge.listRegisteredTools());

    const messages: ToolChatMessage[] = [
      { role: "system", content: options.system },
      { role: "user", content: options.prompt },
    ];

    const toolInvocations: AgentToolInvocation[] = [];
    let lastModel = this.llm.modelName;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.throwIfAborted(options.signal);

      onProgress({
        type: iteration === 1 ? "llm-start" : "llm-continue",
        message:
          iteration === 1
            ? "Sending prompt to the LLM..."
            : "Sending tool results back to the LLM...",
      });

      const response = await this.llm.send(messages, tools, {
        temperature: options.temperature,
        signal: options.signal,
      });
      lastModel = response.model;

      // No tool calls: this is the final answer.
      if (response.toolCalls.length === 0) {
        onProgress({ type: "final", message: "The LLM returned a final response." });
        return {
          finalContent: response.content,
          model: lastModel,
          iterations: iteration,
          toolInvocations,
        };
      }

      // Record the assistant turn (with its tool-call requests) verbatim so the
      // follow-up tool messages correlate correctly.
      messages.push({
        role: "assistant",
        content: response.content || null,
        tool_calls: response.toolCalls,
      });

      // Execute each requested tool and append its result.
      for (const toolCall of response.toolCalls) {
        this.throwIfAborted(options.signal);
        const invocation = await this.executeToolCall(toolCall, onProgress);
        toolInvocations.push(invocation.summary);
        messages.push(invocation.message);
      }
    }

    throw new Error(
      `The agent exceeded the maximum of ${maxIterations} tool-calling iterations without producing a final response.`,
    );
  }

  private async executeToolCall(
    toolCall: ToolCall,
    onProgress: AgentProgress,
  ): Promise<{ message: ToolChatMessage; summary: AgentToolInvocation }> {
    const llmToolName = toolCall.function.name;

    onProgress({
      type: "tool-requested",
      message: `The LLM requested tool ${llmToolName}.`,
      toolName: llmToolName,
    });
    onProgress({
      type: "tool-executing",
      message: `Executing MCP tool ${llmToolName}...`,
      toolName: llmToolName,
    });

    // The bridge validates the tool against the allowlist and coerces args;
    // unknown tools and bad arguments come back as structured failures.
    const result = await this.bridge.executeTool(
      llmToolName,
      toolCall.function.arguments,
    );

    onProgress({
      type: "tool-result",
      message: result.success
        ? `MCP tool ${llmToolName} completed.`
        : `MCP tool ${llmToolName} failed: ${result.error ?? "unknown error"}`,
      toolName: llmToolName,
    });

    return {
      message: {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      },
      summary: {
        llmToolName,
        server: result.server,
        mcpToolName: result.tool,
        success: result.success,
      },
    };
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new Error("The agent run was cancelled.");
    }
  }
}
