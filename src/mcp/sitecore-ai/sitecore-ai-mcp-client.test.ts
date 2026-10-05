import { SitecoreAiMcpClient } from "./sitecore-ai-mcp-client.js";
import type { SitecoreAiMcpTransport } from "./sitecore-ai-mcp-client.js";

const DATA_ID = "48223ace-d76e-4d12-b547-7656af4b649a";
const DATA_PATH = "/sitecore/content/Microsites/EnterpriseComponents/Data";

const FOLDER_ID = "3fea7808-3060-4cff-890b-02678b119f1d";
const FOLDER_PATH =
  "/sitecore/content/Microsites/EnterpriseComponents/Data/Accordions";

class FakeSitecoreAiTransport implements SitecoreAiMcpTransport {
  async getContentItemById(itemId: string): Promise<unknown> {
    if (itemId === DATA_ID) {
      return {
        itemId: DATA_ID,
        name: "Data",
        path: DATA_PATH,
        template: {
          templateId: "a29d272e-9d48-453c-9e9d-b47585fa7f20",
          name: "JSS Data",
        },
        fields: {},
      };
    }

    return null;
  }

  async getContentItemByPath(itemPath: string): Promise<unknown> {
    if (itemPath === DATA_PATH) {
      return {
        itemId: DATA_ID,
        name: "Data",
        path: DATA_PATH,
        template: {
          templateId: "a29d272e-9d48-453c-9e9d-b47585fa7f20",
          name: "JSS Data",
        },
        fields: {},
        children: {
          nodes: [
            {
              itemId: FOLDER_ID,
              name: "Accordions",
              path: FOLDER_PATH,
              template: {
                templateId: "46351e61-83bb-4517-ba7b-311c5c68fa2b",
                name: "Accordion Folder",
              },
              fields: {},
            },
          ],
        },
      };
    }

    if (itemPath === FOLDER_PATH) {
      return {
        itemId: FOLDER_ID,
        name: "Accordions",
        path: FOLDER_PATH,
        template: {
          templateId: "46351e61-83bb-4517-ba7b-311c5c68fa2b",
          name: "Accordion Folder",
        },
        fields: {},
        children: {
          nodes: [],
        },
      };
    }

    return null;
  }
}

async function main(): Promise<void> {
  const transport = new FakeSitecoreAiTransport();

  const client = new SitecoreAiMcpClient(transport);

  // --------------------------------------------------
  // getItemById
  // --------------------------------------------------

  const itemById = await client.getItemById(DATA_ID);

  if (!itemById) {
    throw new Error("getItemById failed: Data item was not found.");
  }

  if (itemById.id !== DATA_ID) {
    throw new Error("getItemById returned an incorrect item ID.");
  }

  if (itemById.name !== "Data") {
    throw new Error("getItemById returned an incorrect item name.");
  }

  console.log("getItemById passed.");

  // --------------------------------------------------
  // getItemByPath
  // --------------------------------------------------

  const itemByPath = await client.getItemByPath(DATA_PATH);

  if (!itemByPath) {
    throw new Error("getItemByPath failed: Data item was not found.");
  }

  if (itemByPath.id !== DATA_ID) {
    throw new Error("getItemByPath returned an incorrect item ID.");
  }

  console.log("getItemByPath passed.");

  // --------------------------------------------------
  // getChildren
  // --------------------------------------------------

  const children = await client.getChildren(DATA_ID);

  if (children.length !== 1) {
    throw new Error(`Expected 1 child, received ${children.length}.`);
  }

  if (children[0].id !== FOLDER_ID) {
    throw new Error("getChildren returned an incorrect child ID.");
  }

  if (children[0].parentId !== DATA_ID) {
    throw new Error("getChildren did not assign the correct parent ID.");
  }

  console.log("getChildren passed.");

  // --------------------------------------------------
  // getItemByName
  // --------------------------------------------------

  const itemByName = await client.getItemByName("Accordions", DATA_ID);

  if (!itemByName) {
    throw new Error("getItemByName failed: Accordions was not found.");
  }

  if (itemByName.id !== FOLDER_ID) {
    throw new Error("getItemByName returned an incorrect item.");
  }

  console.log("getItemByName passed.");

  // --------------------------------------------------
  // Missing item
  // --------------------------------------------------

  const missing = await client.getItemByPath(
    "/sitecore/content/Microsites/EnterpriseComponents/Data/DoesNotExist",
  );

  if (missing !== null) {
    throw new Error("Missing item should return null.");
  }

  console.log("Missing item handling passed.");

  console.log("");
  console.log("SitecoreAI MCP client test passed.");
}

main().catch((error: unknown) => {
  console.error("SitecoreAI MCP client test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
