import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { BrowserOAuthProvider } from "./browser-oauth-provider.js";
import type {
  McpClientLike,
  McpServerConfig,
} from "../../src/mcp/bridge/types.js";

/**
 * Reads mcp.json and builds live MCP connections for the generic bridge.
 *
 * This Electron-side module owns all transport and credential concerns:
 *  - stdio servers are spawned as child processes with env substitution.
 *  - HTTP servers use StreamableHTTP with an SSE fallback and interactive OAuth.
 *
 * The generic bridge receives a connected McpClientLike and never sees any of
 * these details, keeping credentials out of the shared/generic layer.
 */

interface McpJsonStdioServer {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpJsonHttpServer {
  url: string;
  auth?: { type?: string };
}

type McpJsonServer = McpJsonStdioServer | McpJsonHttpServer;

interface McpJson {
  servers: Record<string, McpJsonServer>;
}

/** Maps a human-readable mcp.json server name to a stable logical id. */
export interface ConfiguredServer extends McpServerConfig {
  /** The raw name/key as it appears in mcp.json. */
  configName: string;
}

/** Loads mcp.json and returns the configured servers with stable ids. */
export async function loadConfiguredServers(
  projectRoot: string = process.cwd(),
): Promise<ConfiguredServer[]> {
  const config = await readMcpJson(projectRoot);
  return Object.keys(config.servers).map((name) => ({
    configName: name,
    id: toServerId(name),
    label: name,
  }));
}

/**
 * Builds a connection factory bound to a specific mcp.json. The returned
 * function connects a single server on demand.
 */
export function createMcpConnectionFactory(
  projectRoot: string = process.cwd(),
): (server: McpServerConfig) => Promise<McpClientLike> {
  return async (server: McpServerConfig): Promise<McpClientLike> => {
    const config = await readMcpJson(projectRoot);
    const match = Object.entries(config.servers).find(
      ([name]) => toServerId(name) === server.id,
    );

    if (!match) {
      throw new Error(`No MCP server named "${server.label}" found in mcp.json.`);
    }

    const [, definition] = match;

    if (isStdioServer(definition)) {
      return connectStdio(definition);
    }
    if (isHttpServer(definition)) {
      return connectHttp(definition);
    }
    throw new Error(`MCP server "${server.label}" has an unsupported configuration.`);
  };
}

async function readMcpJson(projectRoot: string): Promise<McpJson> {
  const file = path.join(projectRoot, "mcp.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (error) {
    throw new Error(
      `Could not read mcp.json at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const parsed = JSON.parse(raw) as McpJson;
    if (!parsed.servers || typeof parsed.servers !== "object") {
      throw new Error("mcp.json has no \"servers\" object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `mcp.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function connectStdio(server: McpJsonStdioServer): Promise<McpClientLike> {
  const env = resolveEnv(server.env ?? {});
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...filterUndefined(process.env), ...env },
  });
  const client = new Client(
    { name: "sitecore-migration-workbench", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client as unknown as McpClientLike;
}

async function connectHttp(server: McpJsonHttpServer): Promise<McpClientLike> {
  const url = new URL(server.url);
  const useOAuth = (server.auth?.type ?? "").toLowerCase() === "external";
  const oauthProvider = useOAuth ? new BrowserOAuthProvider() : undefined;

  if (oauthProvider) {
    await oauthProvider.startCallbackListener();
  }

  // Try modern Streamable HTTP first; fall back to legacy SSE on 404/405/501.
  try {
    return await connectHttpTransport("streamable", url, oauthProvider);
  } catch (error) {
    if (!isUnsupportedTransport(error)) {
      throw error;
    }
    return await connectHttpTransport("sse", url, oauthProvider);
  }
}

async function connectHttpTransport(
  kind: "streamable" | "sse",
  url: URL,
  oauthProvider: BrowserOAuthProvider | undefined,
): Promise<McpClientLike> {
  const makeTransport = () =>
    kind === "streamable"
      ? new StreamableHTTPClientTransport(url, oauthProvider ? { authProvider: oauthProvider } : {})
      : new SSEClientTransport(url, oauthProvider ? { authProvider: oauthProvider } : {});

  let client = new Client(
    { name: "sitecore-migration-workbench", version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = makeTransport();
  try {
    await client.connect(transport);
    return client as unknown as McpClientLike;
  } catch (initialError) {
    // Without OAuth, or if the browser flow was not triggered, surface the error.
    if (!oauthProvider?.isAuthorizationPending()) {
      throw initialError;
    }
    const code = await oauthProvider.waitForAuthorizationCode().catch(() => {
      throw initialError;
    });
    await transport.finishAuth(code);
    // A transport cannot be restarted, so reconnect with a fresh client.
    client = new Client(
      { name: "sitecore-migration-workbench", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(makeTransport());
    return client as unknown as McpClientLike;
  }
}

/** Substitutes ${VAR} placeholders in env values from process.env. */
function resolveEnv(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      return process.env[name] ?? "";
    });
  }
  return resolved;
}

function filterUndefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function isStdioServer(server: McpJsonServer): server is McpJsonStdioServer {
  return "command" in server && typeof server.command === "string";
}

function isHttpServer(server: McpJsonServer): server is McpJsonHttpServer {
  return "url" in server && typeof server.url === "string";
}

function isUnsupportedTransport(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  return code === 404 || code === 405 || code === 501;
}

/** Converts a display name like "Sitecore XP" into an id like "sitecore_xp". */
export function toServerId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
