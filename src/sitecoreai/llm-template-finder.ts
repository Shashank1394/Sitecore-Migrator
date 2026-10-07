/**
 * Uses an LLM with SitecoreAI Agent API tools to discover:
 *
 *   Controller Rendering template ID
 *              ↓
 *        Json Rendering template ID
 *
 * The LLM never invents GUIDs.
 * Every GUID must come from an Agent API response.
 */

import type { SitecoreAiAgentApi } from "./agent-api.js";
import type { ProgressCallback } from "../migration/rendering-migration.js";
import type { TemplateMap } from "../migration/rendering-migration.js";

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
  function: {
    name: string;
    arguments: string;
  };
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

/* -------------------------------------------------------------------------- */
/* Tools exposed to the LLM                                                   */
/* -------------------------------------------------------------------------- */

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_item_by_id",
      description:
        "Look up a SitecoreAI item by its GUID. " +
        "Returns the real itemId, name and path. " +
        "Use this to identify what a source template GUID represents.",
      parameters: {
        type: "object",
        required: ["itemId"],
        properties: {
          itemId: {
            type: "string",
            description: "Sitecore item GUID.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_by_name",
      description:
        "Search SitecoreAI for items by exact item name. " +
        "Returns itemId, name and path for matching items.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            description: "Exact Sitecore item name.",
          },
        },
      },
    },
  },
];

/* -------------------------------------------------------------------------- */
/* OpenRouter                                                                  */
/* -------------------------------------------------------------------------- */

async function callOpenRouter(
  messages: Message[],
): Promise<ChatResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model =
    process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set in .env",
    );
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    throw new Error(
      `OpenRouter API error (${response.status}): ${text.slice(
        0,
        500,
      )}`,
    );
  }

  return (await response.json()) as ChatResponse;
}

/* -------------------------------------------------------------------------- */
/* Agent API tool execution                                                    */
/* -------------------------------------------------------------------------- */

