import { loadYamlItems } from "./yaml-loader.js";
import { YamlIndex } from "./yaml-index.js";

async function main(): Promise<void> {
  const items = await loadYamlItems("./source/xp", true);

  const index = new YamlIndex(items);

  console.log(`Indexed items: ${index.size}`);

  const root = index.getByPath(
    "/sitecore/content/Microsites/EnterpriseComponents/Data",
  );

  if (!root) {
    throw new Error("Root Data item was not found.");
  }

  console.log(`Root: ${root.item.ID} | ${root.item.Path}`);

  const children = index.getChildren(root.item.ID);

  console.log(`Direct children: ${children.length}`);

  const copyBanner = index.getById("8e729e32-56fa-49fb-ba82-043bbd53fed3");

  if (!copyBanner) {
    throw new Error("Copy Banner item was not found.");
  }

  console.log(`Copy Banner: ${copyBanner.item.ID} | ${copyBanner.item.Path}`);

  const copyBannerByPath = index.getByPath(
    "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
  );

  if (!copyBannerByPath) {
    throw new Error("Copy Banner was not found by path.");
  }

  console.log(`Path lookup successful: ${copyBannerByPath.item.ID}`);

  console.log("YamlIndex test passed.");
}

main().catch((error: unknown) => {
  console.error("YamlIndex test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
