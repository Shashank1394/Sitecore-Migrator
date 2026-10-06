import { OpenRouterToolClient } from "./openrouter-tool-client.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

const SECRET = "sk-or-TEST-SECRET-KEY-DO-NOT-LEAK";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function withMockedFetch(
  handler: (...args: FetchArgs) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Test 1: missing API key throws a clear, secret-free error ────────────────

async function testMissingApiKey(): Promise<void> {
  let threw = false;
  try {
    new OpenRouterToolClient({ apiKey: "" });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message === "OpenRouter API key is not configured.",
      "Clear missing-key error",
    );
  }
  assert(threw, "Must throw on missing key");
}

// ── Test 2: API key is sent as a Bearer header, not elsewhere ────────────────

async function testApiKeyUsedAsBearer(): Promise<void> {
  const client = new OpenRouterToolClient({ apiKey: SECRET, model: "openrouter/free" });
  let capturedAuth: string | null = null;

  await withMockedFetch(
    async (_input, init) => {
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("Authorization");
      return jsonResponse({
        model: "openrouter/free",
        choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      });
    },
    async () => {
      const response = await client.send(
        [{ role: "user", content: "hello" }],
        [],
      );
      assertEqual(response.content, "hi", "Content returned");
    },
  );

  assertEqual(capturedAuth, `Bearer ${SECRET}`, "Key sent as Bearer header");
}

// ── Test 3: HTTP errors are mapped and never contain the key ─────────────────

async function testHttpErrorsAreSecretFree(): Promise<void> {
  const client = new OpenRouterToolClient({ apiKey: SECRET });

  for (const [status, expected] of [
    [401, "OpenRouter request failed with HTTP 401."],
    [429, "OpenRouter request was rate limited (HTTP 429)."],
    [500, "OpenRouter request failed with HTTP 500."],
  ] as const) {
    await withMockedFetch(
      async () => new Response("error body", { status }),
      async () => {
        let message = "";
        try {
          await client.send([{ role: "user", content: "x" }], []);
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        assertEqual(message, expected, `HTTP ${status} mapped`);
        assert(!message.includes(SECRET), `HTTP ${status} error has no secret`);
      },
    );
  }
}

// ── Test 4: network failure error is secret-free ─────────────────────────────

async function testNetworkFailureIsSecretFree(): Promise<void> {
  const client = new OpenRouterToolClient({ apiKey: SECRET });
  await withMockedFetch(
    async () => {
      throw new Error(`connect ECONNREFUSED with key ${SECRET}`);
    },
    async () => {
      let message = "";
      try {
        await client.send([{ role: "user", content: "x" }], []);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assertEqual(message, "OpenRouter network request failed.", "Generic network error");
      assert(!message.includes(SECRET), "Network error has no secret");
    },
  );
}

// ── Test 5: tool_calls are parsed from the response ──────────────────────────

async function testToolCallsParsed(): Promise<void> {
  const client = new OpenRouterToolClient({ apiKey: SECRET });
  await withMockedFetch(
    async () =>
      jsonResponse({
        model: "openrouter/free",
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "sitecore_xp__get_item", arguments: '{"path":"/a"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    async () => {
      const response = await client.send([{ role: "user", content: "x" }], []);
      assertEqual(response.toolCalls.length, 1, "One tool call parsed");
      assertEqual(
        response.toolCalls[0]!.function.name,
        "sitecore_xp__get_item",
        "Tool name parsed",
      );
      assertEqual(response.finishReason, "tool_calls", "Finish reason parsed");
    },
  );
}

// ── Test 6: empty response is rejected ───────────────────────────────────────

async function testEmptyResponseRejected(): Promise<void> {
  const client = new OpenRouterToolClient({ apiKey: SECRET });
  await withMockedFetch(
    async () =>
      jsonResponse({
        model: "openrouter/free",
        choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      }),
    async () => {
      let message = "";
      try {
        await client.send([{ role: "user", content: "x" }], []);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assertEqual(message, "OpenRouter returned an empty response.", "Empty response rejected");
    },
  );
}

async function main(): Promise<void> {
  await testMissingApiKey();
  await testApiKeyUsedAsBearer();
  await testHttpErrorsAreSecretFree();
  await testNetworkFailureIsSecretFree();
  await testToolCallsParsed();
  await testEmptyResponseRejected();
  console.log("OpenRouter tool client tests passed (6/6).");
}

main().catch((error: unknown) => {
  console.error("OpenRouter tool client tests failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
