/**
 * Rendering migration:
 *
 * Controller Rendering → Json Rendering
 *
 * Analysis:
 *   1. Scan only the selected rendering folder.
 *   2. Read every YAML file in that folder recursively.
 *   3. Collect unique Template IDs.
 *   4. Use the LLM + SitecoreAI Agent API to identify:
 *        - Controller Rendering template ID
 *        - Json Rendering template ID
 *   5. Build a migration plan.
 *
 * Apply:
 *   1. Copy the complete selected folder to the output directory.
 *   2. Update only the Template field in affected YAML files.
 *   3. Validate every updated file.
 *   4. Never modify the original source folder.
 */

import {
  readFile,
  writeFile,
  copyFile,
  mkdir,
  stat,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import { scanYamlFiles } from "../yaml/yaml-scanner.js";
import { readYamlFile } from "../yaml/yaml-reader.js";

import type { SitecoreAiAgentApi } from "../sitecoreai/agent-api.js";
import { findTemplatesWithLlm } from "../sitecoreai/llm-template-finder.js";

import type {
  AffectedFile,
  AnalysisProgress,
  CaseAnalysis,
  MigrationPlan,
  PlannedFieldChange,
} from "./analysis-types.js";

export type ProgressCallback = (
  progress: AnalysisProgress,
) => void;

export interface TemplateMap {
  controllerRenderingId: string;
  controllerRenderingName: string;
  jsonRenderingId: string;
  jsonRenderingName: string;
}

export interface MigrationOptions {
  /**
   * The folder explicitly selected by the user.
   *
   * Example:
   * C:\Project\EC-Renderings
   */
  sourceRoot: string;

  /**
   * The output directory selected by the user.
   *
   * Example:
   * D:\Migrated
   */
  destinationRoot: string;
}

/* ========================================================================== */
/* Analysis                                                                    */
/* ========================================================================== */

export async function runRenderingMigration(
  scopeFolder: string,
  agentApi: SitecoreAiAgentApi,
  onProgress: ProgressCallback,
): Promise<MigrationPlan> {
  onProgress({
    status: "investigating",
    message: "Scanning selected rendering folder...",
    completedCases: 0,
    totalCases: 1,
  });

  /*
   * IMPORTANT:
   * scopeFolder is already the folder selected by the user.
   *
   * We intentionally do NOT scan its parent/source directory.
   */
  const allFiles = await scanYamlFiles(
    scopeFolder,
    true,
  );

  if (allFiles.length === 0) {
    throw new Error(
      `No YAML files found in selected folder: ${scopeFolder}`,
    );
  }

  onProgress({
    status: "investigating",
    message: `Found ${allFiles.length} YAML file(s) in the selected rendering folder.`,
    completedCases: 0,
    totalCases: 1,
  });

  /* ------------------------------------------------------------------------ */
  /* Read YAML files                                                          */
  /* ------------------------------------------------------------------------ */

  type YamlEntry = {
    filePath: string;
    id: string;
    templateId: string;
    sitecorePath: string;
  };

  const entries: YamlEntry[] = [];
  const readErrors: string[] = [];

  for (const filePath of allFiles) {
    try {
      const item = await readYamlFile(filePath);

      if (!item.ID || !item.Template) {
        continue;
      }

      entries.push({
        filePath,
        id: item.ID,
        templateId: normalizeGuid(item.Template),
        sitecorePath: item.Path ?? filePath,
      });
    } catch {
      readErrors.push(filePath);
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `No valid YAML items with ID and Template fields were found in: ${scopeFolder}`,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Unique template IDs                                                       */
  /* ------------------------------------------------------------------------ */

  const uniqueGuids = [
    ...new Set(
      entries.map(
        (entry) => entry.templateId,
      ),
    ),
  ];

  onProgress({
    status: "investigating",
    message: `Found ${uniqueGuids.length} unique template ID(s). Asking SitecoreAI to identify Controller Rendering...`,
    completedCases: 0,
    totalCases: 1,
    investigationStep:
      "SitecoreAI Agent API lookup",
  });

  /* ------------------------------------------------------------------------ */
  /* LLM + Agent API                                                           */
  /* ------------------------------------------------------------------------ */

  const templateMap =
    await findTemplatesWithLlm(
      agentApi,
      uniqueGuids,
      onProgress,
    );

  onProgress({
    status: "planning",
    message:
      `Rendering templates resolved: ${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,
    completedCases: 0,
    totalCases: 1,
    investigationStep:
      `${templateMap.controllerRenderingId} → ${templateMap.jsonRenderingId}`,
  });

  /* ------------------------------------------------------------------------ */
  /* Build migration plan                                                     */
  /* ------------------------------------------------------------------------ */

  const plan = buildMigrationPlan(
    entries,
    templateMap,
    readErrors,
  );

  onProgress({
    status: "complete",
    message:
      `Analysis complete. ${plan.totalFilesAffected} file(s) will be updated.`,
    completedCases: 1,
    totalCases: 1,
  });

  return plan;
}

/* ========================================================================== */
/* Migration plan                                                              */
/* ========================================================================== */

function buildMigrationPlan(
  entries: Array<{
    filePath: string;
    id: string;
    templateId: string;
    sitecorePath: string;
  }>,
  templateMap: TemplateMap,
  readErrors: string[],
): MigrationPlan {
  const affectedFiles: AffectedFile[] = [];

  for (const entry of entries) {
    /*
     * Only YAML files whose Template matches the discovered
     * Controller Rendering template are changed.
     */
    if (
      normalizeGuid(entry.templateId) !==
      normalizeGuid(
        templateMap.controllerRenderingId,
      )
    ) {
      continue;
    }

    const change: PlannedFieldChange = {
      field: "Template",
      from: entry.templateId,
      to: templateMap.jsonRenderingId,
      description:
        `${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,
    };

    affectedFiles.push({
      filePath: entry.filePath,
      itemId: entry.id,
      sitecorePath: entry.sitecorePath,
      plannedChanges: [change],
    });
  }

  const exceptions = readErrors.map(
    (filePath) => ({
      filePath,
      message:
        "Could not read or parse this YAML file.",
      severity: "warning" as const,
    }),
  );

  const caseAnalysis: CaseAnalysis = {
    caseId: "renderings",
    caseName:
      "Controller Rendering → Json Rendering",
    status: "complete",
    filesDiscovered: entries.length,
    filesAffected: affectedFiles,

    discoveredTemplates: [
      {
        name:
          templateMap.controllerRenderingName,
        id: templateMap.controllerRenderingId,
        environment: "xp",
      },
      {
        name:
          templateMap.jsonRenderingName,
        id: templateMap.jsonRenderingId,
        environment: "sitecoreAI",
      },
    ],

    patternDescription:
      `${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,

    exceptions,
  };

  return {
    generatedAt:
      new Date().toISOString(),

    instructionsVersion: "1.0",

    cases: [caseAnalysis],

    totalFilesAffected:
      affectedFiles.length,

    totalExceptions:
      exceptions.length,

    approved: false,
  };
}

/* ========================================================================== */
/* Apply migration                                                             */
/* ========================================================================== */

export async function applyMigrationPlan(
  plan: MigrationPlan,
  options: MigrationOptions,
  onProgress: (message: string) => void,
): Promise<{
  applied: number;
  errors: string[];
}> {
  const {
    sourceRoot,
    destinationRoot,
  } = options;

  const sourceAbsolute =
    path.resolve(sourceRoot);

  const destinationAbsolute =
    path.resolve(destinationRoot);

  /* ------------------------------------------------------------------------ */
  /* Basic safety checks                                                       */
  /* ------------------------------------------------------------------------ */

  const sourceStats =
    await stat(sourceAbsolute);

  if (!sourceStats.isDirectory()) {
    throw new Error(
      `Selected source is not a directory: ${sourceAbsolute}`,
    );
  }

  const selectedFolderName =
    path.basename(sourceAbsolute);

  /*
   * Output should contain:
   *
   * destination/
   *   EC-Renderings/
   *
   * rather than placing the YAML files directly
   * into the output directory.
   */
  const destinationScopeRoot =
    path.join(
      destinationAbsolute,
      selectedFolderName,
    );

  /*
   * Prevent:
   *
   * source:
   * C:\Project\EC-Renderings
   *
   * destination:
   * C:\Project\EC-Renderings\output
   *
   * because recursive copying would copy the output
   * back into itself.
   */
  if (
    isSameOrInside(
      sourceAbsolute,
      destinationAbsolute,
    )
  ) {
    throw new Error(
      "The output directory cannot be the selected source folder or a folder inside it.",
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Copy complete selected folder                                             */
  /* ------------------------------------------------------------------------ */

  onProgress(
    `Copying selected folder "${selectedFolderName}"...`,
  );

  await copyFolderRecursive(
    sourceAbsolute,
    destinationScopeRoot,
    onProgress,
    sourceAbsolute,
  );

  onProgress(
    `Copy complete. Applying ${plan.totalFilesAffected} template update(s)...`,
  );

  /* ------------------------------------------------------------------------ */
  /* Apply changes                                                             */
  /* ------------------------------------------------------------------------ */

  let applied = 0;
  const errors: string[] = [];

  for (const caseResult of plan.cases) {
    for (const affected of caseResult.filesAffected) {
      const relativePath = path.relative(
        sourceAbsolute,
        affected.filePath,
      );

      const destinationPath =
        path.join(
          destinationScopeRoot,
          relativePath,
        );

      try {
        let content =
          await readFile(
            destinationPath,
            "utf-8",
          );

        /*
         * Keep the original item ID so we can
         * verify that migration changed only the
         * intended Template field.
         */
        const beforeItem =
          await readYamlFile(
            destinationPath,
          );

        const originalItemId =
          beforeItem.ID;

        for (const change of affected.plannedChanges) {
          if (change.field !== "Template") {
            continue;
          }

          const fromPlain =
            normalizeGuid(change.from)
              .replace(/[{}]/g, "")
              .toLowerCase();

          const toPlain =
            normalizeGuid(change.to)
              .replace(/[{}]/g, "")
              .toLowerCase();

          /*
           * Matches:
           *
           * Template: "guid"
           * Template: '{guid}'
           * Template: guid
           * Template: {guid}
           */
          const pattern =
            new RegExp(
              `(Template:\\s*)["']?\\{?${escapeRegex(
                fromPlain,
              )}\\}?["']?`,
              "gi",
            );

          const updated =
            content.replace(
              pattern,
              `$1"${toPlain}"`,
            );

          /*
           * If replacement didn't happen,
           * don't count the file as successfully
           * migrated.
           */
          if (updated === content) {
            throw new Error(
              `Expected Template value "${fromPlain}" was not found.`,
            );
          }

          content = updated;
        }

        await writeFile(
          destinationPath,
          content,
          "utf-8",
        );

        /* ------------------------------------------------------------------ */
        /* Validate                                                             */
        /* ------------------------------------------------------------------ */

        const afterItem =
          await readYamlFile(
            destinationPath,
          );

        const expectedTemplate =
          affected.plannedChanges.find(
            (change) =>
              change.field === "Template",
          )?.to;

        if (
          originalItemId &&
          afterItem.ID !== originalItemId
        ) {
          throw new Error(
            `Item ID changed unexpectedly. Before: ${originalItemId}, After: ${afterItem.ID}`,
          );
        }

        if (
          expectedTemplate &&
          normalizeGuid(
            afterItem.Template ?? "",
          ) !==
            normalizeGuid(
              expectedTemplate,
            )
        ) {
          throw new Error(
            "Template field was not updated to the expected Json Rendering ID.",
          );
        }

        applied++;

        onProgress(
          `✓ Updated: ${relativePath}`,
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : String(err);

        const fullMessage =
          `Failed: ${relativePath}: ${message}`;

        errors.push(fullMessage);

        onProgress(
          `✕ ${fullMessage}`,
        );
      }
    }
  }

  onProgress(
    `Migration finished. ${applied} file(s) updated, ${errors.length} error(s).`,
  );

  return {
    applied,
    errors,
  };
}

/* ========================================================================== */
/* Folder copy                                                                */
/* ========================================================================== */

async function copyFolderRecursive(
  source: string,
  destination: string,
  onProgress: (message: string) => void,
  originalSourceRoot: string,
): Promise<void> {
  const sourceStats =
    await stat(source);

  if (sourceStats.isDirectory()) {
    await mkdir(
      destination,
      { recursive: true },
    );

    const items =
      await readdir(source);

    for (const item of items) {
      await copyFolderRecursive(
        path.join(source, item),
        path.join(destination, item),
        onProgress,
        originalSourceRoot,
      );
    }

    return;
  }

  await mkdir(
    path.dirname(destination),
    { recursive: true },
  );

  await copyFile(
    source,
    destination,
  );

  onProgress(
    `📄 Copied: ${path.relative(
      originalSourceRoot,
      source,
    )}`,
  );
}

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function normalizeGuid(
  guid: string,
): string {
  return `{${guid
    .replace(/[{}]/g, "")
    .trim()
    .toUpperCase()}}`;
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function isSameOrInside(
  parent: string,
  candidate: string,
): boolean {
  const relative = path.relative(
    parent,
    candidate,
  );

  return (
    relative === "" ||
    (!relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}
