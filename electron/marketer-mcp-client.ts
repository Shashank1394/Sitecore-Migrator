import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { shell } from "electron";
import type { SitecoreMcpClient, SitecoreItemMetadata } from "../src/mcp/mcp-client.js";

type OAuthTransport = StreamableHTTPClientTransport | SSEClientTransport;

/** A loopback callback is created only while an interactive sign-in is active. */
class BrowserOAuthProvider implements OAuthClientProvider {
  private clientInfo: OAuthClientInformationMixed | undefined;
  private tokenData: OAuthTokens | undefined;
  private verifier: string | undefined;
  private callbackServer: Server | undefined;
  private callbackUrl: string | undefined;
  private callbackPromise: Promise<string> | undefined;
  private resolveCallback: ((code: string) => void) | undefined;
  private rejectCallback: ((error: Error) => void) | undefined;
  private authorizationStarted = false;

  get redirectUrl(): string | undefined { return this.callbackUrl; }

  get clientMetadata(): OAuthClientMetadata {
    if (!this.callbackUrl) throw new Error("OAuth callback listener has not been started.");
    return {
      client_name: "Sitecore Migration Workbench",
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async startCallbackListener(): Promise<void> {
    if (this.callbackPromise) return;
    this.callbackPromise = new Promise<string>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
    this.callbackServer = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", this.callbackUrl);
      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      response.writeHead(error || !code ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(error || !code
        ? "<p>SitecoreAI sign-in did not complete. You may close this window.</p>"
        : "<p>SitecoreAI sign-in is complete. You may close this window.</p>");
      this.completeCallback(error ? new Error(error) : !code ? new Error("The authorization server did not return a code.") : undefined, code ?? undefined);
    });
    await new Promise<void>((resolve, reject) => {
      this.callbackServer!.once("error", reject);
      this.callbackServer!.listen(0, "127.0.0.1", () => {
        const address = this.callbackServer!.address();
        if (!address || typeof address === "string") return reject(new Error("Could not determine the OAuth callback address."));
        this.callbackUrl = `http://127.0.0.1:${address.port}/oauth/callback`;
        this.callbackServer!.off("error", reject);
        resolve();
      });
    });
  }

  async waitForAuthorizationCode(): Promise<string> {
    if (!this.callbackPromise) throw new Error("OAuth callback listener has not been started.");
    return this.callbackPromise;
  }

  isAuthorizationPending(): boolean { return this.authorizationStarted; }

  clientInformation(): OAuthClientInformationMixed | undefined { return this.clientInfo; }
  saveClientInformation(clientInformation: OAuthClientInformationMixed): void { this.clientInfo = clientInformation; }
  tokens(): OAuthTokens | undefined { return this.tokenData; }
  saveTokens(tokens: OAuthTokens): void { this.tokenData = tokens; }
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.authorizationStarted = true;
    await shell.openExternal(authorizationUrl.toString());
  }
  saveCodeVerifier(codeVerifier: string): void { this.verifier = codeVerifier; }
  codeVerifier(): string {
    if (!this.verifier) throw new Error("OAuth code verifier is unavailable.");
    return this.verifier;
  }

  private completeCallback(error?: Error, code?: string): void {
    const server = this.callbackServer;
    this.callbackServer = undefined;
    server?.close();
    if (error) this.rejectCallback?.(error);
    else if (code) this.resolveCallback?.(code);
  }
}

export class MarketerMcpClient implements SitecoreMcpClient {
  private client = this.createClient();
  private connected = false;
  private readonly oauthProvider = new BrowserOAuthProvider();

  constructor(private readonly serverUrl: string) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.oauthProvider.startCallbackListener();
    const url = new URL(this.serverUrl);
    try {
      await this.connectWithAuthorization(new StreamableHTTPClientTransport(url, { authProvider: this.oauthProvider }));
    } catch (error) {
      // Older MCP servers may expose only legacy SSE. OAuth failures surface unchanged.
      if (!this.isUnsupportedTransport(error)) throw error;
      this.client = this.createClient();
      await this.connectWithAuthorization(new SSEClientTransport(url, { authProvider: this.oauthProvider }));
    }
    this.connected = true;
  }

  private async connectWithAuthorization(transport: OAuthTransport): Promise<void> {
    try {
      await this.client.connect(transport);
      return;
    } catch (initialError) {
      // The first attempt launches the browser and remains unauthorized until the callback arrives.
      if (!this.oauthProvider.isAuthorizationPending()) throw initialError;
      const authorizationCode = await this.oauthProvider.waitForAuthorizationCode().catch(() => { throw initialError; });
      await transport.finishAuth(authorizationCode);
      // A transport cannot be started twice, so reconnect with a fresh client and transport.
      this.client = this.createClient();
      const authenticatedTransport = transport instanceof StreamableHTTPClientTransport
        ? new StreamableHTTPClientTransport(new URL(this.serverUrl), { authProvider: this.oauthProvider })
        : new SSEClientTransport(new URL(this.serverUrl), { authProvider: this.oauthProvider });
      await this.client.connect(authenticatedTransport);
    }
  }

  private createClient(): Client {
    return new Client({ name: "sitecore-migration-workbench", version: "1.0.0" }, { capabilities: {} });
  }

  private isUnsupportedTransport(error: unknown): boolean {
    const code = (error as { code?: number })?.code;
    return code === 404 || code === 405 || code === 501;
  }

  async getItemById(id: string): Promise<SitecoreItemMetadata | null> {
    return this.callForItem("get_content_item_by_id", { itemId: id, language: "en" });
  }

  async getItemByPath(path: string): Promise<SitecoreItemMetadata | null> {
    return this.callForItem("get_content_item_by_path", { path, language: "en" });
  }

  async getChildren(parentId: string): Promise<SitecoreItemMetadata[]> {
    await this.connect();
    const result = await this.client.callTool({ name: "get_content_children", arguments: { parentId, language: "en" } });
    const data = this.parseTextResult(result);
    return Array.isArray(data) ? data.map((item) => this.parseItem(item)) : [];
  }

  async getItemByName(name: string, parentId: string): Promise<SitecoreItemMetadata | null> {
    return (await this.getChildren(parentId)).find((child) => child.name === name) ?? null;
  }

  private async callForItem(name: string, args: Record<string, string>): Promise<SitecoreItemMetadata | null> {
    await this.connect();
    const result = await this.client.callTool({ name, arguments: args });
    const data = this.parseTextResult(result);
    return data ? this.parseItem(data) : null;
  }

  private parseTextResult(result: unknown): unknown {
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content?.find((item) => item.type === "text");
    return content?.text ? JSON.parse(content.text) as unknown : null;
  }

  private parseItem(data: unknown): SitecoreItemMetadata {
    const item = data as Record<string, unknown>;
    return {
      id: String(item.id ?? item.itemId ?? ""),
      name: String(item.name ?? ""),
      path: String(item.path ?? ""),
      parentId: String(item.parentId ?? ""),
      templateId: String(item.templateId ?? item.template ?? ""),
    };
  }
}
