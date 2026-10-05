import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function scanYamlFiles(
  directory: string,
  recursive = true,
): Promise<string[]> {
  console.log("🔍 scanYamlFiles called with directory:", directory);
  const yamlFiles: string[] = [];

  async function scan(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);

      if (entry.isDirectory() && recursive) {
        await scan(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
      ) {
        yamlFiles.push(fullPath);
      }
    }
  }

  await scan(directory);
  
  console.log("🔍 scanYamlFiles found", yamlFiles.length, "YAML files in", directory);

  return yamlFiles;
}
