import { contextBridge, ipcRenderer } from "electron";

// ── Types (mirrored — no cross-module imports in .cts) ────────────────────────

interface FolderNode {
  name: string;
  fullPath: string;
  type: "folder" | "file";
  children?: FolderNode[];
}

interface ScanResult {
  totalFiles: number;
  tree: FolderNode[];
}

interface InventoryEntry {
  filePath: string;
  fileHash: string;
  itemId: string;
  parentId: string;
  templateId: string;
  sitecorePath: string;
  valid: true;
}

interface InventoryError {
  filePath: string;
  valid: false;
  error: string;
}

interface InventoryResult {
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

interface InventoryProgress {
  processed: number;
  total: number;
  currentFile: string;
  validSoFar: number;
  invalidSoFar: number;
  status: "scanning" | "processing" | "done" | "error";
  message: string;
}

interface RunInventoryResult {
  jobId: string;
  inventory: InventoryResult;
}

// ── Analysis types ────────────────────────────────────────────────────────────

interface DiscoveredTemplate {
  name: string;
  id: string;
  environment: "xp" | "sitecoreAI";
  path?: string;
}

interface PlannedFieldChange {
  field: string;
  from: string;
  to: string;
  description: string;
}

interface AffectedFile {
  filePath: string;
  itemId: string;
  sitecorePath: string;
  plannedChanges: PlannedFieldChange[];
}

interface CaseException {
  filePath?: string;
  itemId?: string;
  message: string;
  severity: "warning" | "error";
}

interface CaseAnalysis {
  caseId: string;
  caseName: string;
  status: "pending" | "investigating" | "planning" | "complete" | "failed" | "skipped";
  filesDiscovered: number;
  filesAffected: AffectedFile[];
  discoveredTemplates: DiscoveredTemplate[];
  patternDescription: string;
  exceptions: CaseException[];
  errorMessage?: string;
}

interface MigrationPlan {
  generatedAt: string;
  instructionsVersion: string;
  cases: CaseAnalysis[];
  totalFilesAffected: number;
  totalExceptions: number;
  approved: boolean;
}

interface AnalysisProgress {
  status: "starting" | "loading-instructions" | "investigating" | "planning" | "validating" | "complete" | "error";
  message: string;
  currentCase?: string;
  completedCases: number;
  totalCases: number;
  investigationStep?: string;
}

interface RunAnalysisResult {
  plan: MigrationPlan;
  mcpWarnings: string[];
}

interface McpConnectionStatus {
  xpConnected: boolean;
  sitecoreAiConnected: boolean;
  warnings: string[];
  errors: string[];
}

// ── Exposed API ───────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld("electronAPI", {
  // Folder picker
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("select-folder"),

  // Source folder tree scan (Step 2)
  scanSourceFolder: (folderPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke("scan-source-folder", folderPath),

  // Source inventory (Step 5)
  runInventory: (
    sourceFolder: string,
    destinationFolder: string,
    scopeFolder?: string,
  ): Promise<RunInventoryResult> =>
    ipcRenderer.invoke("run-inventory", sourceFolder, destinationFolder, scopeFolder),

  onInventoryProgress: (
    callback: (progress: InventoryProgress) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: InventoryProgress) => {
      callback(progress);
    };
    ipcRenderer.on("inventory-progress", listener);
    return () => ipcRenderer.removeListener("inventory-progress", listener);
  },

  // Check MCP connection status (Step 3 → MCP Status Check)
  checkMcpStatus: (): Promise<McpConnectionStatus> =>
    ipcRenderer.invoke("check-mcp-status"),

  // Analysis & plan (Step 4)
  runAnalysis: (scopeFolder: string): Promise<RunAnalysisResult> =>
    ipcRenderer.invoke("run-analysis", scopeFolder),

  onAnalysisProgress: (
    callback: (progress: AnalysisProgress) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) => {
      callback(progress);
    };
    ipcRenderer.on("analysis-progress", listener);
    return () => ipcRenderer.removeListener("analysis-progress", listener);
  },
});
