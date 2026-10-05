import { MockSitecoreMcpClient } from "../mcp/mock-sitecore-mcp-client.js";
import { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import type { SitecoreItemMetadata } from "../mcp/mcp-client.js";
import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import { MappingStrategyRunner } from "./mapping-strategy-runner.js";

async function main(): Promise<void> {
  const targetItems: SitecoreItemMetadata[] = [
    {
      id: "target-copy-banner",
      name: "Copy Banner",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
      parentId: "target-data",
      templateId: "target-copy-banner-template",
      database: "master",
    },
  ];

  const client = new MockSitecoreMcpClient(targetItems);
  const resolver = new SitecoreItemResolver(client);
  const runner = new MappingStrategyRunner(resolver);

  const sourceItem: LoadedYamlItem = {
    filePath: "./source/xp/Copy Banner.yml",
    item: {
      ID: "source-copy-banner",
      Parent: "source-data",
      Template: "source-copy-banner-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
      DB: "master",
    },
  };

  const exactPathResult = await runner.run("exact-path", sourceItem);

  if (exactPathResult.status !== "matched") {
    throw new Error(
      `Expected exact-path to match, received ${exactPathResult.status}.`,
    );
  }

  if (!exactPathResult.target) {
    throw new Error("Expected exact-path to return a target.");
  }

  console.log("exact-path strategy passed.");

  const nameAndParentResult = await runner.run(
    "name-and-parent",
    sourceItem,
    "target-data",
  );

  if (nameAndParentResult.status !== "matched") {
    throw new Error(
      `Expected name-and-parent to match, received ${nameAndParentResult.status}.`,
    );
  }

  if (!nameAndParentResult.target) {
    throw new Error("Expected name-and-parent to return a target.");
  }

  console.log("name-and-parent strategy passed.");

  const missingParentResult = await runner.run("name-and-parent", sourceItem);

  if (missingParentResult.status !== "missing") {
    throw new Error(
      "Expected name-and-parent without a parent ID to return missing.",
    );
  }

  console.log("name-and-parent missing-parent handling passed.");

  const exactIdResult = await runner.run("exact-id", sourceItem);

  if (exactIdResult.status !== "missing") {
    throw new Error("Expected exact-id to remain unimplemented.");
  }

  if (exactIdResult.reason !== "Exact-ID mapping is not implemented yet.") {
    throw new Error(`Unexpected exact-id reason: ${exactIdResult.reason}`);
  }

  console.log("exact-id placeholder passed.");

  console.log("Mapping strategy runner test passed.");
}

main().catch((error: unknown) => {
  console.error("Mapping strategy runner test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
