import { McpBridge } from "./mcp-bridge.js";
import { McpToolRegistry } from "./mcp-tool-registry.js";
import { toOpenAiTools } from "./mcp-tool-adapter.js";
import type {
  McpClientLike,
  McpConnectionFactory,
  McpRawToolResult,
  McpServerConfig,
  McpToolDefinition,
} from "./types.js";

// ── Minimal assertion helpers (project uses no test framework) ───────────────

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

// ── A fake MCP client that records calls and returns scripted results ────────

interface FakeClientScript {
  tools: McpToolDefinition[];
  results?: Record<string, McpRawToolResult | (() => McpRawToolResult)>;
  throwOnCall?: Record<string, Error>;
}

class FakeMcpClient implements McpClientLike {
  public connected = false;
  public closed = false;
  public readonly callLog: Array<{ name: string; args?: Record<string, unknown> }> = [];

  constructor(private readonly script: FakeClientScript) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async listTools(): Promise<{ tools: McpToolDefinition[] }> {
    return { tools: this.script.tools };
  }

  async callTool(request: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpRawToolResult> {
    this.callLog.push({ name: request.name, args: request.arguments });
    const toThrow = this.script.throwOnCall?.[request.name];
    if (toThrow) {
      throw toThrow;
    }
    const result = this.script.results?.[request.name];
    if (typeof result === "function") {
      return result();
    }
    return result ?? { content: [{ type: "text", text: "ok" }] };
  }
}

function buildBridge(
  scripts: Record<string, FakeClientScript>,
): {
  bridge: McpBridge;
  clients: Record<string, FakeMcpClient>;
  servers: McpServerConfig[];
} {
  const servers: McpServerConfig[] = Object.keys(scripts).map((id) => ({
    id,
    label: id,
  }));
  const clients: Record<string, FakeMcpClient> = {};
  const factory: McpConnectionFactory = async (server) => {
    const client = new FakeMcpClient(scripts[server.id]!);
    clients[server.id] = client;
    return client;
  };
  const bridge = new McpBridge(servers, factory);
  return { bridge, clients, servers };
}

// ── Test 1: tool discovery populates the registry ────────────────────────────

async function testToolDiscovery(): Promise<void> {
  const { bridge } = buildBridge({
    sitecore_xp: {
      tools: [
        { name: "get_item", description: "Get an item", inputSchema: { type: "object" } },
        { name: "search", description: "Search", inputSchema: { type: "object" } },
      ],
    },
  });

  const { discoveries, failures } = await bridge.connectAndDiscover();

  assertEqual(failures.length, 0, "No failures expected");
  assertEqual(discoveries.length, 1, "One server discovered");
  assertEqual(discoveries[0]!.toolCount, 2, "Two tools discovered");
  assertEqual(bridge.listRegisteredTools().length, 2, "Registry holds two tools");
}

// ── Test 2: MCP tool → OpenAI tool conversion preserves schema ───────────────

async function testToolConversion(): Promise<void> {
  const schema = {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  };
  const { bridge } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "get_item", description: "Get an item", inputSchema: schema }],
    },
  });
  await bridge.connectAndDiscover();

  const openAiTools = toOpenAiTools(bridge.listRegisteredTools());
  assertEqual(openAiTools.length, 1, "One OpenAI tool");
  const fn = openAiTools[0]!.function;
  assertEqual(fn.name, "sitecore_xp__get_item", "Prefixed name");
  assertEqual(fn.description, "Get an item", "Description preserved");
  assertEqual(
    JSON.stringify(fn.parameters),
    JSON.stringify(schema),
    "Input schema preserved verbatim",
  );
}

// ── Test 3: tool name collisions across servers are prevented ────────────────

async function testCollisionHandling(): Promise<void> {
  const { bridge } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "get_item", description: "XP", inputSchema: { type: "object" } }],
    },
    sitecore_ai: {
      tools: [{ name: "get_item", description: "AI", inputSchema: { type: "object" } }],
    },
  });
  await bridge.connectAndDiscover();

  const names = bridge.listRegisteredTools().map((t) => t.llmToolName).sort();
  assertEqual(names.length, 2, "Two distinct tools");
  assertEqual(names[0], "sitecore_ai__get_item", "AI tool prefixed");
  assertEqual(names[1], "sitecore_xp__get_item", "XP tool prefixed");
}

// ── Test 4: LLM tool call resolves to the correct server + MCP tool ──────────

async function testToolResolutionAndExecution(): Promise<void> {
  const { bridge, clients } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "get_item", description: "XP", inputSchema: { type: "object" } }],
      results: {
        get_item: { content: [{ type: "text", text: '{"id":"42"}' }] },
      },
    },
    sitecore_ai: {
      tools: [{ name: "get_item", description: "AI", inputSchema: { type: "object" } }],
      results: {
        get_item: { content: [{ type: "text", text: '{"id":"99"}' }] },
      },
    },
  });
  await bridge.connectAndDiscover();

  const result = await bridge.executeTool("sitecore_xp__get_item", { path: "/a" });
  assert(result.success, "Call should succeed");
  assertEqual(result.tool, "get_item", "Original MCP tool name");
  assertEqual(result.content?.[0]?.text, '{"id":"42"}', "XP result returned");

  // Only the XP client should have been called.
  assertEqual(clients.sitecore_xp!.callLog.length, 1, "XP called once");
  assertEqual(clients.sitecore_ai!.callLog.length, 0, "AI not called");
  assertEqual(
    JSON.stringify(clients.sitecore_xp!.callLog[0]!.args),
    JSON.stringify({ path: "/a" }),
    "Arguments forwarded",
  );
}

