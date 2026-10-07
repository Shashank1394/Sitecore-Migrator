/**
 * Rendering migration: XP Controller Rendering → SitecoreAI Json Rendering.
 *
 * Flow:
 *  1. Scan YAML files under the selected scope folder.
 *  2. Collect every unique Template GUID from those files.
 *  3. Use the SitecoreAI Authoring GraphQL API to:
 *       a. Confirm which GUID is "Controller Rendering" (by looking up each GUID by name)
 *       b. Search for "Json Rendering" by name to get its real GUID
 *  4. Build a MigrationPlan.
 *  5. On approval: copy the source folder tree to the destination, then patch
 *     the Template field in every affected YAML file.
 */

import { readFile, writeFile, copyFile, mkdir, stat, readdir } from "node:fs/promises";
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

export type ProgressCallback = (progress: AnalysisProgress) => void;

export interface TemplateMap {
  controllerRenderingId: string;
  controllerRenderingName: string;
  jsonRenderingId: string;
  jsonRenderingName: string;
}

export interface MigrationOptions {
  sourceRoot: string;
  destinationRoot: string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runRenderingMigration(
  scopeFolder: string,
  agentApi: SitecoreAiAgentApi,
  onProgress: ProgressCallback,
): Promise<MigrationPlan> {

  // ── Step 1: Scan YAML files ───────────────────────────────────────────────

  onProgress({
    status: "investigating",
    message: "Scanning YAML files...",
    completedCases: 0,
    totalCases: 1,
  });

  const allFiles = await scanYamlFiles(scopeFolder, true);

  if (allFiles.length === 0) {
    throw new Error(`No YAML files found in: ${scopeFolder}`);
  }

  onProgress({
    status: "investigating",
    message: `Found ${allFiles.length} YAML files. Reading template IDs...`,
    completedCases: 0,
    totalCases: 1,
  });

  // ── Step 2: Read files + collect unique template GUIDs ────────────────────

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
      if (item.ID && item.Template) {
        entries.push({
          filePath,
          id: item.ID,
          templateId: normalizeGuid(item.Template),
          sitecorePath: item.Path ?? filePath,
        });
      }
    } catch {
      readErrors.push(filePath);
    }
  }

  const uniqueGuids = [...new Set(entries.map(e => e.templateId))];

  onProgress({
    status: "investigating",
    message: `Found ${uniqueGuids.length} unique template GUIDs. Querying SitecoreAI to identify them...`,
    completedCases: 0,
    totalCases: 1,
    investigationStep: "SitecoreAI Agent API lookup",
  });

  // ── Step 3: Use LLM + SitecoreAI API to identify Controller Rendering ──────
  //           and find the real Json Rendering GUID.

  const templateMap = await findTemplatesWithLlm(agentApi, uniqueGuids, onProgress);

  onProgress({
    status: "planning",
    message: `Templates resolved: ${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,
    completedCases: 0,
    totalCases: 1,
    investigationStep: `${templateMap.controllerRenderingId} → ${templateMap.jsonRenderingId}`,
  });

  // ── Step 4: Build migration plan ──────────────────────────────────────────

  const plan = buildMigrationPlan(entries, templateMap, readErrors);

  onProgress({
    status: "complete",
    message: `Analysis complete. ${plan.totalFilesAffected} file(s) will have their Template field updated.`,
    completedCases: 1,
    totalCases: 1,
  });

  return plan;
}

// ── Build migration plan ──────────────────────────────────────────────────────

function buildMigrationPlan(
  entries: Array<{ filePath: string; id: string; templateId: string; sitecorePath: string }>,
  templateMap: TemplateMap,
  readErrors: string[],
): MigrationPlan {

  const affectedFiles: AffectedFile[] = [];

  for (const entry of entries) {
    if (entry.templateId !== templateMap.controllerRenderingId) continue;

    const change: PlannedFieldChange = {
      field: "Template",
      from: entry.templateId,
      to: templateMap.jsonRenderingId,
      description: `${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,
    };

    affectedFiles.push({
      filePath: entry.filePath,
      itemId: entry.id,
      sitecorePath: entry.sitecorePath,
      plannedChanges: [change],
    });
  }

  const exceptions = readErrors.map(filePath => ({
    filePath,
    message: "Could not read or parse this YAML file.",
    severity: "warning" as const,
  }));

  const caseAnalysis: CaseAnalysis = {
    caseId: "renderings",
    caseName: "Controller Rendering → Json Rendering",
    status: "complete",
    filesDiscovered: entries.length,
    filesAffected: affectedFiles,
    discoveredTemplates: [
      { name: templateMap.controllerRenderingName, id: templateMap.controllerRenderingId, environment: "xp" },
      { name: templateMap.jsonRenderingName,        id: templateMap.jsonRenderingId,        environment: "sitecoreAI" },
    ],
    patternDescription: `${templateMap.controllerRenderingName} → ${templateMap.jsonRenderingName}`,
    exceptions,
  };

  return {
    generatedAt: new Date().toISOString(),
    instructionsVersion: "1.0",
    cases: [caseAnalysis],
    totalFilesAffected: affectedFiles.length,
    totalExceptions: exceptions.length,
    approved: false,
  };
}

