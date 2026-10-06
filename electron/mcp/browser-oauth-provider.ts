import { createServer, type Server } from "node:http";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { shell } from "electron";

/**
 * Interactive OAuth provider for MCP servers that require a browser sign-in.
 *
 * It runs a one-shot loopback HTTP listener to capture the authorization code
 * and opens the system browser for the user to authenticate. Tokens and client
 * registration live only in memory in the trusted main process.
 *
 * This is the same pattern already used by the Marketer client, extracted here
 * so the generic MCP connection factory can reuse it for any OAuth server.
 */
export class BrowserOAuthProvider implements OAuthClientProvider {
  private clientInfo: OAuthClientInformationMixed | undefined;
  private tokenData: OAuthTokens | undefined;
  private verifier: string | undefined;
  private callbackServer: Server | undefined;
  private callbackUrl: string | undefined;
  private callbackPromise: Promise<string> | undefined;
  private resolveCallback: ((code: string) => void) | undefined;
  private rejectCallback: ((error: Error) => void) | undefined;
  private authorizationStarted = false;

  constructor(private readonly clientName = "Sitecore Migration Workbench") {}

  get redirectUrl(): string | undefined {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    if (!this.callbackUrl) {
      throw new Error("OAuth callback listener has not been started.");
    }
    return {
      client_name: this.clientName,
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async startCallbackListener(): Promise<void> {
    if (this.callbackPromise) {
      return;
    }
    this.callbackPromise = new Promise<string>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
    this.callbackServer = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", this.callbackUrl);
      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      response.writeHead(error || !code ? 400 : 200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(
        error || !code
          ? "<p>Sign-in did not complete. You may close this window.</p>"
          : "<p>Sign-in is complete. You may close this window.</p>",
      );
      this.completeCallback(
        error
          ? new Error(error)
          : !code
            ? new Error("The authorization server did not return a code.")
            : undefined,
        code ?? undefined,
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.callbackServer!.once("error", reject);
      this.callbackServer!.listen(0, "127.0.0.1", () => {
        const address = this.callbackServer!.address();
        if (!address || typeof address === "string") {
          return reject(new Error("Could not determine the OAuth callback address."));
        }
        this.callbackUrl = `http://127.0.0.1:${address.port}/oauth/callback`;
        this.callbackServer!.off("error", reject);
        resolve();
      });
    });
  }

  async waitForAuthorizationCode(): Promise<string> {
    if (!this.callbackPromise) {
      throw new Error("OAuth callback listener has not been started.");
    }
    return this.callbackPromise;
  }

  isAuthorizationPending(): boolean {
    return this.authorizationStarted;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.clientInfo = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenData;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenData = tokens;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.authorizationStarted = true;
    await shell.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error("OAuth code verifier is unavailable.");
    }
    return this.verifier;
  }

  private completeCallback(error?: Error, code?: string): void {
    const server = this.callbackServer;
    this.callbackServer = undefined;
    server?.close();
    if (error) {
      this.rejectCallback?.(error);
    } else if (code) {
      this.resolveCallback?.(code);
    }
  }
}
