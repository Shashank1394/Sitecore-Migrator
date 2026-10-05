import { MappingContext } from "./mapping-context.js";
import type { MappingResult } from "./mapping-result.js";

function main(): void {
  const context = new MappingContext();

  const result: MappingResult = {
    status: "matched",
    sourceId: "source-copy-banner",
    sourcePath:
      "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
    target: {
      id: "target-copy-banner",
      name: "Copy Banner",
      path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner",
      parentId: "target-data",
      templateId: "target-copy-banner-template",
      database: "master",
    },
    reason: "exact-path",
  };

  context.setMapping(result);

  if (context.size !== 1) {
    throw new Error(`Expected context size to be 1, received ${context.size}.`);
  }

  if (!context.hasMapping("source-copy-banner")) {
    throw new Error("Expected source mapping to exist.");
  }

  const stored = context.getMapping("source-copy-banner");

  if (!stored) {
    throw new Error("Expected stored mapping.");
  }

  if (stored.target?.id !== "target-copy-banner") {
    throw new Error(`Unexpected target ID: ${stored.target?.id}`);
  }

  const targetId = context.getTargetId("source-copy-banner");

  if (targetId !== "target-copy-banner") {
    throw new Error(`Unexpected target ID from getTargetId: ${targetId}`);
  }

  if (context.hasMapping("does-not-exist")) {
    throw new Error("Unexpected mapping for unknown source ID.");
  }

  if (context.getTargetId("does-not-exist") !== undefined) {
    throw new Error("Unknown source ID should not have a target ID.");
  }

  console.log("Mapping context test passed.");
}

main();
