import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const migrationConfigSchema = z.object({
  source: z.object({
    directory: z.string().min(1),
  }),

  output: z.object({
    directory: z.string().min(1),
  }),

  reports: z.object({
    directory: z.string().min(1),
  }),

  scope: z.object({
    path: z.string().min(1),
    recursive: z.boolean(),
  }),

  mcp: z.object({
    xp: z.object({
      enabled: z.boolean(),
    }),
    sitecoreAI: z.object({
      enabled: z.boolean(),
    }),
  }),

  validation: z.object({
    preserveItemIds: z.boolean(),
    failOnMissingMapping: z.boolean(),
    failOnAmbiguousMapping: z.boolean(),
    validateYaml: z.boolean(),
  }),
});

export type MigrationConfig = z.infer<typeof migrationConfigSchema>;

export async function loadMigrationConfig(
  configPath = "./migration.config.json",
): Promise<MigrationConfig> {
  const absolutePath = resolve(configPath);

  try {
    const content = await readFile(absolutePath, "utf-8");
    const rawConfig: unknown = JSON.parse(content);

    return migrationConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in migration configuration: ${absolutePath}`,
        { cause: error },
      );
    }

    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid migration configuration: ${absolutePath}\n${error.message}`,
        { cause: error },
      );
    }

    throw new Error(`Failed to load migration configuration: ${absolutePath}`, {
      cause: error,
    });
  }
}
