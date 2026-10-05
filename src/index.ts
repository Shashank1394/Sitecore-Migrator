import { loadMigrationConfig } from "./config/migration-config.js";
import { loadYamlItems } from "./yaml/yaml-loader.js";

const APP_NAME = "Sitecore XP → SitecoreAI Migration Tool";
const VERSION = "0.1.0";

async function main(): Promise<void> {
  console.log(APP_NAME);
  console.log(`Version: ${VERSION}`);
  console.log("");

  const config = await loadMigrationConfig();

  console.log("Migration configuration loaded.");
  console.log(`Source: ${config.source.directory}`);
  console.log(`Output: ${config.output.directory}`);
  console.log(`Scope: ${config.scope.path}`);
  console.log(`Recursive: ${config.scope.recursive}`);
  console.log("");

  console.log("Loading YAML items...");

  const items = await loadYamlItems(
    config.source.directory,
    config.scope.recursive,
  );

  console.log(`Successfully loaded ${items.length} YAML item(s).`);
  console.log("");

  for (const loaded of items) {
    console.log(`${loaded.item.ID} | ${loaded.item.Path} | ${loaded.filePath}`);
  }
}

main().catch((error: unknown) => {
  console.error("Migration application failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
