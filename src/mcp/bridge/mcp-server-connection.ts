import type {
  McpClientLike,
  McpConnectionFactory,
  McpServerConfig,
  McpToolDefinition,
  NormalizedContent,
  NormalizedToolResult,
} from "./types.js";

/**
 * Wraps a single MCP server connection. Generic: it does not know any tool
 * names and simply forwards discovery and tool-call requests to the underlying
 * client. The actual transport/credential setup is provided by a connection
 * factory so this class stays testable and vendor-neutral.
 */
export class McpServerConnection {
  private client: McpClientLike | undefined;
  private tools: McpToolDefinition[] = [];

  constructor(
    private readonly config: McpServerConfig,
    private readonly connectionFactory: McpConnectionFactory,
  ) {}

  get id(): string {
    return this.config.id;
  }

  get label(): string {
    return this.config.label;
  }

  get isConnected(): boolean {
    return this.client !== undefined;
  }

  /** Establishes the connection. Safe to call once; no-op if already connected. */
  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    try {
      this.client = await this.connectionFactory(this.config);
    } catch (error) {
      throw new Error(
        `Failed to connect to MCP server "${this.config.label}": ${this.describeError(error)}`,
      );
    }
  }

  /** Discovers the tools the server exposes and caches them. */
  async listTools(): Promise<McpToolDefinition[]> {
    const client = this.requireClient();
    try {
      const result = await client.listTools();
      this.tools = (result.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      }));
      return this.tools;
    } catch (error) {
      throw new Error(
        `Failed to discover tools on MCP server "${this.config.label}": ${this.describeError(error)}`,
      );
    }
  }

  /**
   * Executes a tool by its original (unqualified) MCP name and returns a
   * normalized result. MCP-reported errors are returned as a structured failure
   * result (not thrown) so the agent loop can hand them back to the LLM.
   */
  async callTool(
    mcpToolName: string,
    args: Record<string, unknown>,
  ): Promise<NormalizedToolResult> {
    const client = this.requireClient();

    try {
      const raw = await client.callTool({ name: mcpToolName, arguments: args });
      const content = this.normalizeContent(raw.content);

      if (raw.isError) {
        return {
          server: this.config.label,
          tool: mcpToolName,
          success: false,
          content,
          error: this.extractErrorText(content) ?? "The MCP tool reported an error.",
        };
      }

      return {
        server: this.config.label,
        tool: mcpToolName,
        success: true,
        content,
      };
    } catch (error) {
      return {
        server: this.config.label,
        tool: mcpToolName,
        success: false,
        error: this.describeError(error),
      };
    }
  }

  /** Closes the connection. Safe to call when not connected. */
  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.tools = [];
    if (client) {
      try {
        await client.close();
      } catch {
        // A failure to close cleanly must not mask the primary workflow result.
      }
    }
  }

  private requireClient(): McpClientLike {
    if (!this.client) {
      throw new Error(
        `MCP server "${this.config.label}" is not connected. Call connect() first.`,
      );
    }
    return this.client;
  }

  private normalizeContent(
    content: Array<{ type: string; text?: string; [key: string]: unknown }> | undefined,
  ): NormalizedContent[] {
    if (!Array.isArray(content)) {
      return [];
    }
    return content.map((item) => {
      if (item.type === "text") {
        return { type: "text", text: item.text ?? "" };
      }
      // Strip transport-only noise; pass the meaningful payload through as data.
      const { type, ...rest } = item;
      return { type, data: rest };
    });
  }

  private extractErrorText(content: NormalizedContent[]): string | undefined {
    const text = content.find((item) => item.type === "text" && item.text);
    return text?.text;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    return "Unknown error.";
  }
}
