/**
 * SitecoreAI Authoring & Management GraphQL API client.
 *
 * Authentication: Client Credentials flow via auth.sitecorecloud.io.
 * Endpoint:       https://<cm-host>/sitecore/api/authoring/graphql/v1/
 *
 * Schema reference:
 *   search query  → results { innerItem { itemId, name, path } }
 *   item query    → item(where: { database, itemId }) { itemId, name, path }
 */

export interface AgentApiConfig {
  /** SitecoreAI CM host, e.g. "https://your-instance.sitecorecloud.io" */
  cmHost: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** OAuth audience – defaults to "https://api.sitecorecloud.io" */
  audience?: string;
}

export interface SitecoreAiItem {
  itemId: string;
  name: string;
  path: string;
}

export class SitecoreAiAgentApi {
  private readonly graphqlEndpoint: string;
  private readonly authEndpoint = "https://auth.sitecorecloud.io/oauth/token";
  private readonly audience: string;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: AgentApiConfig) {
    this.graphqlEndpoint = `${config.cmHost.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1/`;
    this.audience = config.audience ?? "https://api.sitecorecloud.io";
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      audience: this.audience,
    });

    const res = await fetch(this.authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SitecoreAI auth failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = await res.json() as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  // ── GraphQL execution ───────────────────────────────────────────────────────

  async gql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.getToken();

    const res = await fetch(this.graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SitecoreAI GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = await res.json() as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(
        `SitecoreAI GraphQL errors: ${json.errors.map(e => e.message).join("; ")}`,
      );
    }

    return json.data as T;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Search items by exact name using the _name system field.
   * Uses the correct Authoring API schema:
   *   search(query: { searchStatement: { criteria: [...] } })
   *   results { innerItem { itemId name path } }
   */
  async searchByName(name: string, pageSize = 20): Promise<SitecoreAiItem[]> {
    const query = `
      query SearchByName($name: String!, $pageSize: Int!) {
        search(
          query: {
            index: "sitecore_master_index"
            paging: { pageSize: $pageSize, pageIndex: 0 }
            searchStatement: {
              criteria: [
                { operator: MUST, criteriaType: EXACT, field: "_name", value: $name }
              ]
            }
          }
        ) {
          results {
            innerItem {
              itemId
              name
              path
            }
          }
        }
      }
    `;

    type SearchData = {
      search: { results: Array<{ innerItem: { itemId: string; name: string; path: string } | null }> };
    };

    const data = await this.gql<SearchData>(query, { name, pageSize });
    return data.search.results
      .map(r => r.innerItem)
      .filter((i): i is SitecoreAiItem => i !== null);
  }

  /**
   * Get an item directly by its GUID.
   *
   * SitecoreAI expects itemId in the where clause using
   * Sitecore GUID format:
   *
   *   {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
   */
  async getItemById(
    itemId: string,
  ): Promise<SitecoreAiItem | null> {
    const id = formatSitecoreId(itemId);

    const query = `
    query GetItemById {
      item(
        where: {
          database: "master"
          itemId: "${id}"
        }
      ) {
        itemId
        name
        path
      }
    }
  `;

    type ItemData = {
      item: SitecoreAiItem | null;
    };

    const data =
      await this.gql<ItemData>(query);

    return data.item;
  }
}

/**
 * Converts a Sitecore item ID into standard GUID format.
 *
 * Accepts:
 *   2a3e91a0798744b5ab3435c2d9de83b9
 *   2a3e91a0-7987-44b5-ab34-35c2d9de83b9
 *   {2A3E91A0-7987-44B5-AB34-35C2D9DE83B9}
 *
 * Returns:
 *   {2A3E91A0-7987-44B5-AB34-35C2D9DE83B9}
 */
function formatSitecoreId(
  value: string,
): string {
  const hex = value
    .replace(/[{}-]/g, "")
    .trim()
    .toUpperCase();

  if (!/^[0-9A-F]{32}$/.test(hex)) {
    throw new Error(
      `Invalid Sitecore item ID: ${value}`,
    );
  }

  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}

/**
 * Creates a SitecoreAiAgentApi from environment variables.
 *
 * Required .env vars:
 *   SITECORE_AI_CM_HOST        – CM instance URL
 *   SITECORE_AI_CLIENT_ID      – OAuth client ID
 *   SITECORE_AI_CLIENT_SECRET  – OAuth client secret
 */
export function createAgentApiFromEnv(): SitecoreAiAgentApi {
  const cmHost = process.env.SITECORE_AI_CM_HOST;
  const clientId = process.env.SITECORE_AI_CLIENT_ID;
  const clientSecret = process.env.SITECORE_AI_CLIENT_SECRET;

  if (!cmHost) throw new Error("SITECORE_AI_CM_HOST is not set in .env");
  if (!clientId) throw new Error("SITECORE_AI_CLIENT_ID is not set in .env");
  if (!clientSecret) throw new Error("SITECORE_AI_CLIENT_SECRET is not set in .env");

  return new SitecoreAiAgentApi({ cmHost, clientId, clientSecret });
}
