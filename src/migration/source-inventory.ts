import { createHash } from "node:crypto";
import { readFile, appendFile } from "node:fs/promises";
import { scanYamlFiles } from "../yaml/yaml-scanner.js";
import { readYamlFile } from "../yaml/yaml-reader.js";

// ── Types ─────────────────────────────────────────────────────────────────────

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

export type InventoryRecord = InventoryEntry | InventoryError;

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

export type ProgressCallback = (progress: InventoryProgress) => void;

// ── Implementation ────────────────────────────────────────────────────────────

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export async function runSourceInventory(
  sourceDirectory: string,
  onProgress: ProgressCallback,
): Promise<InventoryResult> {
  const startedAt = Date.now();
  
  // Log to console and a debug file
  const debugMsg = `\n[${new Date().toISOString()}] runSourceInventory called with: ${sourceDirectory}`;
  console.log("🔍 SOURCE-INVENTORY:", debugMsg);
  try {
    await appendFile("/tmp/sitecore-migrator-debug.log", debugMsg);
  } catch {}

  // Phase 1: scan for file paths
  onProgress({
    processed: 0,
    total: 0,
    currentFile: "",
    validSoFar: 0,
    invalidSoFar: 0,
    status: "scanning",
    message: "Scanning for YAML files…",
  });

  const filePaths = await scanYamlFiles(sourceDirectory, true);
  const total = filePaths.length;

  const entries: InventoryEntry[] = [];
  const errors: InventoryError[] = [];
  const templateSet = new Set<string>();
  const parentSet = new Set<string>();

  // Phase 2: process each file
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i]!;

    try {
      const [item, fileHash] = await Promise.all([
        readYamlFile(filePath),
        hashFile(filePath),
      ]);

      // Validate required Sitecore fields
      if (!item.ID || !item.Parent || !item.Template || !item.Path) {
        throw new Error(
          `Missing required fields (ID, Parent, Template, or Path)`,
        );
      }

      entries.push({
        filePath,
        fileHash,
        itemId: item.ID,
        parentId: item.Parent,
        templateId: item.Template,
        sitecorePath: item.Path,
        valid: true,
      });

      templateSet.add(item.Template);
      parentSet.add(item.Parent);
    } catch (err) {
      errors.push({
        filePath,
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Send progress update AFTER processing the file
    onProgress({
      processed: i + 1,
      total,
      currentFile: filePath,
      validSoFar: entries.length,
      invalidSoFar: errors.length,
      status: "processing",
      message: `Processing file ${i + 1} of ${total}…`,
    });
  }

  const durationMs = Date.now() - startedAt;

  const result: InventoryResult = {
    sourceDirectory,
    totalFiles: total,
    validFiles: entries.length,
    invalidFiles: errors.length,
    uniqueTemplates: Array.from(templateSet),
    uniqueParents: Array.from(parentSet),
    entries,
    errors,
    durationMs,
  };

  onProgress({
    processed: total,
    total,
    currentFile: "",
    validSoFar: entries.length,
    invalidSoFar: errors.length,
    status: "done",
    message: `Inventory complete. ${entries.length} valid, ${errors.length} invalid.`,
  });

  return result;
}
