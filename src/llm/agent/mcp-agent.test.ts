import { McpAgent, type ToolCallingLlm } from "./mcp-agent.js";
import { McpBridge } from "../../mcp/bridge/mcp-bridge.js";
import type { OpenAiToolDefinition } from "../../mcp/bridge/mcp-tool-adapter.js";
import type {
  ToolCall,
  ToolChatMessage,
  ToolChatResponse,
} from "./openrouter-tool-client.js";
import type {
  McpClientLike,
  McpConnectionFactory,
  McpRawToolResult,
  McpServerConfig,
  McpToolDefinition,
} from "../../mcp/bridge/types.js";

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

// ── Fake MCP client + bridge builder (mirrors bridge tests) ──────────────────

class FakeMcpClient implements McpClientLike {
  constructor(
    private readonly tools: McpToolDefinition[],
    private readonly results: Record<string, McpRawToolResult>,
  ) {}
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async listTools(): Promise<{ tools: McpToolDefinition[] }> {
    return { tools: this.tools };
  }
  async callTool(request: { name: string }): Promise<McpRawToolResult> {
    return this.results[request.name] ?? { content: [{ type: "text", text: "ok" }] };
  }
}

async function buildBridge(
  tools: McpToolDefinition[],
  results: Record<string, McpRawToolResult>,
): Promise<McpBridge> {
  const servers: McpServerConfig[] = [{ id: "sitecore_xp", label: "Sitecore XP" }];
  const factory: McpConnectionFactory = async () => new FakeMcpClient(tools, results);
  const bridge = new McpBridge(servers, factory);
  await bridge.connectAndDiscover();
  return bridge;
}

// ── Scripted LLM: returns a queued response per send() call ───────────────────

class ScriptedLlm implements ToolCallingLlm {
  readonly modelName = "scripted/model";
  public sendCount = 0;
  public lastMessages: ToolChatMessage[] = [];

  constructor(private readonly queue: ToolChatResponse[]) {}

  async send(messages: ToolChatMessage[]): Promise<ToolChatResponse> {
    this.sendCount += 1;
    this.lastMessages = messages;
    const next = this.queue.shift();
    if (!next) {
      throw new Error("ScriptedLlm ran out of responses.");
    }
    return next;
  }
}

function toolCall(id: string, name: string, args: unknown): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
}

function finalResponse(content: string): ToolChatResponse {
  return { content, toolCalls: [], model: "scripted/model", finishReason: "stop" };
}

function toolResponse(calls: ToolCall[]): ToolChatResponse {
  return { content: "", toolCalls: calls, model: "scripted/model", finishReason: "tool_calls" };
}

// ── Test 1: zero tool calls → immediate final answer ─────────────────────────

async function testNoToolCalls(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "", inputSchema: { type: "object" } }],
    {},
  );
  const llm = new ScriptedLlm([finalResponse("Hello, no tools needed.")]);
  const agent = new McpAgent(llm, bridge);

  const result = await agent.run({ system: "sys", prompt: "hi" });
  assertEqual(result.finalContent, "Hello, no tools needed.", "Final content");
  assertEqual(result.iterations, 1, "One iteration");
  assertEqual(result.toolInvocations.length, 0, "No tool invocations");
}

// ── Test 2: single tool call then final answer ───────────────────────────────

async function testSingleToolCall(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "", inputSchema: { type: "object" } }],
    { get_item: { content: [{ type: "text", text: '{"id":"42"}' }] } },
  );
  const llm = new ScriptedLlm([
    toolResponse([toolCall("c1", "sitecore_xp__get_item", { path: "/a" })]),
    finalResponse("The item id is 42."),
  ]);
  const agent = new McpAgent(llm, bridge);

  const result = await agent.run({ system: "sys", prompt: "find /a" });
  assertEqual(result.iterations, 2, "Two iterations");
  assertEqual(result.toolInvocations.length, 1, "One tool invocation");
  assert(result.toolInvocations[0]!.success, "Tool call succeeded");
  assertEqual(result.finalContent, "The item id is 42.", "Final answer");

  // The tool result must have been fed back as a tool-role message.
  const toolMessages = llm.lastMessages.filter((m) => m.role === "tool");
  assertEqual(toolMessages.length, 1, "One tool-role message in history");
  assert(
    toolMessages[0]!.content!.includes('"success":true'),
    "Tool result serialized to the LLM",
  );
}

// ── Test 3: multiple sequential tool calls (model decides) ───────────────────

async function testMultiStepToolCalls(): Promise<void> {
  const bridge = await buildBridge(
    [
      { name: "get_item", description: "", inputSchema: { type: "object" } },
      { name: "get_children", description: "", inputSchema: { type: "object" } },
    ],
    {
      get_item: { content: [{ type: "text", text: '{"id":"42"}' }] },
      get_children: { content: [{ type: "text", text: '[{"id":"43"}]' }] },
    },
  );
  const llm = new ScriptedLlm([
    toolResponse([toolCall("c1", "sitecore_xp__get_item", { path: "/a" })]),
    toolResponse([toolCall("c2", "sitecore_xp__get_children", { id: "42" })]),
    finalResponse("Done after two tools."),
  ]);
  const agent = new McpAgent(llm, bridge);

  const result = await agent.run({ system: "sys", prompt: "investigate" });
  assertEqual(result.iterations, 3, "Three iterations");
  assertEqual(result.toolInvocations.length, 2, "Two tool invocations");
  assertEqual(result.finalContent, "Done after two tools.", "Final answer");
}

