/**
 * Generic, vendor-neutral MCP bridge types.
 *
 * These types intentionally know nothing about Sitecore, OpenRouter, or any
 * specific tool. They describe MCP tools in the abstract so the bridge can work
 * with whatever tools a server actually exposes.
 */

/** A JSON Schema object describing a tool's input arguments. */
export type JsonSchema = Record<string, unknown>;

/** A raw tool definition as discovered from an MCP server. */
export interface McpToolDefinition {
  /** The tool name as reported by the MCP server (unqualified). */
  name: string;
  /** Human-readable description provided by the MCP server. */
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: JsonSchema;
}

/**
 * A tool definition qualified with the server it came from and a globally
 * unique name used when presenting the tool to the LLM.
 */
export interface RegisteredTool {
  /** Globally unique name presented to the LLM, e.g. "sitecore_xp__get_item". */
  llmToolName: string;
  /** The logical server id this tool belongs to, e.g. "sitecore_xp". */
  serverId: string;
  /** Human-readable server label, e.g. "Sitecore XP". */
  serverLabel: string;
  /** The original (unqualified) MCP tool name used when calling the server. */
  mcpToolName: string;
  /** Tool description. */
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: JsonSchema;
}

/** The result of executing an MCP tool, normalized for the LLM. */
export interface NormalizedToolResult {
  /** Human-readable server label. */
  server: string;
  /** Original MCP tool name. */
  tool: string;
  /** Whether the tool call succeeded. */
  success: boolean;
  /**
   * Normalized content items returned by the tool. Present on success and may
   * also carry partial content on failure. Transport metadata is omitted.
   */
  content?: NormalizedContent[];
  /** Error message when success is false. Never contains credentials. */
  error?: string;
}

/** A single normalized content item from an MCP tool result. */
export interface NormalizedContent {
  type: string;
  /** Text payload for text content. */
  text?: string;
  /** Non-text payloads are passed through as data without transport metadata. */
  data?: unknown;
}

/**
 * The minimal surface of an MCP SDK client the bridge depends on. Declaring our
 * own structural type (instead of importing the SDK Client) keeps this module
 * free of a hard SDK dependency and makes it trivial to mock in unit tests.
 */
export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: McpToolDefinition[] }>;
  callTool(request: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpRawToolResult>;
}

/** The raw shape of an MCP tool result as returned by the SDK. */
export interface McpRawToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * A factory that establishes a connection for a configured server and returns a
 * connected, ready-to-use MCP client. Supplying this as a dependency lets the
 * Electron layer own transport/credential concerns (stdio spawn, OAuth) while
 * the generic bridge stays testable with mocks.
 */
export type McpConnectionFactory = (
  server: McpServerConfig,
) => Promise<McpClientLike>;

/** Configuration describing a single MCP server to connect to. */
export interface McpServerConfig {
  /** Stable logical id used for tool-name prefixing, e.g. "sitecore_xp". */
  id: string;
  /** Human-readable label, e.g. "Sitecore XP". */
  label: string;
}
