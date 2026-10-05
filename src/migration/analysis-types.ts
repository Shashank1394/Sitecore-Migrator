import type { InventoryEntry } from "./source-inventory.js";

// ── Discovered knowledge from MCP investigation ───────────────────────────────

export interface DiscoveredTemplate {
  name: string;           // human-readable name from instruction
  id: string;             // discovered GUID — never hardcoded
  environment: "xp" | "sitecoreAI";
  path?: string;          // template path in that environment
}

// ── A single field transformation that will be applied per file ──────────────

export interface PlannedFieldChange {
  field: string;
  from: string;           // current value in source YAML
  to: string;             // value it will be changed to
  description: string;
}

// ── Per-case analysis result ──────────────────────────────────────────────────

export type CaseAnalysisStatus =
  | "pending"
  | "investigating"
  | "planning"
  | "complete"
  | "failed"
  | "skipped";

export interface AffectedFile {
  filePath: string;
  itemId: string;
  sitecorePath: string;
  plannedChanges: PlannedFieldChange[];
}

export interface CaseException {
  filePath?: string;
  itemId?: string;
  message: string;
  severity: "warning" | "error";
}

export interface CaseAnalysis {
  caseId: string;
  caseName: string;
  status: CaseAnalysisStatus;

  // Files scanned within the case scope
  filesDiscovered: number;

  // Files that will actually be changed
  filesAffected: AffectedFile[];

  // Templates discovered via MCP (source + target)
  discoveredTemplates: DiscoveredTemplate[];

  // Human-readable pattern description, e.g. "Controller Rendering → JSON Rendering"
  patternDescription: string;

  exceptions: CaseException[];
  errorMessage?: string;
}

// ── Overall migration plan produced after all cases complete ─────────────────

export interface MigrationPlan {
  generatedAt: string;           // ISO timestamp
  instructionsVersion: string;
  cases: CaseAnalysis[];
  totalFilesAffected: number;
  totalExceptions: number;
  approved: boolean;             // set to true only via explicit user action
}

// ── Live progress streamed during analysis ───────────────────────────────────

export type AnalysisStatus =
  | "starting"
  | "loading-instructions"
  | "investigating"
  | "planning"
  | "validating"
  | "complete"
  | "error";

export interface AnalysisProgress {
  status: AnalysisStatus;
  message: string;
  currentCase?: string;
  completedCases: number;
  totalCases: number;
  investigationStep?: string;    // e.g. "Querying XP MCP for Controller Rendering template…"
}
