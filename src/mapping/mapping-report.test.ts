import type { MigrationMappingSummary } from "./migration-mapper.js";
import { createMappingReport } from "./mapping-report.js";

function main(): void {
  const summary: MigrationMappingSummary = {
    total: 3,
    matched: 2,
    missing: 1,
    ambiguous: 0,
    results: [
      {
        status: "matched",
        sourceId: "source-data",
        sourcePath: "/sitecore/content/Microsites/EnterpriseComponents/Data",
        target: {
          id: "target-data",
          name: "Data",
          path: "/sitecore/content/Microsites/EnterpriseComponents/Data",
          parentId: "target-root",
          templateId: "target-folder-template",
          database: "master",
        },
        reason: "exact-path",
      },
      {
        status: "matched",
        sourceId: "source-folder",
        sourcePath:
          "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A",
        target: {
          id: "target-folder",
          name: "Folder A",
          path: "/sitecore/content/Microsites/EnterpriseComponents/Data/Folder A Migrated",
          parentId: "target-data",
          templateId: "target-folder-template",
          database: "master",
        },
        reason: "name-and-parent",
      },
      {
        status: "missing",
        sourceId: "source-missing",
        sourcePath:
          "/sitecore/content/Microsites/EnterpriseComponents/Data/Missing",
        reason: "No target item found by exact path or name and parent.",
      },
    ],
  };

  const report = createMappingReport(summary);

  if (report.entries.length !== 3) {
    throw new Error(
      `Expected 3 report entries, received ${report.entries.length}.`,
    );
  }

  const dataEntry = report.entries[0];

  if (dataEntry.status !== "matched") {
    throw new Error("Data entry should be matched.");
  }

  if (dataEntry.targetId !== "target-data") {
    throw new Error(`Unexpected Data target ID: ${dataEntry.targetId}`);
  }

  if (dataEntry.strategy !== "exact-path") {
    throw new Error(`Unexpected Data strategy: ${dataEntry.strategy}`);
  }

  const folderEntry = report.entries[1];

  if (folderEntry.strategy !== "name-and-parent") {
    throw new Error(`Unexpected Folder strategy: ${folderEntry.strategy}`);
  }

  if (folderEntry.targetId !== "target-folder") {
    throw new Error(`Unexpected Folder target ID: ${folderEntry.targetId}`);
  }

  const missingEntry = report.entries[2];

  if (missingEntry.status !== "missing") {
    throw new Error("Missing item should have missing status.");
  }

  if (missingEntry.targetId !== undefined) {
    throw new Error("Missing item must not contain a target ID.");
  }

  if (!missingEntry.reason) {
    throw new Error("Missing item should contain a reason.");
  }

  if (report.summary.total !== 3) {
    throw new Error(`Unexpected summary total: ${report.summary.total}`);
  }

  console.log("Report entries:", report.entries.length);
  console.log("Data mapping:", dataEntry.targetId, dataEntry.strategy);
  console.log("Folder mapping:", folderEntry.targetId, folderEntry.strategy);
  console.log("Missing mapping:", missingEntry.status);

  console.log("Mapping report test passed.");
}

main();
