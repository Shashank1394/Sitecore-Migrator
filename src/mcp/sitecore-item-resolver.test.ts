import { MockSitecoreMcpClient } from "./mock-sitecore-mcp-client.js";
import { SitecoreItemResolver } from "./sitecore-item-resolver.js";
import type { SitecoreItemMetadata } from "./mcp-client.js";
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
    {
      id: "target-hero",
      name: "Hero",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Hero",
      parentId: "target-data",
      templateId: "target-hero-template",
      database: "master",
    },
  ];

  const client = new MockSitecoreMcpClient(targetItems);
  const resolver = new SitecoreItemResolver(client);

  const sourceCopyBanner: LoadedYamlItem = {
    filePath: "./source/xp/Copy Banner.yml",
    item: {
      ID: "source-copy-banner",
      Parent: "source-data",
      Template: "source-copy-banner-template",
      Path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
      DB: "master",
    },
  };

  const byPath = await resolver.resolveByPath(sourceCopyBanner);

  if (!byPath.target) {
    throw new Error("Expected Copy Banner to resolve by path.");
  }

  if (byPath.target.id !== "target-copy-banner") {
    throw new Error(`Unexpected target ID: ${byPath.target.id}`);
  }

  const byNameAndParent = await resolver.resolveByNameAndParent(
    sourceCopyBanner,
    "target-data",
  );

  if (!byNameAndParent.target) {
    throw new Error("Expected Copy Banner to resolve by name and parent.");
  }

  if (byNameAndParent.target.id !== "target-copy-banner") {
    throw new Error(`Unexpected target ID: ${byNameAndParent.target.id}`);
  }

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

  const missing = await resolver.resolveByPath(missingSource);

  if (missing.target !== null) {
    throw new Error("Expected missing target to resolve to null.");
  }

  console.log("Sitecore item resolver test passed.");
}

main().catch((error: unknown) => {
  console.error("Sitecore item resolver test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
