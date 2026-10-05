import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, stat } from "node:fs/promises";
import dotenv from "dotenv";
import { MigrationJob } from "../src/migration/migration-job.js";
import {
  runSourceInventory,
  type InventoryProgress,
  type InventoryResult,
} from "../src/migration/source-inventory.js";
import { runAnalysis, type AnalysisProgressCallback } from "../src/migration/plan-runner.js";
import { buildMcpClients } from "./mcp-client-factory.js";
import type { MigrationPlan, AnalysisProgress } from "../src/migration/analysis-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
// In both dev and production, __dirname is dist/electron
// We need to go up 2 levels to reach the project root where .env lives
const envPath = path.join(__dirname, "..", "..", ".env");
const dotenvResult = dotenv.config({ path: envPath });

// Debug: Log what was loaded
console.log("🔍 DotENV loaded from:", envPath);
console.log("🔍 DotENV result:", {
  parsed: dotenvResult.parsed ? Object.keys(dotenvResult.parsed) : null,
  error: dotenvResult.error?.message,
});
console.log("🔍 SITECORE_XP_GRAPHQL_ENDPOINT:", process.env.SITECORE_XP_GRAPHQL_ENDPOINT);
console.log("🔍 SITECORE_XP_GRAPHQL_API_KEY:", process.env.SITECORE_XP_GRAPHQL_API_KEY);
console.log("🔍 SITECORE_AI_ENDPOINT:", process.env.SITECORE_AI_ENDPOINT);
console.log("🔍 SITECORE_AI_API_KEY:", process.env.SITECORE_AI_API_KEY);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // The preload script is always compiled to dist/electron/preload.cjs
  // __dirname in the compiled main.js is dist/electron
  const preloadPath = path.join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: "Sitecore Migration Workbench",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    void mainWindow.loadURL("http://localhost:5173");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("select-folder", async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: "Select Folder",
    properties: ["openDirectory"],
  };
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

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

async function buildTree(directory: string): Promise<FolderNode[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nodes: FolderNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath);
      // Only include folders that contain at least one YAML file (directly or nested)
      const hasYaml = containsYaml(children);
      if (hasYaml) {
        nodes.push({ name: entry.name, fullPath, type: "folder", children });
      }
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    ) {
      nodes.push({ name: entry.name, fullPath, type: "file" });
    }
  }

  return nodes;
}

function containsYaml(nodes: FolderNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "file") return true;
    if (node.children && containsYaml(node.children)) return true;
  }
  return false;
}

function countFiles(nodes: FolderNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "file") count++;
    else if (node.children) count += countFiles(node.children);
  }
  return count;
}

ipcMain.handle("scan-source-folder", async (_event, folderPath: string): Promise<ScanResult> => {
  try {
    await stat(folderPath);
  } catch {
    throw new Error(`Folder not found: ${folderPath}`);
  }

  const tree = await buildTree(folderPath);
  const totalFiles = countFiles(tree);

  return { totalFiles, tree };
});

// ── Migration job store (in-memory, one job at a time) ────────────────────────

let activeJob: MigrationJob | null = null;

export interface RunInventoryResult {
  jobId: string;
  inventory: InventoryResult;
}

ipcMain.handle(
  "run-inventory",
  async (event, sourceFolder: string, destinationFolder: string, scopeFolder?: string): Promise<RunInventoryResult> => {
    // If scopeFolder is provided, use it; otherwise use sourceFolder (for backwards compatibility)
    const folderToInventory = scopeFolder || sourceFolder;
    
    console.log("🔍 ===== INVENTORY HANDLER CALLED =====");
    console.log("  Source folder:", sourceFolder);
    console.log("  Destination folder:", destinationFolder);
    console.log("  Scope folder (param):", scopeFolder);
    console.log("  Scope is null?", scopeFolder === null);
    console.log("  Scope is undefined?", scopeFolder === undefined);
    console.log("  Scope is empty string?", scopeFolder === "");
    console.log("  Scope type:", typeof scopeFolder);
    console.log("  Using folder:", folderToInventory);
    console.log("  Folders are different?", folderToInventory !== sourceFolder ? "YES - SCOPE APPLIED!" : "NO - USING FULL SOURCE");
    
    // Verify the folder exists
    try {
      const stats = await stat(folderToInventory);
      console.log("  Folder exists:", stats.isDirectory() ? "YES (directory)" : "YES (but not a directory!)");
    } catch (err) {
      console.log("  Folder exists: NO -", err instanceof Error ? err.message : String(err));
    }
    
    const job = new MigrationJob({ source: sourceFolder, destination: destinationFolder });
    activeJob = job;

    const sender = event.sender;

    job.beginInventory();

    const sendProgress = (progress: InventoryProgress) => {
      if (!sender.isDestroyed()) {
        sender.send("inventory-progress", progress);
      }
    };

    try {
      const inventory = await runSourceInventory(folderToInventory, sendProgress);
      job.completeInventory(inventory);
      return { jobId: job.id, inventory };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.fail(message);
      throw new Error(`Inventory failed: ${message}`);
    }
  },
);

// ── MCP connection status ─────────────────────────────────────────────────────

export interface McpConnectionStatus {
  xpConnected: boolean;
  sitecoreAiConnected: boolean;
  warnings: string[];
  errors: string[];
}

ipcMain.handle("check-mcp-status", async (): Promise<McpConnectionStatus> => {
  const { clients, status } = buildMcpClients();

  console.log("🔍 MCP Status Check:");
  console.log("  XP connected:", status.xpConnected);
  console.log("  SitecoreAI connected:", status.sitecoreAiConnected);
  console.log("  Warnings:", status.warnings);

  // Validate that critical clients work
  const errors: string[] = [];

  if (!status.xpConnected) {
    errors.push("Sitecore XP MCP is not configured. Set SITECORE_XP_GRAPHQL_ENDPOINT and SITECORE_XP_GRAPHQL_API_KEY.");
  }

  if (!status.sitecoreAiConnected) {
    errors.push("SitecoreAI MCP is not configured. Set SITECORE_AI_ENDPOINT and SITECORE_AI_API_KEY.");
  }

  console.log("  Errors:", errors);

  return {
    xpConnected: status.xpConnected,
    sitecoreAiConnected: status.sitecoreAiConnected,
    warnings: status.warnings,
    errors,
  };
});

// ── Analysis / plan ───────────────────────────────────────────────────────────

export interface RunAnalysisResult {
  plan: MigrationPlan;
  mcpWarnings: string[];
}

ipcMain.handle(
  "run-analysis",
  async (event, scopeFolder: string): Promise<RunAnalysisResult> => {
    const sender = event.sender;

    const sendProgress = (progress: AnalysisProgress) => {
      if (!sender.isDestroyed()) {
        sender.send("analysis-progress", progress);
      }
    };

    const { clients, status } = buildMcpClients();

    // Notify renderer immediately about MCP connectivity
    sendProgress({
      status: "starting",
      message: status.warnings.length
        ? `Starting analysis (warnings: ${status.warnings.join("; ")})`
        : "Starting analysis…",
      completedCases: 0,
      totalCases: 0,
    });

    const plan = await runAnalysis(scopeFolder, clients, sendProgress);
    return { plan, mcpWarnings: status.warnings };
  },
);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
