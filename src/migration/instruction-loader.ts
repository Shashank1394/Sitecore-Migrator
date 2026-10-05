import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { MigrationInstructions, MigrationCase } from "./instruction-types.js";

// ── Minimal runtime validation (no Zod dependency for this path) ──────────────

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Migration instructions: "${label}" must be a non-empty string`);
  }
  return value;
}

function assertArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Migration instructions: "${label}" must be an array`);
  }
  return value as T[];
}

function validateCase(raw: Record<string, unknown>, index: number): MigrationCase {
  const prefix = `cases[${index}]`;

  const id = assertString(raw["id"], `${prefix}.id`);
  const name = assertString(raw["name"], `${prefix}.name`);
  const description = assertString(raw["description"], `${prefix}.description`);

  const scopeRaw = raw["scope"] as Record<string, unknown> | undefined;
  if (!scopeRaw) throw new Error(`Migration instructions: "${prefix}.scope" is required`);

  const scope = {
    sitecorePath: assertString(scopeRaw["sitecorePath"], `${prefix}.scope.sitecorePath`),
    recursive: scopeRaw["recursive"] !== false,
  };

  const investigateRaw = (raw["investigate"] ?? {}) as Record<string, unknown>;
  const investigate = {
    xp: Array.isArray(investigateRaw["xp"]) ? investigateRaw["xp"] : [],
    sitecoreAI: Array.isArray(investigateRaw["sitecoreAI"]) ? investigateRaw["sitecoreAI"] : [],
  };

  const transform = assertArray(raw["transform"] ?? [], `${prefix}.transform`);
  const preserve = assertArray(raw["preserve"] ?? [], `${prefix}.preserve`);
  const validate = assertArray(raw["validate"] ?? [], `${prefix}.validate`);

  return { id, name, description, scope, investigate, transform, preserve, validate } as MigrationCase;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadMigrationInstructions(
  instructionsPath = "./migration-instructions.yaml",
): Promise<MigrationInstructions> {
  const absolutePath = resolve(instructionsPath);

  let content: string;
  try {
    content = await readFile(absolutePath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read migration instructions: ${absolutePath}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(`Failed to parse migration instructions YAML: ${absolutePath}`, { cause: err });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Migration instructions must be a YAML object: ${absolutePath}`);
  }

  const raw = parsed as Record<string, unknown>;
  const version = assertString(raw["version"], "version");
  const casesRaw = assertArray<Record<string, unknown>>(raw["cases"], "cases");
  const cases = casesRaw.map((c, i) => validateCase(c, i));

  return { version, cases };
}
