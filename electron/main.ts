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

import {
  createAgentApiFromEnv,
  type SitecoreAiAgentApi,
} from "../src/sitecoreai/agent-api.js";
import { applyMigrationPlan } from "../src/migration/rendering-migration.js";
import { runMigrationAnalysis } from "../src/migration/migration-runner.js";
import type {
  MigrationPlan,
  AnalysisProgress,
} from "../src/migration/analysis-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

const envPath = path.join(__dirname, "..", "..", ".env");
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
  console.warn("Could not load .env:", dotenvResult.error.message);
}

/* -------------------------------------------------------------------------- */
/* Application state                                                           */
/* -------------------------------------------------------------------------- */

let mainWindow: BrowserWindow | null = null;

/** Lazily-created Agent API client (reused across analysis runs). */
let agentApi: SitecoreAiAgentApi | null = null;

function getAgentApi(): SitecoreAiAgentApi {
  if (!agentApi) {
    agentApi = createAgentApiFromEnv();
  }

  return agentApi;
}

/* -------------------------------------------------------------------------- */
/* Window                                                                      */
/* -------------------------------------------------------------------------- */

function createWindow(): void {
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
    void mainWindow.loadFile(
      path.join(__dirname, "../renderer/index.html"),
    );
  } else {
    void mainWindow.loadURL("http://localhost:5173");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* -------------------------------------------------------------------------- */
/* Folder picker                                                               */
/* -------------------------------------------------------------------------- */

ipcMain.handle("select-folder", async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);

  const options: OpenDialogOptions = {
    title: "Select Folder",
    properties: ["openDirectory"],
  };

  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);

  return result.canceled || result.filePaths.length === 0
    ? null
    : result.filePaths[0];
});

/* -------------------------------------------------------------------------- */
/* Source folder scanning                                                      */
/* -------------------------------------------------------------------------- */

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

async function buildTree(
  directory: string,
): Promise<FolderNode[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const nodes: FolderNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath);

      if (containsYaml(children)) {
        nodes.push({
          name: entry.name,
          fullPath,
          type: "folder",
          children,
        });
      }
    } else if (
      entry.isFile() &&
      /\.(yml|yaml)$/.test(entry.name)
    ) {
      nodes.push({
        name: entry.name,
        fullPath,
        type: "file",
      });
    }
  }

  return nodes;
}

function containsYaml(nodes: FolderNode[]): boolean {
  return nodes.some(
    (n) =>
      n.type === "file" ||
      (n.children ? containsYaml(n.children) : false),
  );
}

function countFiles(nodes: FolderNode[]): number {
  return nodes.reduce(
    (sum, n) =>
      sum +
      (n.type === "file"
        ? 1
        : countFiles(n.children ?? [])),
    0,
  );
}

ipcMain.handle(
  "scan-source-folder",
  async (
    _event,
    folderPath: string,
  ): Promise<ScanResult> => {
    const s = await stat(folderPath);

    if (!s.isDirectory()) {
      throw new Error(`Not a directory: ${folderPath}`);
    }

    const tree = await buildTree(folderPath);

    return {
      totalFiles: countFiles(tree),
      tree,
    };
  },
);

/* -------------------------------------------------------------------------- */
/* SitecoreAI connection check                                                 */
/* -------------------------------------------------------------------------- */

export interface SitecoreAiConnectionStatus {
  connected: boolean;
  error?: string;
}

ipcMain.handle(
  "authenticate-sitecoreai",
  async (): Promise<SitecoreAiConnectionStatus> => {
    try {
      // Validate credentials by attempting a token request
      const api = getAgentApi();

      // Do a lightweight search to confirm the connection works
      await api.searchByName("__never__");

      return {
        connected: true,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      console.error(
        "SitecoreAI connection failed:",
        message,
      );

      return {
        connected: false,
        error: message,
      };
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Run analysis                                                                */
/* -------------------------------------------------------------------------- */

export interface RunAnalysisResult {
  plan: MigrationPlan;
}

ipcMain.handle(
  "run-analysis",
  async (
    event,
    scopeFolder: string,
  ): Promise<RunAnalysisResult> => {
    const sender = event.sender;

    const send = (progress: AnalysisProgress) => {
      if (!sender.isDestroyed()) {
        sender.send("analysis-progress", progress);
      }
    };

    send({
      status: "starting",
      message: "Connecting to SitecoreAI...",
      completedCases: 0,
      totalCases: 1,
    });

    const api = getAgentApi();

    const plan = await runMigrationAnalysis(
      scopeFolder,
      api,
      send,
    );

    return {
      plan,
    };
  },
);

/* -------------------------------------------------------------------------- */
/* Apply migration                                                             */
/* -------------------------------------------------------------------------- */

ipcMain.handle(
  "apply-migration",
  async (
    event,
    plan: MigrationPlan,
    sourceFolder: string,
    destinationFolder: string,
  ): Promise<{ applied: number; errors: string[] }> => {
    const sender = event.sender;

    return applyMigrationPlan(
      plan,
      {
        sourceRoot: sourceFolder,
        destinationRoot: destinationFolder,
      },
      (message) => {
        if (!sender.isDestroyed()) {
          sender.send("apply-progress", message);
        }
      },
    );
  },
);

/* -------------------------------------------------------------------------- */
/* Electron lifecycle                                                          */
/* -------------------------------------------------------------------------- */

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
