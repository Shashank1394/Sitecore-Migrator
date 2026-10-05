import type { MappingResult } from "./mapping-result.js";
import type { MigrationMappingSummary } from "./migration-mapper.js";

export interface MappingReportEntry {
  sourceId: string;
  sourcePath: string;
  status: MappingResult["status"];
  strategy?: string;
  targetId?: string;
  targetPath?: string;
  reason?: string;
}

export interface MappingReport {
  summary: MigrationMappingSummary;
  entries: MappingReportEntry[];
}

export function createMappingReport(
  summary: MigrationMappingSummary,
): MappingReport {
  const entries = summary.results.map(
    (result): MappingReportEntry => ({
      sourceId: result.sourceId,
      sourcePath: result.sourcePath,
      status: result.status,
      strategy: result.reason,
      targetId: result.target?.id,
      targetPath: result.target?.path,
      reason: result.reason,
    }),
  );

  return {
    summary,
    entries,
  };
}
