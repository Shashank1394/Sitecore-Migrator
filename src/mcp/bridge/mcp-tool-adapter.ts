import type { JsonSchema, RegisteredTool } from "./types.js";

/**
 * An OpenAI-compatible tool/function definition, as accepted by the OpenRouter
 * chat completions endpoint.
 */
export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/**
 * Converts a registered MCP tool into an OpenAI-compatible tool definition.
 * The MCP input schema is preserved as-is (it is already JSON Schema); we only
 * ensure a well-formed object schema when a server omits one.
 */
export function toOpenAiTool(tool: RegisteredTool): OpenAiToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.llmToolName,
      description: tool.description || `Tool ${tool.mcpToolName} on ${tool.serverLabel}.`,
      parameters: normalizeParameters(tool.inputSchema),
    },
  };
}

/** Converts a list of registered MCP tools into OpenAI tool definitions. */
export function toOpenAiTools(tools: RegisteredTool[]): OpenAiToolDefinition[] {
  return tools.map(toOpenAiTool);
}

/**
 * Ensures the schema is a valid JSON Schema object. The MCP schema is preserved
 * verbatim when it already looks like an object schema; otherwise a minimal
 * empty-object schema is substituted so the model receives something valid.
 */
function normalizeParameters(schema: JsonSchema | undefined): JsonSchema {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    // Preserve the server's schema. Guarantee a "type" so strict validators
    // on the model side accept it, without otherwise altering the schema.
    if (!("type" in schema)) {
      return { type: "object", ...schema };
    }
    return schema;
  }
  return { type: "object", properties: {} };
}
