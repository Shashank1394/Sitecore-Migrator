import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { SitecoreItemMetadata } from "../mcp/mcp-client.js";
import { MockSitecoreMcpClient } from "../mcp/mock-sitecore-mcp-client.js";
import { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import { MappingContext } from "./mapping-context.js";
import { HierarchicalMappingEngine } from "./hierarchical-mapping-engine.js";
import { MigrationMapper } from "./migration-mapper.js";

async function main(): Promise<void> {
  const targetItems: SitecoreItemMetadata[] = [
    {
      id: "target-data",
      name: "Data",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data",
      parentId: "target-root",
      templateId: "target-folder-template",
      database: "master",
    },
    {
      id: "target-folder-a",
      name: "Folder A",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A",
      parentId: "target-data",
      templateId: "target-folder-template",
      database: "master",
    },
    {
      id: "target-copy-banner",
      name: "Copy Banner",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A/Copy Banner Migrated",
      parentId: "target-folder-a",
      templateId: "target-copy-banner-template",
      database: "master",
    },
  ];

  const sourceItems: LoadedYamlItem[] = [
    {
      filePath: "./source/xp/Copy Banner.yml",
      item: {
        ID: "source-copy-banner",
        Parent: "source-folder-a",
        Template: "source-copy-banner-template",
        Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A/Copy Banner",
        DB: "master",
      },
    },
    {
      filePath: "./source/xp/Folder A.yml",
      item: {
        ID: "source-folder-a",
        Parent: "source-data",
        Template: "source-folder-template",
        Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A",
        DB: "master",
      },
    },
    {
      filePath: "./source/xp/Data.yml",
      item: {
        ID: "source-data",
        Parent: "source-root",
        Template: "source-folder-template",
        Path: "/sitecore/content/Microsites/EnterpriseComponents/Data",
        DB: "master",
      },
    },
  ];

  const client = new MockSitecoreMcpClient(targetItems);
  const resolver = new SitecoreItemResolver(client);
  const context = new MappingContext();
  const engine = new HierarchicalMappingEngine(resolver, context);

  const mapper = new MigrationMapper(engine, context);

  const summary = await mapper.mapItems(sourceItems);

  if (summary.total !== 3) {
    throw new Error(`Expected 3 items, received ${summary.total}.`);
  }

  if (summary.matched !== 3) {
    throw new Error(`Expected 3 matched items, received ${summary.matched}.`);
  }

  if (summary.missing !== 0) {
    throw new Error(`Expected 0 missing items, received ${summary.missing}.`);
  }

  if (summary.ambiguous !== 0) {
    throw new Error(
      `Expected 0 ambiguous items, received ${summary.ambiguous}.`,
    );
  }

  const dataMapping = context.getMapping("source-data");

  if (!dataMapping?.target) {
    throw new Error("Data mapping was not stored.");
  }

  if (dataMapping.target.id !== "target-data") {
    throw new Error(`Unexpected Data target ID: ${dataMapping.target.id}`);
  }

  const folderMapping = context.getMapping("source-folder-a");

  if (!folderMapping?.target) {
    throw new Error("Folder A mapping was not stored.");
  }

  if (folderMapping.target.id !== "target-folder-a") {
    throw new Error(
      `Unexpected Folder A target ID: ${folderMapping.target.id}`,
    );
  }

  const copyBannerMapping = context.getMapping("source-copy-banner");

  if (!copyBannerMapping?.target) {
    throw new Error("Copy Banner mapping was not stored.");
  }

  if (copyBannerMapping.target.id !== "target-copy-banner") {
    throw new Error(
      `Unexpected Copy Banner target ID: ${copyBannerMapping.target.id}`,
    );
  }

  if (copyBannerMapping.reason !== "name-and-parent") {
    throw new Error(
      `Expected Copy Banner to use name-and-parent, received ${copyBannerMapping.reason}.`,
    );
  }

  console.log("Total items:", summary.total);
  console.log("Matched:", summary.matched);
  console.log("Missing:", summary.missing);
  console.log("Ambiguous:", summary.ambiguous);
  console.log("Copy Banner mapping:", copyBannerMapping.target.id);
  console.log("Copy Banner strategy:", copyBannerMapping.reason);

  console.log("MigrationMapper test passed.");
}

main().catch((error: unknown) => {
  console.error("MigrationMapper test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