async function executeTool(
  name: string,
  argsJson: string,
  api: SitecoreAiAgentApi,
): Promise<string> {
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return JSON.stringify({
      error: "Tool arguments were not valid JSON.",
    });
  }

  try {
    switch (name) {
      case "get_item_by_id": {
        const itemId = String(args.itemId ?? "").trim();

        if (!itemId) {
          return JSON.stringify({
            error: "itemId is required.",
          });
        }

        const item = await api.getItemById(itemId);

        if (!item) {
          return JSON.stringify({
            message: "Item not found.",
            itemId,
          });
        }

        return JSON.stringify(item);
      }

      case "search_by_name": {
        const name = String(args.name ?? "").trim();

        if (!name) {
          return JSON.stringify({
            error: "name is required.",
          });
        }

        const results = await api.searchByName(name);

        return JSON.stringify({
          results,
        });
      }

      default:
        return JSON.stringify({
          error: `Unknown tool: ${name}`,
        });
    }
  } catch (error) {
    return JSON.stringify({
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

export async function findTemplatesWithLlm(
  api: SitecoreAiAgentApi,
  candidateGuids: string[],
  onProgress: ProgressCallback,
): Promise<TemplateMap> {
  if (candidateGuids.length === 0) {
    throw new Error(
      "No template IDs were found in the selected rendering folder.",
    );
  }

  const normalizedGuids = [
    ...new Set(
      candidateGuids.map((guid) =>
        normalizeGuid(guid),
      ),
    ),
  ];

  const guidList = normalizedGuids
    .map((guid, index) => `${index + 1}. ${guid}`)
    .join("\n");

  const messages: Message[] = [
    {
      role: "system",
      content: `
You are assisting with a Sitecore XP → SitecoreAI rendering migration.

You have access to SitecoreAI through these tools:

1. get_item_by_id(itemId)
   - Looks up a SitecoreAI item by GUID.

2. search_by_name(name)
   - Searches SitecoreAI using the exact item name.

Rules:

- Never invent or guess a GUID.
- Every GUID you return must come directly from a tool response.
- You must inspect the candidate GUIDs using get_item_by_id().
- You are looking specifically for an item whose exact name is:
  "Controller Rendering"
- Once Controller Rendering is identified, search SitecoreAI for:
  "Json Rendering"
- Use the actual itemId returned by SitecoreAI.
- Do not use a GUID from the source YAML as the Json Rendering ID unless
  the Agent API explicitly returned that same GUID.
- Do not modify files.
- Do not perform the migration yourself.
- Your only task is to discover the two template IDs.

At the end, return ONLY valid JSON.
      `.trim(),
    },
    {
      role: "user",
      content: `
The following template GUIDs were extracted ONLY from the currently
selected EC-Renderings folder.

You must investigate these GUIDs:

${guidList}

Task 1:
Use get_item_by_id() on these GUIDs to determine which one represents
the exact Sitecore item named "Controller Rendering".

Stop checking once you have identified the correct Controller Rendering item.

Task 2:
Use search_by_name("Json Rendering") to find the exact Sitecore item
named "Json Rendering" in SitecoreAI.

Task 3:
Return the actual GUIDs returned by the tools.

Required JSON format:

{
  "controllerRenderingId": "<actual itemId returned by Agent API>",
  "controllerRenderingName": "Controller Rendering",
  "jsonRenderingId": "<actual itemId returned by Agent API>",
  "jsonRenderingName": "Json Rendering"
}
      `.trim(),
    },
  ];

  onProgress({
    status: "investigating",
    message:
      "LLM is checking rendering template IDs through SitecoreAI...",
    completedCases: 0,
    totalCases: 1,
    investigationStep:
      "LLM → SitecoreAI Agent API",
  });

  const MAX_ITERATIONS = 25;

  for (
    let iteration = 0;
    iteration < MAX_ITERATIONS;
    iteration++
  ) {
    const response =
      await callOpenRouter(messages);

    const choice = response.choices[0];

    if (!choice) {
      throw new Error(
        "OpenRouter returned no choices.",
      );
    }

    const assistantMessage = choice.message;

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    /*
     * The LLM has finished reasoning and is returning
     * the final template map.
     */
    if (!assistantMessage.tool_calls?.length) {
      const content =
        assistantMessage.content ?? "";

      onProgress({
        status: "planning",
        message:
          "Template mapping discovered successfully.",
        completedCases: 0,
        totalCases: 1,
        investigationStep:
          "Controller Rendering → Json Rendering",
      });

      return parseTemplateMap(content);
    }

    /*
     * Execute every tool call returned by the LLM.
     */
    for (const toolCall of assistantMessage.tool_calls) {
      onProgress({
        status: "investigating",
        message: `Calling ${toolCall.function.name}...`,
        completedCases: 0,
        totalCases: 1,
        investigationStep:
          toolCall.function.name,
      });

      const result = await executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
        api,
      );

      console.log(
        `[llm-template-finder] ${toolCall.function.name} →`,
        result.slice(0, 500),
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  throw new Error(
    `LLM could not resolve the rendering templates within ${MAX_ITERATIONS} iterations.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Result validation                                                           */
/* -------------------------------------------------------------------------- */

function parseTemplateMap(
  content: string,
): TemplateMap {
  const match = content.match(
    /\{[\s\S]*?"controllerRenderingId"[\s\S]*?\}/,
  );

  if (!match) {
    throw new Error(
      `LLM did not return a valid template map.\n\nResponse:\n${content.slice(
        0,
        1000,
      )}`,
    );
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(match[0]) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error(
      `LLM returned malformed JSON.\n\nResponse:\n${content.slice(
        0,
        1000,
      )}`,
    );
  }

  const requiredFields = [
    "controllerRenderingId",
    "controllerRenderingName",
    "jsonRenderingId",
    "jsonRenderingName",
  ] as const;

  for (const field of requiredFields) {
    if (
      typeof parsed[field] !== "string" ||
      !parsed[field]
    ) {
      throw new Error(
        `LLM response is missing "${field}".`,
      );
    }
  }

  if (
    parsed.controllerRenderingName !==
    "Controller Rendering"
  ) {
    throw new Error(
      `Unexpected Controller Rendering name: ${parsed.controllerRenderingName}`,
    );
  }

  if (
    parsed.jsonRenderingName !==
    "Json Rendering"
  ) {
    throw new Error(
      `Unexpected Json Rendering name: ${parsed.jsonRenderingName}`,
    );
  }

  const controllerRenderingId =
    normalizeGuid(
      String(parsed.controllerRenderingId),
    );

  const jsonRenderingId =
    normalizeGuid(
      String(parsed.jsonRenderingId),
    );

  return {
    controllerRenderingId,
    controllerRenderingName:
      "Controller Rendering",
    jsonRenderingId,
    jsonRenderingName: "Json Rendering",
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function normalizeGuid(
  value: string,
): string {
  const hex = value
    .replace(/[{}-]/g, "")
    .trim()
    .toUpperCase();

  if (!/^[0-9A-F]{32}$/.test(hex)) {
    throw new Error(
      `Invalid Sitecore GUID returned: ${value}`,
    );
  }

  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}
