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
 *
 * NOTE: This file is currently NOT IN USE - the app now uses manual template
 * mappings from template-mappings.json instead of MCP clients.
 */

import type { SitecoreMcpClient, SitecoreItemMetadata } from "../src/mcp/mcp-client.js";
import { SitecoreAiMcpClient } from "../src/mcp/sitecore-ai/sitecore-ai-mcp-client.js";
import type { SitecoreAiMcpTransport } from "../src/mcp/sitecore-ai/sitecore-ai-mcp-client.js";
import { MarketerMcpClient } from "./marketer-mcp-client.js";

// ── MCP clients interface (legacy) ────────────────────────────────────────────

export interface McpClients {
  xp: SitecoreMcpClient;
  sitecoreAI: SitecoreMcpClient;
}

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
  ) {
    console.log(`🔍 XpGraphqlMcpClient initialized:`);
    console.log(`  Endpoint: ${endpoint}`);
    console.log(`  Database: ${database}`);
    console.log(`  API Key: ${apiKey.substring(0, 8)}...`);
  }

  async getItemById(id: string): Promise<SitecoreItemMetadata | null> {
    // Sitecore GraphQL can query by ID using the path parameter
    // Ensure the ID is in curly braces format: {GUID}
    const itemId = id.startsWith("{") ? id : `{${id}}`;
    
    console.log(`🔍 XP GraphQL: getItemById(${id}) -> querying with ${itemId}`);
    
    // Sitecore Integrated GraphQL query format
    const query = `
      query GetItemById($itemId: String!, $language: String!) {
        item(path: $itemId, language: $language) {
          id
          name
          path
          template {
            id
            name
          }
          parent {
            id
          }
        }
      }
    `;
    
    console.log(`🔍 XP GraphQL query:`, query);
    console.log(`🔍 XP GraphQL variables:`, { itemId, language: "en" });
    
    try {
      const result = await this.queryItem(query, { itemId, language: "en" });
      console.log(`🔍 XP GraphQL: getItemById(${id}) result:`, result ? `Found: ${result.name} at ${result.path}` : "Not found");
      return result;
    } catch (err) {
      console.error(`🔍 XP GraphQL: getItemById(${id}) error:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async getItemByPath(path: string): Promise<SitecoreItemMetadata | null> {
    const query = `
      query GetItemByPath($path: String!, $language: String!) {
        item(path: $path, language: $language) {
          id
          name
          path
          template {
            id
            name
          }
          parent {
            id
          }
        }
      }
    `;
    return this.queryItem(query, { path, language: "en" });
  }

  async getChildren(parentId: string): Promise<SitecoreItemMetadata[]> {
    const query = `
      query GetChildren($parentId: String!, $language: String!) {
        item(path: $parentId, language: $language) {
          children {
            id
            name
            path
            template {
              id
              name
            }
            parent {
              id
            }
          }
        }
      }
    `;
    const result = await this.graphql<{
      item?: { children?: RawItem[] };
    }>(query, { parentId, language: "en" });

    return (result?.item?.children ?? []).map(toMetadata);
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
    try {
      const requestBody = JSON.stringify({ query, variables });
      
      console.log(`🔍 XP GraphQL request to ${this.endpoint}`);
      console.log(`🔍 Request body:`, requestBody.substring(0, 200) + (requestBody.length > 200 ? '...' : ''));
      
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          sc_apikey: this.apiKey,
        },
        body: requestBody,
      });

      console.log(`🔍 XP GraphQL response status: ${response.status}`);
      console.log(`🔍 XP GraphQL response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const text = await response.text();
        console.error(`🔍 XP GraphQL error response (first 500 chars):`, text.substring(0, 500));
        throw new Error(`XP GraphQL request failed: HTTP ${response.status}`);
      }

      const json = (await response.json()) as { data?: T; errors?: unknown[] };
      
      console.log(`🔍 XP GraphQL response data:`, JSON.stringify(json).substring(0, 300));
      
      if (json.errors?.length) {
        console.error(`🔍 XP GraphQL errors:`, json.errors);
        throw new Error(`XP GraphQL errors: ${JSON.stringify(json.errors)}`);
      }
      
      return json.data ?? null;
    } catch (err) {
      console.error(`🔍 XP GraphQL fetch failed:`, err);
      throw new Error(`XP GraphQL fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  // XP client - using Null stub since we're not querying XP anymore
  console.log("  Using Null XP client (template GUIDs read from YAML)");
  const xpClient: SitecoreMcpClient = new NullMcpClient();

  // SitecoreAI client - using Marketer MCP from mcp.json
  let sitecoreAiClient: SitecoreMcpClient;
  
  // Hardcode the Marketer MCP URL from mcp.json
  const marketerMcpUrl = process.env["SITECORE_AI_ENDPOINT"] || 
                         "https://marketer.sitecorecloud.io/mcp/marketer-mcp-prod";

  console.log("  Connecting to Marketer MCP:", marketerMcpUrl);
  
  try {
    sitecoreAiClient = new MarketerMcpClient(marketerMcpUrl);
    console.log("  ✅ Marketer MCP client created");
  } catch (err) {
    console.error("  ❌ Failed to create Marketer MCP client:", err);
    warnings.push("Failed to create Marketer MCP client - using null stub");
    sitecoreAiClient = new NullMcpClient();
  }

  return {
    clients: { xp: xpClient, sitecoreAI: sitecoreAiClient },
    status: {
      xpConnected: false, // Not used anymore
      sitecoreAiConnected: true, // Assume connected, will fail gracefully if not
      warnings,
    },
  };
}
