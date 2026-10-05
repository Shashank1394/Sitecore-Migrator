import type { InventoryResult } from "./source-inventory.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "pending"       // created, not yet started
  | "inventorying"  // source inventory in progress
  | "inventoried"   // inventory complete, ready for AI analysis
  | "analysing"     // AI analysis in progress (future step)
  | "done"          // migration complete
  | "failed";       // unrecoverable error

export interface MigrationJobFolders {
  source: string;
  destination: string;
}

// ── MigrationJob ──────────────────────────────────────────────────────────────

export class MigrationJob {
  readonly id: string;
  readonly folders: MigrationJobFolders;

  private _status: JobStatus = "pending";
  private _inventory: InventoryResult | null = null;
  private _error: string | null = null;
  private readonly _createdAt: Date;

  constructor(folders: MigrationJobFolders) {
    this.id = crypto.randomUUID();
    this.folders = folders;
    this._createdAt = new Date();
  }

  get status(): JobStatus {
    return this._status;
  }

  get inventory(): InventoryResult | null {
    return this._inventory;
  }

  get error(): string | null {
    return this._error;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  beginInventory(): void {
    this.assertStatus("pending");
    this._status = "inventorying";
  }

  completeInventory(result: InventoryResult): void {
    this.assertStatus("inventorying");
    this._inventory = result;
    this._status = "inventoried";
  }

  fail(message: string): void {
    this._error = message;
    this._status = "failed";
  }

  toJSON() {
    return {
      id: this.id,
      status: this._status,
      folders: this.folders,
      createdAt: this._createdAt.toISOString(),
      error: this._error,
      inventory: this._inventory
        ? {
            totalFiles: this._inventory.totalFiles,
            validFiles: this._inventory.validFiles,
            invalidFiles: this._inventory.invalidFiles,
            uniqueTemplates: this._inventory.uniqueTemplates.length,
            uniqueParents: this._inventory.uniqueParents.length,
            durationMs: this._inventory.durationMs,
          }
        : null,
    };
  }

  private assertStatus(expected: JobStatus): void {
    if (this._status !== expected) {
      throw new Error(
        `Invalid job transition: expected status "${expected}", got "${this._status}"`,
      );
    }
  }
}
