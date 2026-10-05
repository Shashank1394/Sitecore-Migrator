import { MockSitecoreMcpClient } from "./mock-sitecore-mcp-client.js";
import type { SitecoreItemMetadata } from "./mcp-client.js";

async function main(): Promise<void> {
  const items: SitecoreItemMetadata[] = [
    {
      id: "root-id",
      name: "Data",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data",
      parentId: "parent-id",
      templateId: "folder-template",
      database: "master",
    },
    {
      id: "copy-banner-id",
      name: "Copy Banner",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
      parentId: "root-id",
      templateId: "copy-banner-template",
      database: "master",
    },
    {
      id: "hero-id",
      name: "Hero",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Hero",
      parentId: "root-id",
      templateId: "hero-template",
      database: "master",
    },
  ];

  const client = new MockSitecoreMcpClient(items);

  const byId = await client.getItemById("copy-banner-id");

  if (!byId || byId.name !== "Copy Banner") {
    throw new Error("getItemById failed.");
  }

  const byPath = await client.getItemByPath(
    "/sitecore/content/Microsites/EnterpriseComponents/Data/Hero",
  );

  if (!byPath || byPath.id !== "hero-id") {
    throw new Error("getItemByPath failed.");
  }

  const children = await client.getChildren("root-id");

  if (children.length !== 2) {
    throw new Error(
      `getChildren failed. Expected 2 children, received ${children.length}.`,
    );
  }

  const byName = await client.getItemByName("Copy Banner", "root-id");

  if (!byName || byName.id !== "copy-banner-id") {
    throw new Error("getItemByName failed.");
  }

  const missing = await client.getItemById("does-not-exist");

  if (missing !== null) {
    throw new Error("Missing item lookup should return null.");
  }

  console.log("MCP mock client test passed.");
}

main().catch((error: unknown) => {
  console.error("MCP mock client test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