// ── Apply the migration plan ──────────────────────────────────────────────────

/**
 * Copies the source folder tree to the destination, then patches the Template
 * field in every affected YAML file. Source files are never modified.
 */
export async function applyMigrationPlan(
  plan: MigrationPlan,
  options: MigrationOptions,
  onProgress: (message: string) => void,
): Promise<{ applied: number; errors: string[] }> {
  const { sourceRoot, destinationRoot } = options;

  onProgress(`Copying source folder structure to ${destinationRoot}...`);
  await copyFolderRecursive(sourceRoot, destinationRoot, onProgress, sourceRoot);
  onProgress("Copy complete. Applying template updates...");

  let applied = 0;
  const errors: string[] = [];

  for (const caseResult of plan.cases) {
    for (const affected of caseResult.filesAffected) {
      try {
        // Map the source file path into the destination tree
        const relativePath   = path.relative(sourceRoot, affected.filePath);
        const destinationPath = path.join(destinationRoot, relativePath);

        let content = await readFile(destinationPath, "utf-8");

        for (const change of affected.plannedChanges) {
          // Sitecore CLI YAML stores GUIDs as: Template: "lowercase-no-braces"
          const fromPlain = change.from.replace(/[{}]/g, "").toLowerCase();
          const toPlain   = change.to.replace(/[{}]/g, "").toLowerCase();

          // Match all known serialization formats:
          //   Template: "76036f5e-..."    ← standard (no braces, quoted)
          //   Template: "{76036F5E-...}"  ← braces + quoted
          //   Template: 76036f5e-...      ← unquoted
          const pattern = new RegExp(
            `(Template:\\s*)["']?\\{?${escapeRegex(fromPlain)}\\}?["']?`,
            "gi",
          );

          const before = content;
          content = content.replace(pattern, `$1"${toPlain}"`);

          if (content === before) {
            onProgress(`⚠ Template field not found in: ${relativePath}`);
          }
        }

        await writeFile(destinationPath, content, "utf-8");
        applied++;
        onProgress(`✓ Updated: ${relativePath}`);
      } catch (err) {
        const msg = `Failed: ${affected.filePath}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        onProgress(`✕ ${msg}`);
      }
    }
  }

  return { applied, errors };
}

// ── Folder copy ───────────────────────────────────────────────────────────────

async function copyFolderRecursive(
  source: string,
  destination: string,
  onProgress: (msg: string) => void,
  originalSourceRoot: string,
): Promise<void> {
  const s = await stat(source);
  if (s.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const item of await readdir(source)) {
      await copyFolderRecursive(
        path.join(source, item),
        path.join(destination, item),
        onProgress,
        originalSourceRoot,
      );
    }
  } else {
    await copyFile(source, destination);
    onProgress(`📄 Copied: ${path.relative(originalSourceRoot, source)}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeGuid(guid: string): string {
  return `{${guid.replace(/[{}]/g, "").toUpperCase()}}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
