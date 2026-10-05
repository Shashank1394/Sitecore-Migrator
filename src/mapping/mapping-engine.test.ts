import { MockSitecoreMcpClient } from "../mcp/mock-sitecore-mcp-client.js";
import { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import { MappingEngine } from "./mapping-engine.js";
import type { SitecoreItemMetadata } from "../mcp/mcp-client.js";
import type { LoadedYamlItem } from "../yaml/yaml-loader.js";

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

  const mcpClient = new MockSitecoreMcpClient(targetItems);
  const resolver = new SitecoreItemResolver(mcpClient);
  const mappingEngine = new MappingEngine(resolver);

  if (mappingEngine.getStrategy() !== "exact-path") {
    throw new Error(
      `Unexpected mapping strategy: ${mappingEngine.getStrategy()}`,
    );
  }

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

  const result = await mappingEngine.mapItem(sourceItem);

  if (result.status !== "matched") {
    throw new Error(`Expected matched status, received: ${result.status}`);
  }

  if (!result.target) {
    throw new Error("Expected a target item.");
  }

  if (result.target.id !== "target-copy-banner") {
    throw new Error(`Unexpected target ID: ${result.target.id}`);
  }

  if (result.reason !== "exact-path") {
    throw new Error(`Unexpected mapping reason: ${result.reason}`);
  }

  console.log("Exact-path mapping succeeded.");

  const missingSource: LoadedYamlItem = {
    filePath: "./source/xp/Missing.yml",
    item: {
      ID: "source-missing",
      Parent: "source-data",
      Template: "source-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Missing",
      DB: "master",
    },
  };

  const missingResult = await mappingEngine.mapItem(missingSource);

  if (missingResult.status !== "missing") {
    throw new Error(
      `Expected missing status, received: ${missingResult.status}`,
    );
  }

  if (missingResult.target !== undefined) {
    throw new Error("Missing mapping should not contain a target.");
  }

  console.log("Missing mapping handled correctly.");
  console.log("Mapping engine test passed.");
}

main().catch((error: unknown) => {
  console.error("Mapping engine test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
