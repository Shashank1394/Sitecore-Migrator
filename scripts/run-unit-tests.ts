import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Runs every *.test.ts under src/ as a standalone tsx script (the project's
 * existing test convention). Exits non-zero if any test file fails.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const testFiles = [
  "src/mcp/bridge/mcp-bridge.test.ts",
  "src/llm/agent/mcp-agent.test.ts",
  "src/llm/agent/openrouter-tool-client.test.ts",
];

let failures = 0;

for (const file of testFiles) {
  console.log(`\n▶ ${file}`);
  const result = spawnSync("node", ["node_modules/tsx/dist/cli.mjs", file], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    failures += 1;
  }
}

console.log("");
if (failures > 0) {
  console.error(`${failures} test file(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All unit test files passed.");
}
