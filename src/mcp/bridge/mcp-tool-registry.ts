import type { McpToolDefinition, RegisteredTool } from "./types.js";

/**
 * Holds the allowlist of tools discovered across all MCP servers and resolves
 * LLM tool names back to a concrete (server, mcpToolName) pair.
 *
 * The registry is the security boundary: the LLM may only invoke a tool that
 * exists here. Anything else is rejected.
 */
export class McpToolRegistry {
  private readonly byLlmName = new Map<string, RegisteredTool>();

  /**
   * Registers the tools a server exposed, prefixing each name with the server
   * id to prevent collisions between servers that use the same tool name.
   */
  registerServerTools(
    serverId: string,
    serverLabel: string,
    tools: McpToolDefinition[],
  ): RegisteredTool[] {
    const registered: RegisteredTool[] = [];

    for (const tool of tools) {
      const llmToolName = McpToolRegistry.buildLlmToolName(serverId, tool.name);

      if (this.byLlmName.has(llmToolName)) {
        // Same server advertised the same tool twice; keep the first and skip.
        continue;
      }

      const entry: RegisteredTool = {
        llmToolName,
        serverId,
        serverLabel,
        mcpToolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };

      this.byLlmName.set(llmToolName, entry);
      registered.push(entry);
    }

    return registered;
  }

  /** Resolves an LLM tool name to its registration, or undefined if unknown. */
  resolve(llmToolName: string): RegisteredTool | undefined {
    return this.byLlmName.get(llmToolName);
  }

  /** Returns true if the given LLM tool name is a known, callable tool. */
  has(llmToolName: string): boolean {
    return this.byLlmName.has(llmToolName);
  }

  /** All registered tools across every server. */
  all(): RegisteredTool[] {
    return [...this.byLlmName.values()];
  }

  /** Number of registered tools. */
  get size(): number {
    return this.byLlmName.size;
  }

  /**
   * Builds a collision-safe LLM tool name, e.g. "sitecore_xp" + "get_item" =>
   * "sitecore_xp__get_item". The result is sanitized to the character set that
   * OpenAI-compatible function names allow ([a-zA-Z0-9_-]).
   */
  static buildLlmToolName(serverId: string, mcpToolName: string): string {
    const safeServer = McpToolRegistry.sanitize(serverId);
    const safeTool = McpToolRegistry.sanitize(mcpToolName);
    return `${safeServer}__${safeTool}`;
  }

  private static sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}