// ── Test 4: maximum iteration protection ─────────────────────────────────────

async function testMaxIterations(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "loop", description: "", inputSchema: { type: "object" } }],
    { loop: { content: [{ type: "text", text: "again" }] } },
  );
  // Always ask for a tool, never finalize.
  const neverEnding: ToolChatResponse[] = Array.from({ length: 20 }, () =>
    toolResponse([toolCall("c", "sitecore_xp__loop", {})]),
  );
  const llm = new ScriptedLlm(neverEnding);
  const agent = new McpAgent(llm, bridge);

  let threw = false;
  try {
    await agent.run({ system: "sys", prompt: "go", maxIterations: 3 });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message.includes("maximum of 3"),
      "Error mentions the configured maximum",
    );
  }
  assert(threw, "Agent must throw when exceeding max iterations");
  assertEqual(llm.sendCount, 3, "Exactly maxIterations LLM calls");
}

// ── Test 5: MCP error is returned to the LLM (not thrown) ────────────────────

async function testMcpErrorReachesLlm(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "", inputSchema: { type: "object" } }],
    { get_item: { isError: true, content: [{ type: "text", text: "not found" }] } },
  );
  const llm = new ScriptedLlm([
    toolResponse([toolCall("c1", "sitecore_xp__get_item", { path: "/missing" })]),
    finalResponse("The tool reported: not found."),
  ]);
  const agent = new McpAgent(llm, bridge);

  const result = await agent.run({ system: "sys", prompt: "find /missing" });
  assertEqual(result.toolInvocations.length, 1, "One invocation");
  assert(!result.toolInvocations[0]!.success, "Invocation marked failed");

  const toolMessages = llm.lastMessages.filter((m) => m.role === "tool");
  assert(
    toolMessages[0]!.content!.includes('"success":false'),
    "Failure surfaced to the LLM as a tool result",
  );
  assert(
    toolMessages[0]!.content!.includes("not found"),
    "Error text relayed to the LLM",
  );
}

// ── Test 6: unknown tool requested by the LLM → structured error to LLM ───────

async function testUnknownToolRequestedByLlm(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "", inputSchema: { type: "object" } }],
    {},
  );
  const llm = new ScriptedLlm([
    toolResponse([toolCall("c1", "sitecore_xp__nonexistent", {})]),
    finalResponse("Recovered after unknown tool."),
  ]);
  const agent = new McpAgent(llm, bridge);

  const result = await agent.run({ system: "sys", prompt: "do it" });
  assert(!result.toolInvocations[0]!.success, "Unknown tool invocation failed");
  const toolMessages = llm.lastMessages.filter((m) => m.role === "tool");
  assert(
    toolMessages[0]!.content!.includes("Unknown tool"),
    "Unknown-tool error returned to LLM",
  );
  assertEqual(result.finalContent, "Recovered after unknown tool.", "Agent recovered");
}

// ── Test 7: cancellation via abort signal ────────────────────────────────────

async function testCancellation(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "", inputSchema: { type: "object" } }],
    {},
  );
  const llm = new ScriptedLlm([finalResponse("should not get here")]);
  const agent = new McpAgent(llm, bridge);

  const controller = new AbortController();
  controller.abort();

  let threw = false;
  try {
    await agent.run({ system: "sys", prompt: "go", signal: controller.signal });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message.includes("cancelled"),
      "Cancellation error surfaced",
    );
  }
  assert(threw, "Aborted run must throw");
  assertEqual(llm.sendCount, 0, "No LLM call after pre-abort");
}

// ── Test 8: discovered tools are presented to the LLM as OpenAI tools ─────────

async function testToolsPresentedToLlm(): Promise<void> {
  const bridge = await buildBridge(
    [{ name: "get_item", description: "Get it", inputSchema: { type: "object" } }],
    {},
  );
  let seenTools: OpenAiToolDefinition[] = [];
  const llm: ToolCallingLlm = {
    modelName: "scripted/model",
    async send(_messages, tools) {
      seenTools = tools;
      return finalResponse("ok");
    },
  };
  const agent = new McpAgent(llm, bridge);
  await agent.run({ system: "sys", prompt: "go" });

  assertEqual(seenTools.length, 1, "One tool presented");
  assertEqual(seenTools[0]!.function.name, "sitecore_xp__get_item", "Prefixed name presented");
}

async function main(): Promise<void> {
  await testNoToolCalls();
  await testSingleToolCall();
  await testMultiStepToolCalls();
  await testMaxIterations();
  await testMcpErrorReachesLlm();
  await testUnknownToolRequestedByLlm();
  await testCancellation();
  await testToolsPresentedToLlm();
  console.log("MCP agent tests passed (8/8).");
}

main().catch((error: unknown) => {
  console.error("MCP agent tests failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
