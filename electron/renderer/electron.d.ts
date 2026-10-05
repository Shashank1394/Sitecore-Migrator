export {};

// ── MCP connection types ─────────────────────────────────────────────────────

export interface McpConnectionStatus {
  xpConnected: boolean;
  sitecoreAiConnected: boolean;
  warnings: string[];
  errors: string[];
}

// ── Folder scan types ─────────────────────────────────────────────────────────

export interface FolderNode {
  name: string;
  fullPath: string;
  type: "folder" | "file";
  children?: FolderNode[];
}

export interface ScanResult {
  totalFiles: number;
  tree: FolderNode[];
}

// ── Inventory types ───────────────────────────────────────────────────────────

export interface InventoryEntry {
  filePath: string;
  fileHash: string;
  itemId: string;
  parentId: string;
  templateId: string;
  sitecorePath: string;
  valid: true;
}

export interface InventoryError {
  filePath: string;
  valid: false;
  error: string;
}

export interface InventoryResult {
  sourceDirectory: string;
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  uniqueTemplates: string[];
  uniqueParents: string[];
  entries: InventoryEntry[];
  errors: InventoryError[];
  durationMs: number;
}

export interface InventoryProgress {
  processed: number;
  total: number;
  currentFile: string;
  validSoFar: number;
  invalidSoFar: number;
  status: "scanning" | "processing" | "done" | "error";
  message: string;
}

export interface RunInventoryResult {
  jobId: string;
  inventory: InventoryResult;
}

// ── Analysis types ────────────────────────────────────────────────────────────

export interface DiscoveredTemplate {
  name: string;
  id: string;
  environment: "xp" | "sitecoreAI";
  path?: string;
}

export interface PlannedFieldChange {
  field: string;
  from: string;
  to: string;
  description: string;
}

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

export type CaseAnalysisStatus =
  | "pending"
  | "investigating"
  | "planning"
  | "complete"
  | "failed"
  | "skipped";

export interface CaseAnalysis {
  caseId: string;
  caseName: string;
  status: CaseAnalysisStatus;
  filesDiscovered: number;
  filesAffected: AffectedFile[];
  discoveredTemplates: DiscoveredTemplate[];
  patternDescription: string;
  exceptions: CaseException[];
  errorMessage?: string;
}

export interface MigrationPlan {
  generatedAt: string;
  instructionsVersion: string;
  cases: CaseAnalysis[];
  totalFilesAffected: number;
  totalExceptions: number;
  approved: boolean;
}

export interface AnalysisProgress {
  status:
    | "starting"
    | "loading-instructions"
    | "investigating"
    | "planning"
    | "validating"
    | "complete"
    | "error";
  message: string;
  currentCase?: string;
  completedCases: number;
  totalCases: number;
  investigationStep?: string;
}

export interface RunAnalysisResult {
  plan: MigrationPlan;
  mcpWarnings: string[];
}

// ── Window augmentation ───────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>;
      scanSourceFolder: (folderPath: string) => Promise<ScanResult>;
      runInventory: (
        sourceFolder: string,
        destinationFolder: string,
        scopeFolder?: string,
      ) => Promise<RunInventoryResult>;
      onInventoryProgress: (
        callback: (progress: InventoryProgress) => void,
      ) => () => void;
      checkMcpStatus: () => Promise<McpConnectionStatus>;
      runAnalysis: (scopeFolder: string) => Promise<RunAnalysisResult>;
      onAnalysisProgress: (
        callback: (progress: AnalysisProgress) => void,
      ) => () => void;
    };
  }
}
