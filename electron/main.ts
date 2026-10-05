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

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: "Sitecore Migration Workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
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
  async (event, sourceFolder: string, destinationFolder: string): Promise<RunInventoryResult> => {
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
      const inventory = await runSourceInventory(sourceFolder, sendProgress);
      job.completeInventory(inventory);
      return { jobId: job.id, inventory };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.fail(message);
      throw new Error(`Inventory failed: ${message}`);
    }
  },
);

// ── Analysis / plan ───────────────────────────────────────────────────────────

export interface RunAnalysisResult {
  plan: MigrationPlan;
  mcpWarnings: string[];
}

ipcMain.handle(
  "run-analysis",
  async (event, sourceFolder: string): Promise<RunAnalysisResult> => {
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

    const plan = await runAnalysis(sourceFolder, clients, sendProgress);
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
