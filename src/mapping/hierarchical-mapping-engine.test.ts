import { MockSitecoreMcpClient } from "../mcp/mock-sitecore-mcp-client.js";
import { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import type { SitecoreItemMetadata } from "../mcp/mcp-client.js";
import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import { MappingContext } from "./mapping-context.js";
import { HierarchicalMappingEngine } from "./hierarchical-mapping-engine.js";

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

  const client = new MockSitecoreMcpClient(targetItems);
  const resolver = new SitecoreItemResolver(client);
  const context = new MappingContext();

  const engine = new HierarchicalMappingEngine(resolver, context);

  const sourceFolder: LoadedYamlItem = {
    filePath: "./source/xp/Folder A.yml",
    item: {
      ID: "source-folder-a",
      Parent: "source-data",
      Template: "source-folder-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A",
      DB: "master",
    },
  };

  const folderResult = await engine.mapItem(sourceFolder);

  if (folderResult.status !== "matched") {
    throw new Error(
      `Expected Folder A to match, received ${folderResult.status}.`,
    );
  }

  if (!folderResult.target) {
    throw new Error("Expected Folder A to have a target.");
  }

  if (folderResult.target.id !== "target-folder-a") {
    throw new Error(`Unexpected Folder A target: ${folderResult.target.id}`);
  }

  if (folderResult.reason !== "exact-path") {
    throw new Error(
      `Expected Folder A to use exact-path, received ${folderResult.reason}.`,
    );
  }

  console.log("Parent mapping succeeded.");

  const sourceCopyBanner: LoadedYamlItem = {
    filePath: "./source/xp/Folder A/Copy Banner.yml",
    item: {
      ID: "source-copy-banner",
      Parent: "source-folder-a",
      Template: "source-copy-banner-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A/Copy Banner",
      DB: "master",
    },
  };

  const copyBannerResult = await engine.mapItem(sourceCopyBanner);

  if (copyBannerResult.status !== "matched") {
    throw new Error(
      `Expected Copy Banner to match, received ${copyBannerResult.status}.`,
    );
  }

  if (!copyBannerResult.target) {
    throw new Error("Expected Copy Banner to have a target.");
  }

  if (copyBannerResult.target.id !== "target-copy-banner") {
    throw new Error(
      `Unexpected Copy Banner target: ${copyBannerResult.target.id}`,
    );
  }

  if (copyBannerResult.reason !== "name-and-parent") {
    throw new Error(
      `Expected Copy Banner to use name-and-parent, received ${copyBannerResult.reason}.`,
    );
  }

  console.log("Child fallback mapping succeeded.");

  if (context.getTargetId("source-folder-a") !== "target-folder-a") {
    throw new Error("Parent mapping was not stored in MappingContext.");
  }

  if (context.getTargetId("source-copy-banner") !== "target-copy-banner") {
    throw new Error("Child mapping was not stored in MappingContext.");
  }

  console.log("MappingContext contains both mappings.");

  const sourceWithoutMappedParent: LoadedYamlItem = {
    filePath: "./source/xp/Orphan.yml",
    item: {
      ID: "source-orphan",
      Parent: "source-unmapped-parent",
      Template: "source-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Orphan",
      DB: "master",
    },
  };

  const orphanResult = await engine.mapItem(sourceWithoutMappedParent);

  if (orphanResult.status !== "missing") {
    throw new Error(
      `Expected orphan item to be missing, received ${orphanResult.status}.`,
    );
  }

  console.log("Unmapped-parent handling succeeded.");
  console.log("Hierarchical mapping engine test passed.");
}

main().catch((error: unknown) => {
  console.error("Hierarchical mapping engine test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
