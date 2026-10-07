/**
 * Selects the migration implementation based on the top-level EC-* folder
 * selected by the user.
 *
 * The EC- prefix is ignored when selecting the migration handler.
 *
 * Examples:
 *   EC-Renderings  -> Renderings
 *   EC-Templates   -> Templates
 *   Renderings     -> Renderings
 */

import path from "node:path";

import type { SitecoreAiAgentApi } from "../sitecoreai/agent-api.js";
import { runRenderingMigration } from "./rendering-migration.js";
import type {
  AnalysisProgress,
  MigrationPlan,
} from "./analysis-types.js";

export type MigrationProgressCallback = (
  progress: AnalysisProgress,
) => void;

/**
 * Gets the migration handler name from the selected folder path.
 *
 * Examples:
 *   C:\Project\EC-Renderings -> Renderings
 *   C:\Project\EC-Templates  -> Templates
 *   C:\Project\Renderings    -> Renderings
 */
export function getMigrationHandlerKey(
  folderPath: string,
): string {
  const folderName = path.basename(
    path.resolve(folderPath),
  );

  return folderName.replace(/^EC-/i, "");
}

/**
 * Runs the migration analysis for the selected folder.
 *
 * Only the migration handler for the selected folder is executed.
 *
 * Currently implemented:
 *   Renderings
 *
 * Other folders will be added later.
 */
export async function runMigrationAnalysis(
  scopeFolder: string,
  agentApi: SitecoreAiAgentApi,
  onProgress: MigrationProgressCallback,
): Promise<MigrationPlan> {
  const handlerKey = getMigrationHandlerKey(
    scopeFolder,
  ).toLowerCase();

  switch (handlerKey) {
    case "renderings":
      return runRenderingMigration(
        scopeFolder,
        agentApi,
        onProgress,
      );

    default:
      throw new Error(
        `Migration for folder "${getMigrationHandlerKey(
          scopeFolder,
        )}" is not implemented yet.`,
      );
  }
}