// ── Test 5: unknown tools are rejected (allowlist enforcement) ───────────────

async function testUnknownToolRejection(): Promise<void> {
  const { bridge, clients } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "get_item", description: "XP", inputSchema: { type: "object" } }],
    },
  });
  await bridge.connectAndDiscover();

  const result = await bridge.executeTool("sitecore_xp__delete_everything", {});
  assert(!result.success, "Unknown tool must fail");
  assert(
    result.error?.includes("Unknown tool"),
    "Error should mention unknown tool",
  );
  assertEqual(clients.sitecore_xp!.callLog.length, 0, "No MCP call for unknown tool");
}

// ── Test 6: malformed arguments are rejected before calling the server ───────

async function testMalformedArgumentRejection(): Promise<void> {
  const { bridge, clients } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "get_item", description: "XP", inputSchema: { type: "object" } }],
    },
  });
  await bridge.connectAndDiscover();

  // A JSON array is not a valid argument object.
  const result = await bridge.executeTool("sitecore_xp__get_item", "[1,2,3]");
  assert(!result.success, "Malformed args must fail");
  assert(result.error?.includes("malformed"), "Error should mention malformed args");
  assertEqual(clients.sitecore_xp!.callLog.length, 0, "No MCP call for bad args");
}

// ── Test 7: MCP result normalization (text + error) ──────────────────────────

async function testResultNormalization(): Promise<void> {
  const { bridge } = buildBridge({
    sitecore_xp: {
      tools: [
        { name: "ok_tool", description: "", inputSchema: { type: "object" } },
        { name: "err_tool", description: "", inputSchema: { type: "object" } },
      ],
      results: {
        ok_tool: {
          content: [
            { type: "text", text: "hello" },
            { type: "image", data: "base64..." },
          ],
        },
        err_tool: {
          isError: true,
          content: [{ type: "text", text: "boom" }],
        },
      },
    },
  });
  await bridge.connectAndDiscover();

  const ok = await bridge.executeTool("sitecore_xp__ok_tool", {});
  assert(ok.success, "ok_tool succeeds");
  assertEqual(ok.content?.length, 2, "Two content items");
  assertEqual(ok.content?.[0]?.text, "hello", "Text content preserved");
  assertEqual(ok.content?.[1]?.type, "image", "Non-text type preserved");

  const err = await bridge.executeTool("sitecore_xp__err_tool", {});
  assert(!err.success, "err_tool fails");
  assertEqual(err.error, "boom", "Error text surfaced from content");
}

// ── Test 8: MCP execution exceptions become structured failures ──────────────

async function testExecutionExceptionBecomesFailure(): Promise<void> {
  const { bridge } = buildBridge({
    sitecore_xp: {
      tools: [{ name: "boom", description: "", inputSchema: { type: "object" } }],
      throwOnCall: { boom: new Error("connection reset") },
    },
  });
  await bridge.connectAndDiscover();

  const result = await bridge.executeTool("sitecore_xp__boom", {});
  assert(!result.success, "Thrown error becomes failure result");
  assertEqual(result.error, "connection reset", "Error message preserved");
}

// ── Test 9: a failing server does not abort discovery of others ──────────────

async function testPartialDiscoveryFailure(): Promise<void> {
  const servers: McpServerConfig[] = [
    { id: "bad", label: "bad" },
    { id: "good", label: "good" },
  ];
  const factory: McpConnectionFactory = async (server) => {
    if (server.id === "bad") {
      throw new Error("spawn failed");
    }
    return new FakeMcpClient({
      tools: [{ name: "t", description: "", inputSchema: { type: "object" } }],
    });
  };
  const bridge = new McpBridge(servers, factory);

  const { discoveries, failures } = await bridge.connectAndDiscover();
  assertEqual(failures.length, 1, "One failure recorded");
  assertEqual(failures[0]!.serverLabel, "bad", "Bad server reported");
  assertEqual(discoveries.length, 1, "Good server still discovered");
  assertEqual(bridge.listRegisteredTools().length, 1, "Good server's tool registered");
}

// ── Test 10: registry name builder sanitizes unsafe characters ───────────────

async function testRegistryNameSanitization(): Promise<void> {
  const name = McpToolRegistry.buildLlmToolName("Sitecore XP!", "get item/now");
  assertEqual(name, "Sitecore_XP___get_item_now", "Unsafe chars replaced with _");
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testToolDiscovery();
  await testToolConversion();
  await testCollisionHandling();
  await testToolResolutionAndExecution();
  await testUnknownToolRejection();
  await testMalformedArgumentRejection();
  await testResultNormalization();
  await testExecutionExceptionBecomesFailure();
  await testPartialDiscoveryFailure();
  await testRegistryNameSanitization();
  console.log("MCP bridge tests passed (10/10).");
}

main().catch((error: unknown) => {
  console.error("MCP bridge tests failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
