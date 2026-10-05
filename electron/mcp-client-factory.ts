/**
 * Builds the MCP client pair (XP + SitecoreAI) used by the analysis engine.
 *
 * Real transports require live MCP server connections configured via .env.
 * When a server is unavailable the factory falls back to a stub client that
 * returns null for every lookup — the analyser treats that as "not found" and
 * records an exception rather than crashing.
 *
 * This file lives in electron/ because it needs access to env vars and because
 * the MCP transports are Node.js network clients (not safe in the renderer).
 */

import type { SitecoreMcpClient, SitecoreItemMetadata } from "../src/mcp/mcp-client.js";
import { SitecoreAiMcpClient } from "../src/mcp/sitecore-ai/sitecore-ai-mcp-client.js";
import type { SitecoreAiMcpTransport } from "../src/mcp/sitecore-ai/sitecore-ai-mcp-client.js";
import type { McpClients } from "../src/migration/case-analyser.js";

// ── Null stub — used when a server is not configured ─────────────────────────

class NullMcpClient implements SitecoreMcpClient {
  async getItemById(_id: string): Promise<SitecoreItemMetadata | null> { return null; }
  async getItemByPath(_path: string): Promise<SitecoreItemMetadata | null> { return null; }
  async getChildren(_parentId: string): Promise<SitecoreItemMetadata[]> { return []; }
  async getItemByName(_name: string, _parentId: string): Promise<SitecoreItemMetadata | null> { return null; }
}

// ── SitecoreAI HTTP transport ─────────────────────────────────────────────────
// Calls the SitecoreAI MCP REST endpoint directly.

class SitecoreAiHttpTransport implements SitecoreAiMcpTransport {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async getContentItemById(itemId: string, language = "en"): Promise<unknown> {
    return this.call("get_content_item_by_id", { itemId, language });
  }

  async getContentItemByPath(
    itemPath: string,
    language = "en",
    failOnNotFound = false,
  ): Promise<unknown> {
    return this.call("get_content_item_by_path", { itemPath, language, failOnNotFound });
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ tool, arguments: args }),
    });

    if (!response.ok) {
      throw new Error(`SitecoreAI MCP request failed: HTTP ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  }
}

// ── XP GraphQL client ─────────────────────────────────────────────────────────
// Queries the Sitecore XP GraphQL endpoint to resolve items by path/ID.

class XpGraphqlMcpClient implements SitecoreMcpClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly database = "master",
  ) {}

  async getItemById(id: string): Promise<SitecoreItemMetadata | null> {
    const query = `
      query GetItemById($id: String!, $db: String!) {
        item(path: $id, language: "en", database: $db) {
          id name path
          template { id name }
          parent { id }
        }
      }
    `;
    return this.queryItem(query, { id, db: this.database });
  }

  async getItemByPath(path: string): Promise<SitecoreItemMetadata | null> {
    const query = `
      query GetItemByPath($path: String!, $db: String!) {
        item(path: $path, language: "en", database: $db) {
          id name path
          template { id name }
          parent { id }
        }
      }
    `;
    return this.queryItem(query, { path, db: this.database });
  }

  async getChildren(parentId: string): Promise<SitecoreItemMetadata[]> {
    const query = `
      query GetChildren($parentId: String!, $db: String!) {
        item(path: $parentId, language: "en", database: $db) {
          children {
            nodes {
              id name path
              template { id name }
              parent { id }
            }
          }
        }
      }
    `;
    const result = await this.graphql<{
      item?: { children?: { nodes?: RawItem[] } };
    }>(query, { parentId, db: this.database });

    return (result?.item?.children?.nodes ?? []).map(toMetadata);
  }

  async getItemByName(
    name: string,
    parentId: string,
  ): Promise<SitecoreItemMetadata | null> {
    const children = await this.getChildren(parentId);
    return children.find((c) => c.name === name) ?? null;
  }

  private async queryItem(
    query: string,
    variables: Record<string, string>,
  ): Promise<SitecoreItemMetadata | null> {
    const result = await this.graphql<{ item?: RawItem }>(query, variables);
    if (!result?.item) return null;
    return toMetadata(result.item);
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, string>,
  ): Promise<T | null> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        sc_apikey: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`XP GraphQL request failed: HTTP ${response.status}`);
    }

    const json = (await response.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new Error(`XP GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data ?? null;
  }
}

interface RawItem {
  id: string;
  name: string;
  path: string;
  template?: { id: string; name: string };
  parent?: { id: string };
}

function toMetadata(raw: RawItem): SitecoreItemMetadata {
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    parentId: raw.parent?.id ?? "",
    templateId: raw.template?.id ?? "",
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface McpClientStatus {
  xpConnected: boolean;
  sitecoreAiConnected: boolean;
  warnings: string[];
}

export function buildMcpClients(): { clients: McpClients; status: McpClientStatus } {
  const warnings: string[] = [];

  console.log("🔍 Building MCP clients...");
  console.log("  SITECORE_XP_GRAPHQL_ENDPOINT:", process.env["SITECORE_XP_GRAPHQL_ENDPOINT"]);
  console.log("  SITECORE_XP_GRAPHQL_API_KEY:", process.env["SITECORE_XP_GRAPHQL_API_KEY"]);

  // XP client
  let xpClient: SitecoreMcpClient;
  const xpEndpoint = process.env["SITECORE_XP_GRAPHQL_ENDPOINT"];
  const xpApiKey = process.env["SITECORE_XP_GRAPHQL_API_KEY"];
  const xpDatabase = process.env["SITECORE_SOURCE_DATABASE"] ?? "master";

  console.log("  XP Endpoint present:", !!xpEndpoint);
  console.log("  XP API Key present:", !!xpApiKey);

  if (xpEndpoint && xpApiKey) {
    xpClient = new XpGraphqlMcpClient(xpEndpoint, xpApiKey, xpDatabase);
  } else {
    warnings.push("XP GraphQL endpoint or API key not configured — XP MCP unavailable.");
    xpClient = new NullMcpClient();
  }

  // SitecoreAI client
  let sitecoreAiClient: SitecoreMcpClient;
  const aiEndpoint = process.env["SITECORE_AI_ENDPOINT"];
  const aiApiKey = process.env["SITECORE_AI_API_KEY"];

  console.log("  AI Endpoint present:", !!aiEndpoint);
  console.log("  AI API Key present:", !!aiApiKey);

  if (aiEndpoint && aiApiKey) {
    const transport = new SitecoreAiHttpTransport(aiEndpoint, aiApiKey);
    sitecoreAiClient = new SitecoreAiMcpClient(transport);
  } else {
    warnings.push("SitecoreAI endpoint or API key not configured — SitecoreAI MCP unavailable.");
    sitecoreAiClient = new NullMcpClient();
  }

  console.log("  XP Client created:", xpClient instanceof XpGraphqlMcpClient);
  console.log("  SitecoreAI Client created:", sitecoreAiClient instanceof SitecoreAiMcpClient);

  return {
    clients: { xp: xpClient, sitecoreAI: sitecoreAiClient },
    status: {
      xpConnected: !!(xpEndpoint && xpApiKey),
      sitecoreAiConnected: !!(aiEndpoint && aiApiKey),
      warnings,
    },
  };
}
