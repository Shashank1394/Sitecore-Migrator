import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { McpBridge } from "../src/mcp/bridge/mcp-bridge.js";
import { McpAgent } from "../src/llm/agent/mcp-agent.js";
import { MCP_INVESTIGATION_SYSTEM_PROMPT } from "../src/llm/agent/system-prompt.js";
import type {
  McpClientLike,
  McpConnectionFactory,
  McpServerConfig,
} from "../src/mcp/bridge/types.js";

dotenv.config();

/**
 * Integration test: real MCP servers (from mcp.json) + real OpenRouter.
 *
 * This script runs outside Electron, so it cannot perform the interactive
 * browser OAuth flow. HTTP servers that require OAuth are attempted without an
 * auth provider; if they reject the connection, that server is reported as a
 * failure and the test proceeds with whatever servers connected (typically the
 * stdio Sitecore XP server).
 */

interface McpJson {
  servers: Record<
    string,
    {
      type?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      auth?: { type?: string };
    }
  >;
}

function toServerId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function resolveEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value.replace(/\$\{([^}]+)\}/g, (_m, name: string) => process.env[name] ?? "");
  }
  return out;
}

function stringEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function loadMcpJson(): Promise<McpJson> {
  const file = path.join(process.cwd(), "mcp.json");
  return JSON.parse(await readFile(file, "utf-8")) as McpJson;
}

function makeFactory(config: McpJson): McpConnectionFactory {
  return async (server: McpServerConfig): Promise<McpClientLike> => {
    const entry = Object.entries(config.servers).find(
      ([name]) => toServerId(name) === server.id,
    );
    if (!entry) throw new Error(`Server "${server.label}" not in mcp.json.`);
    const [, def] = entry;

    const client = new Client(
      { name: "sitecore-migration-workbench-test", version: "1.0.0" },
      { capabilities: {} },
    );

    if (def.command) {
      const transport = new StdioClientTransport({
        command: def.command,
        args: def.args ?? [],
        env: { ...stringEnv(), ...resolveEnv(def.env ?? {}) },
      });
      await client.connect(transport);
      return client as unknown as McpClientLike;
    }

    if (def.url) {
      const url = new URL(def.url);
      try {
        await client.connect(new StreamableHTTPClientTransport(url, {}));
      } catch {
        const sseClient = new Client(
          { name: "sitecore-migration-workbench-test", version: "1.0.0" },
          { capabilities: {} },
        );
        await sseClient.connect(new SSEClientTransport(url, {}));
        return sseClient as unknown as McpClientLike;
      }
      return client as unknown as McpClientLike;
    }

    throw new Error(`Server "${server.label}" has an unsupported configuration.`);
  };
}

async function main(): Promise<void> {
  const config = await loadMcpJson();
  const servers: McpServerConfig[] = Object.keys(config.servers).map((name) => ({
    id: toServerId(name),
    label: name,
  }));

  const bridge = new McpBridge(servers, makeFactory(config), (message) =>
    console.log(`  ${message}`),
  );

  console.log("Discovering MCP tools...\n");
  const { discoveries, failures } = await bridge.connectAndDiscover();

  console.log("\n── Tool discovery summary ──");
  for (const d of discoveries) {
    console.log(`  ${d.serverLabel}: ${d.toolCount} tool(s)`);
  }
  for (const f of failures) {
    console.log(`  ${f.serverLabel}: FAILED — ${f.error}`);
  }

  if (bridge.listRegisteredTools().length === 0) {
    throw new Error(
      "No MCP tools were discovered. Cannot run the LLM tool-calling test. " +
        "Ensure at least one MCP server (e.g. Sitecore XP) is reachable.",
    );
  }

  console.log("\n── Starting LLM agent ──");
  const agent = McpAgent.fromEnvironment(bridge);

  const result = await agent.run({
    system: MCP_INVESTIGATION_SYSTEM_PROMPT,
    prompt: [
      "Use the available Sitecore tools to find the Sitecore item at:",
      "/sitecore/templates/Foundation/JavaScript Services/Json Rendering",
      "Return the item's ID, name, and path.",
      "Do not guess. Use the Sitecore MCP tool.",
    ].join("\n"),
    onProgress: (event) => {
      const suffix = event.toolName ? ` (${event.toolName})` : "";
      console.log(`  [${event.type}]${suffix} ${event.message}`);
    },
  });

  console.log("\n── Result ──");
  console.log(`  Model: ${result.model}`);
  console.log(`  Iterations: ${result.iterations}`);
  console.log(`  Tool calls: ${result.toolInvocations.length}`);
  for (const inv of result.toolInvocations) {
    console.log(`    - ${inv.llmToolName} on ${inv.server} => ${inv.success ? "ok" : "error"}`);
  }
  console.log("\nFinal response:\n");
  console.log(result.finalContent);

  await bridge.disconnect();
}

main().catch((error: unknown) => {
  console.error("\nMCP + LLM integration test failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
