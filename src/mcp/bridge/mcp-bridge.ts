import { McpServerConnection } from "./mcp-server-connection.js";
import { McpToolRegistry } from "./mcp-tool-registry.js";
import type {
  McpConnectionFactory,
  McpServerConfig,
  NormalizedToolResult,
  RegisteredTool,
} from "./types.js";

/** Progress callback for bridge lifecycle events (connect, discover, call). */
export type McpBridgeProgress = (message: string) => void;

/** Per-server tool discovery summary. */
export interface ServerDiscovery {
  serverId: string;
  serverLabel: string;
  toolCount: number;
}

/**
 * A generic bridge over one or more MCP servers. It owns connection lifecycle
 * and tool discovery, and exposes a flat, collision-safe tool registry plus a
 * single entry point to execute any discovered tool by its LLM name.
 *
 * It contains no Sitecore-specific or tool-specific logic.
 */
export class McpBridge {
  private readonly connections: McpServerConnection[];
  private readonly registry = new McpToolRegistry();

  constructor(
    servers: McpServerConfig[],
    connectionFactory: McpConnectionFactory,
    private readonly onProgress: McpBridgeProgress = () => {},
  ) {
    this.connections = servers.map(
      (server) => new McpServerConnection(server, connectionFactory),
    );
  }

  /** The collision-safe tool registry (the LLM allowlist). */
  get toolRegistry(): McpToolRegistry {
    return this.registry;
  }

  /**
   * Connects to every configured server and discovers its tools, populating the
   * registry. If one server fails, its error is recorded and the remaining
   * servers are still attempted; the failure is returned for reporting.
   */
  async connectAndDiscover(): Promise<{
    discoveries: ServerDiscovery[];
    failures: Array<{ serverLabel: string; error: string }>;
  }> {
    const discoveries: ServerDiscovery[] = [];
    const failures: Array<{ serverLabel: string; error: string }> = [];

    for (const connection of this.connections) {
      try {
        this.onProgress(`Connecting to ${connection.label} MCP...`);
        await connection.connect();
        this.onProgress(`Connected to ${connection.label} MCP.`);

        const tools = await connection.listTools();
        const registered = this.registry.registerServerTools(
          connection.id,
          connection.label,
          tools,
        );

        this.onProgress(
          `Discovered ${registered.length} ${connection.label} tool${registered.length === 1 ? "" : "s"}.`,
        );
        discoveries.push({
          serverId: connection.id,
          serverLabel: connection.label,
          toolCount: registered.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ serverLabel: connection.label, error: message });
        this.onProgress(`Failed to initialize ${connection.label} MCP: ${message}`);
      }
    }

    return { discoveries, failures };
  }

  /** All registered tools across all connected servers. */
  listRegisteredTools(): RegisteredTool[] {
    return this.registry.all();
  }

  /**
   * Executes a tool chosen by the LLM. Validates the tool against the registry
   * (the allowlist) and routes the call to the owning server connection.
   *
   * Unknown tools and malformed arguments return a structured failure result so
   * the agent loop can relay the error back to the LLM rather than crashing.
   */
  async executeTool(
    llmToolName: string,
    args: unknown,
  ): Promise<NormalizedToolResult> {
    const tool = this.registry.resolve(llmToolName);

    if (!tool) {
      return {
        server: "unknown",
        tool: llmToolName,
        success: false,
        error: `Unknown tool "${llmToolName}". It is not in the list of available tools.`,
      };
    }

    const normalizedArgs = this.coerceArgs(args);
    if (normalizedArgs === undefined) {
      return {
        server: tool.serverLabel,
        tool: tool.mcpToolName,
        success: false,
        error:
          "Tool arguments were malformed. Arguments must be a JSON object of named parameters.",
      };
    }

    const connection = this.connections.find((c) => c.id === tool.serverId);
    if (!connection) {
      return {
        server: tool.serverLabel,
        tool: tool.mcpToolName,
        success: false,
        error: `No active connection for server "${tool.serverLabel}".`,
      };
    }

    this.onProgress(`Executing MCP tool ${llmToolName}...`);
    const result = await connection.callTool(tool.mcpToolName, normalizedArgs);
    this.onProgress(
      result.success
        ? `MCP tool ${llmToolName} completed.`
        : `MCP tool ${llmToolName} failed: ${result.error ?? "unknown error"}`,
    );
    return result;
  }

  /** Disconnects all server connections. */
  async disconnect(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.disconnect()));
  }

  /**
   * Coerces LLM-supplied arguments into a plain object. OpenAI tool calls carry
   * arguments as a JSON string; this accepts that, an already-parsed object, or
   * an empty value (treated as no arguments). Returns undefined when the value
   * cannot be interpreted as an argument object.
   */
  private coerceArgs(args: unknown): Record<string, unknown> | undefined {
    if (args === null || args === undefined || args === "") {
      return {};
    }

    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args) as unknown;
        return this.isPlainObject(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }

    return this.isPlainObject(args) ? args : undefined;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
