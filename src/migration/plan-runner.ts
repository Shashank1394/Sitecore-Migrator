import { loadMigrationInstructions } from "./instruction-loader.js";
import { analyseCase } from "./case-analyser.js";
import type { McpClients } from "./case-analyser.js";
import type { MigrationPlan, AnalysisProgress, CaseAnalysis } from "./analysis-types.js";

export type AnalysisProgressCallback = (progress: AnalysisProgress) => void;

export async function runAnalysis(
  sourceDirectory: string,
  clients: McpClients,
  onProgress: AnalysisProgressCallback,
  instructionsPath?: string,
): Promise<MigrationPlan> {
  // ── Load instructions ─────────────────────────────────────────────────────

  onProgress({
    status: "loading-instructions",
    message: "Loading migration instructions…",
    completedCases: 0,
    totalCases: 0,
  });

  const instructions = await loadMigrationInstructions(instructionsPath);
  const totalCases = instructions.cases.length;

  onProgress({
    status: "investigating",
    message: `Loaded ${totalCases} migration case${totalCases !== 1 ? "s" : ""}. Starting analysis…`,
    completedCases: 0,
    totalCases,
  });

  // ── Run each case ─────────────────────────────────────────────────────────

  const caseResults: CaseAnalysis[] = [];

  for (let i = 0; i < instructions.cases.length; i++) {
    const migrationCase = instructions.cases[i]!;

    onProgress({
      status: "investigating",
      message: `Analysing case: ${migrationCase.name}`,
      currentCase: migrationCase.name,
      completedCases: i,
      totalCases,
    });

    try {
      const result = await analyseCase(
        migrationCase,
        sourceDirectory,
        clients,
        (step) => {
          onProgress({
            status: "investigating",
            message: step,
            currentCase: migrationCase.name,
            completedCases: i,
            totalCases,
            investigationStep: step,
          });
        },
      );

      caseResults.push(result);

      onProgress({
        status: "planning",
        message: `Case "${migrationCase.name}" complete — ${result.filesAffected.length} files affected.`,
        currentCase: migrationCase.name,
        completedCases: i + 1,
        totalCases,
      });
    } catch (err) {
      caseResults.push({
        caseId: migrationCase.id,
        caseName: migrationCase.name,
        status: "failed",
        filesDiscovered: 0,
        filesAffected: [],
        discoveredTemplates: [],
        patternDescription: "Analysis failed",
        exceptions: [
          {
            message: err instanceof Error ? err.message : String(err),
            severity: "error",
          },
        ],
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      onProgress({
        status: "investigating",
        message: `Case "${migrationCase.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        currentCase: migrationCase.name,
        completedCases: i + 1,
        totalCases,
      });
    }
  }

  // ── Build plan ────────────────────────────────────────────────────────────

  const totalFilesAffected = caseResults.reduce(
    (sum, c) => sum + c.filesAffected.length,
    0,
  );
  const totalExceptions = caseResults.reduce(
    (sum, c) => sum + c.exceptions.length,
    0,
  );

  const plan: MigrationPlan = {
    generatedAt: new Date().toISOString(),
    instructionsVersion: instructions.version,
    cases: caseResults,
    totalFilesAffected,
    totalExceptions,
    approved: false,
  };

  onProgress({
    status: "complete",
    message: `Analysis complete. ${totalFilesAffected} files will be affected across ${totalCases} case${totalCases !== 1 ? "s" : ""}.`,
    completedCases: totalCases,
    totalCases,
  });

  return plan;
}
