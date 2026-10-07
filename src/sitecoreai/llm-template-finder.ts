/**
 * LLM-driven template GUID finder.
 *
 * The LLM is given two tools backed by the SitecoreAI Authoring API:
 *   • search_by_name(name)    – search items by exact name
 *   • get_item_by_id(itemId)  – look up an item by GUID
 *
 * It is asked to:
 *   1. Look up each GUID from the source YAML files until it finds "Controller Rendering"
 *   2. Search for "Json Rendering" by name
 *   3. Return both GUIDs
 *
 * This keeps all decision logic in the LLM while the API calls stay deterministic.
 */

import type { SitecoreAiAgentApi } from "./agent-api.js";
import type { ProgressCallback } from "../migration/rendering-migration.js";
import type { TemplateMap } from "../migration/rendering-migration.js";

// ── OpenRouter tool-calling types ─────────────────────────────────────────────

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

// ── Tool definitions exposed to the LLM ──────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_by_name",
      description:
        "Search for Sitecore items in the SitecoreAI instance by their exact item name. " +
        "Returns a list of matches with itemId, name, and path.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            description: "The exact item name to search for, e.g. 'Json Rendering'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_by_id",
      description:
        "Get a Sitecore item from the SitecoreAI instance by its GUID. " +
        "Returns itemId, name, and path, or null if not found.",
      parameters: {
        type: "object",
        required: ["itemId"],
        properties: {
          itemId: {
            type: "string",
            description: "The item GUID, e.g. '2a3e91a0-7987-44b5-ab34-35c2d9de83b9'",
          },
        },
      },
    },
  },
];

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callOpenRouter(
  messages: Message[],
  tools: ToolDefinition[],
): Promise<ChatResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model  = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set in .env");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter API error (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<ChatResponse>;
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  argsJson: string,
  api: SitecoreAiAgentApi,
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" });
  }

  try {
    if (name === "search_by_name") {
      const results = await api.searchByName(String(args.name ?? ""));
      return JSON.stringify(results.length > 0 ? results : { message: "No items found" });
    }

    if (name === "get_item_by_id") {
      const item = await api.getItemById(String(args.itemId ?? ""));
      return JSON.stringify(item ?? { message: "Item not found" });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Uses an LLM to identify Controller Rendering and Json Rendering GUIDs
 * via the SitecoreAI Authoring API tools.
 */
export async function findTemplatesWithLlm(
  api: SitecoreAiAgentApi,
  candidateGuids: string[],
  onProgress: ProgressCallback,
): Promise<TemplateMap> {

  const guidList = candidateGuids
    .map((g, i) => `${i + 1}. ${g.replace(/[{}]/g, "").toLowerCase()}`)
    .join("\n");

  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You are a Sitecore migration assistant.",
        "You have two tools to query a live SitecoreAI instance:",
        "  • search_by_name(name) — search by exact item name",
        "  • get_item_by_id(itemId) — look up an item by GUID",
        "Use the tools to find template GUIDs. Never invent or guess GUIDs.",
        "Return your final answer as a JSON object only, with no surrounding text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `
You need to find two Sitecore template GUIDs.

## Task 1 — Find Controller Rendering
The following GUIDs were found in Sitecore XP YAML files under /sitecore/layout/Renderings.
Use get_item_by_id() to look up each one until you find the item named "Controller Rendering".

GUIDs to check:
${guidList}

## Task 2 — Find Json Rendering
Use search_by_name("Json Rendering") to find the Json Rendering template in SitecoreAI.

## Output
When you have both GUIDs, respond with ONLY this JSON:

{
  "controllerRenderingId": "<guid from Task 1>",
  "controllerRenderingName": "Controller Rendering",
  "jsonRenderingId": "<guid from Task 2>",
  "jsonRenderingName": "Json Rendering"
}
`.trim(),
    },
  ];

  onProgress({
    status: "investigating",
    message: "LLM is identifying templates via SitecoreAI API...",
    completedCases: 0,
    totalCases: 1,
    investigationStep: "LLM → SitecoreAI Authoring API",
  });

  const MAX_ITERATIONS = 20;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callOpenRouter(messages, TOOLS);
    const choice = response.choices[0];

    if (!choice) throw new Error("OpenRouter returned no choices");

    const assistantMsg = choice.message;

    // Push assistant turn into history
    messages.push({
      role: "assistant",
      content: assistantMsg.content ?? null,
      tool_calls: assistantMsg.tool_calls,
    });

    // No tool calls → final answer
    if (!assistantMsg.tool_calls?.length) {
      const content = assistantMsg.content ?? "";
      console.log("[llm-template-finder] Final response:", content);
      return parseTemplateMap(content);
    }

    // Execute each tool call and push results
    for (const call of assistantMsg.tool_calls) {
      onProgress({
        status: "investigating",
        message: `Calling ${call.function.name}(${call.function.arguments.slice(0, 60)})`,
        completedCases: 0,
        totalCases: 1,
        investigationStep: call.function.name,
      });

      const result = await executeTool(call.function.name, call.function.arguments, api);
      console.log(`[llm-template-finder] ${call.function.name} →`, result.slice(0, 200));

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  throw new Error(
    `LLM did not resolve template GUIDs within ${MAX_ITERATIONS} iterations.`,
  );
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parseTemplateMap(content: string): TemplateMap {
  // Extract the JSON object even if surrounded by text
  const match = content.match(/\{[^{}]*"controllerRenderingId"[^{}]*\}/s);
  if (!match) {
    throw new Error(
      `LLM did not return a valid template map JSON.\nResponse was:\n${content.slice(0, 600)}`,
    );
  }

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM returned malformed JSON:\n${match[0].slice(0, 300)}`);
  }

  for (const key of ["controllerRenderingId", "jsonRenderingId", "controllerRenderingName", "jsonRenderingName"] as const) {
    if (typeof obj[key] !== "string" || !obj[key]) {
      throw new Error(
        `LLM template map missing or empty field: "${key}".\nFull response:\n${content.slice(0, 600)}`,
      );
    }
  }

  const normalise = (g: string) => `{${g.replace(/[{}]/g, "").toUpperCase()}}`;

  return {
    controllerRenderingId:   normalise(String(obj.controllerRenderingId)),
    controllerRenderingName: String(obj.controllerRenderingName),
    jsonRenderingId:         normalise(String(obj.jsonRenderingId)),
    jsonRenderingName:       String(obj.jsonRenderingName),
  };
}
