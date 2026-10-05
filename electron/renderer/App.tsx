import { useEffect, useRef, useState } from "react";
import type {
  AnalysisProgress,
  AffectedFile,
  CaseAnalysis,
  DiscoveredTemplate,
  FolderNode,
  InventoryProgress,
  InventoryResult,
  McpConnectionStatus,
  MigrationPlan,
  ScanResult,
} from "./electron.d.ts";

// ── Shared helpers ────────────────────────────────────────────────────────────

function shortPath(full: string, base: string): string {
  const rel = full.startsWith(base) ? full.slice(base.length) : full;
  return rel.replace(/\\/g, "/").replace(/^\//, "");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function guid(id: string): string {
  // Trim braces and lowercase for display
  return id.replace(/^\{|\}$/g, "").toLowerCase();
}

// ── Shared sub-components ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  warn?: boolean;
}) {
  const cls = [
    "stat-card",
    accent ? "stat-card--accent" : "",
    warn ? "stat-card--warn" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function TreeNode({ node, depth = 0 }: { node: FolderNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  if (node.type === "file") {
    return (
      <div className="tree-file" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
      </div>
    );
  }
  return (
    <div className="tree-folder">
      <button
        type="button"
        className="tree-folder-row"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tree-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="tree-icon">📁</span>
        <span className="tree-name">{node.name}</span>
      </button>
      {expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode key={child.fullPath} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page 1: Folders ───────────────────────────────────────────────────────────

function FolderPage({
  sourceFolder,
  destinationFolder,
  pickerError,
  onSelectSource,
  onSelectDestination,
  onContinue,
}: {
  sourceFolder: string;
  destinationFolder: string;
  pickerError: string;
  onSelectSource: () => void;
  onSelectDestination: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="content">
      <div className="card">
        <div className="card-header">
          <span className="step">01</span>
          <div>
            <h2>Source & Destination</h2>
            <p>Select the Sitecore XP serialization folder and the SitecoreAI output folder.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="source">Sitecore XP Serialization Folder</label>
          <div className="folder-input">
            <input id="source" type="text" value={sourceFolder} placeholder="Select your XP serialization folder" readOnly />
            <button type="button" onClick={onSelectSource}>Browse</button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="destination">SitecoreAI Serialization Folder</label>
          <div className="folder-input">
            <input id="destination" type="text" value={destinationFolder} placeholder="Select your SitecoreAI output folder" readOnly />
            <button type="button" onClick={onSelectDestination}>Browse</button>
          </div>
        </div>

        <div className="actions">
          <button className="primary-button" disabled={!sourceFolder || !destinationFolder} onClick={onContinue}>
            Continue <span>→</span>
          </button>
        </div>
        {pickerError && <p className="error-message">{pickerError}</p>}
      </div>
    </section>
  );
}

// ── Page 2: Source Files ──────────────────────────────────────────────────────

function ScanPage({
  sourceFolder, scanning, scanResult, scanError, onBack, onContinue,
}: {
  sourceFolder: string;
  scanning: boolean;
  scanResult: ScanResult | null;
  scanError: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="content">
      <div className="card scan-card">
        <div className="card-header">
          <span className="step">02</span>
          <div>
            <h2>Source YAML Files</h2>
            <p>YAML items found in <strong className="folder-pill">{sourceFolder}</strong></p>
          </div>
        </div>

        {scanning && <div className="scan-status"><span className="scan-spinner" /> Scanning for YAML files…</div>}
        {scanError && <p className="error-message">{scanError}</p>}

        {scanResult && !scanning && (
          <>
            <div className="scan-summary">
              <span className="scan-badge">{scanResult.totalFiles}</span>
              {scanResult.totalFiles === 1 ? "YAML file" : "YAML files"} found
            </div>
            {scanResult.totalFiles === 0
              ? <p className="scan-empty">No YAML files found. Make sure you selected a Sitecore XP serialization folder.</p>
              : <div className="tree-root">{scanResult.tree.map((n) => <TreeNode key={n.fullPath} node={n} depth={0} />)}</div>
            }
          </>
        )}

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          {scanResult && scanResult.totalFiles > 0 && (
            <button type="button" className="primary-button" onClick={onContinue}>
              Analyse Source <span>→</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Page 3: Select Migration Scope ────────────────────────────────────────────

function ScopeSelectPage({
  scanResult,
  onBack,
  onContinue,
}: {
  scanResult: ScanResult;
  onBack: () => void;
  onContinue: (scopeFolder: string) => void;
}) {
  const [selectedScope, setSelectedScope] = useState<string | null>(null);

  // Extract only top-level folders from the tree (no nested traversal)
  const topLevelFolders = scanResult.tree.filter((node) => node.type === "folder");

  function countFilesInScope(node: FolderNode): number {
    if (node.type === "file") return 1;
    let count = 0;
    if (node.children) {
      for (const child of node.children) {
        count += countFilesInScope(child);
      }
    }
    return count;
  }

  function handleSelectScope(fullPath: string) {
    console.log("🔍 ScopeSelectPage - User clicked folder card:", fullPath);
    setSelectedScope(fullPath);
  }

  function handleConfirm() {
    if (selectedScope) {
      console.log("🔍 ScopeSelectPage - User confirmed scope:", selectedScope);
      onContinue(selectedScope);
    }
  }

  return (
    <section className="content">
      <div className="card scope-card">
        <div className="card-header">
          <span className="step">03</span>
          <div>
            <h2>Select Migration Scope</h2>
            <p>Choose which folder to analyze and migrate. All YAML files under the selected folder will be included.</p>
          </div>
        </div>

        <div className="scope-grid-container">
          <div className="scope-grid">
            {topLevelFolders.length === 0 ? (
              <p className="scope-empty">No folders found. The source must contain at least one folder with YAML files.</p>
            ) : (
              topLevelFolders.map((folder) => {
                const fileCount = countFilesInScope(folder);
                const isSelected = selectedScope === folder.fullPath;
                return (
                  <div
                    key={folder.fullPath}
                    className={`scope-folder-card ${isSelected ? "scope-folder-card--selected" : ""}`}
                    onClick={() => handleSelectScope(folder.fullPath)}
                  >
                    <div className="scope-folder-icon">📁</div>
                    <div className="scope-folder-name">{folder.name}</div>
                    <div className="scope-folder-count">
                      {fileCount} file{fileCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {selectedScope && (
          <div className="scope-summary">
            <p className="scope-selected-label">Selected scope:</p>
            <p className="scope-selected-path">{selectedScope}</p>
          </div>
        )}

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedScope}
            onClick={handleConfirm}
          >
            Continue <span>→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Page 4: MCP Connection Status ─────────────────────────────────────────────

function McpStatusPage({
  mcpStatus,
  loading,
  onBack,
  onContinue,
}: {
  mcpStatus: McpConnectionStatus | null;
  loading: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const canProceed =
    mcpStatus && mcpStatus.xpConnected && mcpStatus.sitecoreAiConnected;

  return (
    <section className="content">
      <div className="card mcp-card">
        <div className="card-header">
          <span className="step">04</span>
          <div>
            <h2>MCP Connection Status</h2>
            <p>Verifying connection to Sitecore XP GraphQL and SitecoreAI MCP services.</p>
          </div>
        </div>

        {loading && (
          <div className="mcp-loading">
            <span className="scan-spinner" /> Checking MCP connections…
          </div>
        )}

        {mcpStatus && !loading && (
          <>
            <div className="mcp-status-grid">
              <div className={`mcp-status-item ${mcpStatus.xpConnected ? "mcp-status-connected" : "mcp-status-disconnected"}`}>
                <div className="mcp-status-icon">
                  {mcpStatus.xpConnected ? "✓" : "✕"}
                </div>
                <div className="mcp-status-info">
                  <div className="mcp-status-title">Sitecore XP GraphQL</div>
                  <div className="mcp-status-desc">
                    {mcpStatus.xpConnected ? "Connected" : "Not configured or unreachable"}
                  </div>
                </div>
              </div>

              <div className={`mcp-status-item ${mcpStatus.sitecoreAiConnected ? "mcp-status-connected" : "mcp-status-disconnected"}`}>
                <div className="mcp-status-icon">
                  {mcpStatus.sitecoreAiConnected ? "✓" : "✕"}
                </div>
                <div className="mcp-status-info">
                  <div className="mcp-status-title">SitecoreAI MCP</div>
                  <div className="mcp-status-desc">
                    {mcpStatus.sitecoreAiConnected ? "Connected" : "Not configured or unreachable"}
                  </div>
                </div>
              </div>
            </div>

            {mcpStatus.errors.length > 0 && (
              <div className="mcp-errors">
                <div className="mcp-errors-title">⚠ Configuration errors:</div>
                <div className="mcp-error-list">
                  {mcpStatus.errors.map((err, i) => (
                    <div key={i} className="mcp-error-item">{err}</div>
                  ))}
                </div>
              </div>
            )}

            {mcpStatus.warnings.length > 0 && (
              <div className="mcp-warnings">
                <div className="mcp-warnings-title">ℹ Warnings:</div>
                <div className="mcp-warning-list">
                  {mcpStatus.warnings.map((warn, i) => (
                    <div key={i} className="mcp-warning-item">{warn}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          <button
            type="button"
            className="primary-button"
            disabled={!canProceed || loading}
            onClick={onContinue}
          >
            Analyze & Plan <span>→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Page 5: Inventory ─────────────────────────────────────────────────────────

function InventoryPage({
  sourceFolder, progress, inventoryResult, inventoryError, onBack, onContinue,
}: {
  sourceFolder: string;
  destinationFolder: string;
  progress: InventoryProgress | null;
  inventoryResult: InventoryResult | null;
  inventoryError: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const running = progress !== null && progress.status !== "done" && progress.status !== "error";
  const pct = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  
  // Show the actual folder being scanned (from result if available, else from progress)
  const displayFolder = inventoryResult?.sourceDirectory || sourceFolder;

  return (
    <section className="content">
      <div className="card inventory-card">
        <div className="card-header">
          <span className="step">05</span>
          <div>
            <h2>Source Inventory</h2>
            <p>Building inventory from <strong className="folder-pill">{displayFolder}</strong></p>
          </div>
        </div>

        {progress && (
          <div className="inv-progress-block">
            <div className="inv-progress-header">
              <span className="inv-progress-label">{progress.message}</span>
              {progress.total > 0 && <span className="inv-progress-count">{progress.processed} / {progress.total}</span>}
            </div>
            <div className="inv-progress-bar-track">
              <div className={`inv-progress-bar-fill ${running ? "inv-progress-bar-fill--animated" : ""}`}
                style={{ width: `${progress.status === "scanning" ? 5 : pct}%` }} />
            </div>
            {running && progress.currentFile && (
              <p className="inv-current-file">{shortPath(progress.currentFile, sourceFolder)}</p>
            )}
          </div>
        )}

        {inventoryError && <p className="error-message">{inventoryError}</p>}

        {inventoryResult && (
          <>
            <div className="stat-grid">
              <StatCard label="Total files" value={inventoryResult.totalFiles} />
              <StatCard label="Valid" value={inventoryResult.validFiles} accent />
              <StatCard label="Invalid" value={inventoryResult.invalidFiles} warn={inventoryResult.invalidFiles > 0} />
              <StatCard label="Unique templates" value={inventoryResult.uniqueTemplates.length} />
              <StatCard label="Unique parents" value={inventoryResult.uniqueParents.length} />
              <StatCard label="Duration" value={formatDuration(inventoryResult.durationMs)} />
            </div>

            {inventoryResult.errors.length > 0 && (
              <details className="inv-errors">
                <summary className="inv-errors-summary">
                  {inventoryResult.errors.length} file{inventoryResult.errors.length !== 1 ? "s" : ""} could not be parsed
                </summary>
                <div className="inv-error-list">
                  {inventoryResult.errors.map((e) => (
                    <div key={e.filePath} className="inv-error-row">
                      <span className="inv-error-path">{shortPath(e.filePath, sourceFolder)}</span>
                      <span className="inv-error-msg">{e.error}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          {inventoryResult && inventoryResult.validFiles > 0 && (
            <button type="button" className="primary-button" onClick={onContinue}>
              Continue <span>→</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Case Status Badge ─────────────────────────────────────────────────────────

function CaseStatusBadge({ status }: { status: CaseAnalysis["status"] }) {
  const map: Record<CaseAnalysis["status"], { label: string; cls: string }> = {
    pending:       { label: "Pending",       cls: "badge--neutral" },
    investigating: { label: "Investigating", cls: "badge--active" },
    planning:      { label: "Planning",      cls: "badge--active" },
    complete:      { label: "Complete",      cls: "badge--success" },
    failed:        { label: "Failed",        cls: "badge--error" },
    skipped:       { label: "Skipped",       cls: "badge--neutral" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "badge--neutral" };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function TemplateChip({ t }: { t: DiscoveredTemplate }) {
  return (
    <div className="template-chip">
      <span className={`template-env ${t.environment === "xp" ? "env-xp" : "env-ai"}`}>
        {t.environment === "xp" ? "XP" : "AI"}
      </span>
      <span className="template-name">{t.name}</span>
      <code className="template-id">{guid(t.id)}</code>
    </div>
  );
}

function AnalysisPage({
  sourceFolder, progress, plan, analysisError, mcpWarnings, onBack, onContinue,
}: {
  sourceFolder: string;
  progress: AnalysisProgress | null;
  plan: MigrationPlan | null;
  analysisError: string;
  mcpWarnings: string[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const running = progress !== null && progress.status !== "complete" && progress.status !== "error";
  const pct = progress && progress.totalCases > 0
    ? Math.round((progress.completedCases / progress.totalCases) * 100)
    : 0;

  return (
    <section className="content">
      <div className="card analysis-card">
        <div className="card-header">
          <span className="step">06</span>
          <div>
            <h2>Analyze & Plan</h2>
            <p>AI investigation across <strong className="folder-pill">{sourceFolder}</strong></p>
          </div>
        </div>

        {/* MCP connectivity warnings */}
        {mcpWarnings.length > 0 && (
          <div className="mcp-warnings">
            <span className="mcp-warn-icon">⚠</span>
            <div>
              {mcpWarnings.map((w, i) => <p key={i} className="mcp-warn-text">{w}</p>)}
            </div>
          </div>
        )}

        {/* Live progress */}
        {progress && (
          <div className="inv-progress-block">
            <div className="inv-progress-header">
              <span className="inv-progress-label">{progress.message}</span>
              {progress.totalCases > 0 && (
                <span className="inv-progress-count">{progress.completedCases} / {progress.totalCases} cases</span>
              )}
            </div>
            <div className="inv-progress-bar-track">
              <div className={`inv-progress-bar-fill ${running ? "inv-progress-bar-fill--animated" : ""}`}
                style={{ width: `${running && progress.totalCases === 0 ? 5 : pct}%` }} />
            </div>
            {progress.currentCase && running && (
              <p className="inv-current-file">Current case: {progress.currentCase}</p>
            )}
            {progress.investigationStep && running && (
              <p className="inv-current-file analysis-step">{progress.investigationStep}</p>
            )}
          </div>
        )}

        {analysisError && <p className="error-message">{analysisError}</p>}

        {/* Case cards */}
        {plan && (
          <>
            <div className="analysis-summary-row">
              <StatCard label="Cases analysed" value={plan.cases.length} />
              <StatCard label="Files affected" value={plan.totalFilesAffected} accent />
              <StatCard label="Exceptions" value={plan.totalExceptions} warn={plan.totalExceptions > 0} />
            </div>

            <div className="case-list">
              {plan.cases.map((c) => (
                <div key={c.caseId} className={`case-card ${c.status === "failed" ? "case-card--failed" : ""}`}>
                  <div className="case-card-header">
                    <span className="case-name">{c.caseName}</span>
                    <CaseStatusBadge status={c.status} />
                  </div>

                  {c.patternDescription && c.status !== "failed" && (
                    <p className="case-pattern">Pattern: <strong>{c.patternDescription}</strong></p>
                  )}

                  <div className="case-stats">
                    <span>Files discovered: <strong>{c.filesDiscovered}</strong></span>
                    <span>Files affected: <strong>{c.filesAffected.length}</strong></span>
                    <span>Exceptions: <strong>{c.exceptions.length}</strong></span>
                  </div>

                  {c.discoveredTemplates.length > 0 && (
                    <div className="template-chips">
                      {c.discoveredTemplates.map((t) => <TemplateChip key={`${t.environment}-${t.id}`} t={t} />)}
                    </div>
                  )}

                  {c.exceptions.length > 0 && (
                    <details className="inv-errors">
                      <summary className="inv-errors-summary">
                        {c.exceptions.length} exception{c.exceptions.length !== 1 ? "s" : ""}
                      </summary>
                      <div className="inv-error-list">
                        {c.exceptions.map((ex, i) => (
                          <div key={i} className="inv-error-row">
                            <span className={`inv-error-path ${ex.severity === "error" ? "sev-error" : "sev-warn"}`}>
                              {ex.severity === "error" ? "✕" : "⚠"} {ex.filePath ? shortPath(ex.filePath, sourceFolder) : "—"}
                            </span>
                            <span className="inv-error-msg">{ex.message}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          {plan && plan.totalFilesAffected > 0 && (
            <button type="button" className="primary-button" onClick={onContinue}>
              Continue to Review Plan <span>→</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Page 5: Review & Approve ──────────────────────────────────────────────────

function AffectedFileRow({ file, base }: { file: AffectedFile; base: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="af-row">
      <button type="button" className="af-row-header" onClick={() => setOpen((v) => !v)}>
        <span className="tree-chevron">{open ? "▾" : "▸"}</span>
        <span className="af-path">{shortPath(file.filePath, base)}</span>
        <span className="af-change-count">{file.plannedChanges.length} change{file.plannedChanges.length !== 1 ? "s" : ""}</span>
      </button>
      {open && (
        <div className="af-changes">
          {file.plannedChanges.map((ch, i) => (
            <div key={i} className="af-change">
              <span className="af-field">{ch.field}</span>
              <span className="af-from"><code>{guid(ch.from)}</code></span>
              <span className="af-arrow">→</span>
              <span className="af-to"><code>{guid(ch.to)}</code></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewPage({
  sourceFolder, plan, onBack, onApprove,
}: {
  sourceFolder: string;
  plan: MigrationPlan;
  onBack: () => void;
  onApprove: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <section className="content">
      <div className="card review-card">
        <div className="card-header">
          <span className="step">07</span>
          <div>
            <h2>Review & Approve</h2>
            <p>Inspect every planned change before migration executes.</p>
          </div>
        </div>

        <div className="review-meta">
          <span>Plan generated: <strong>{new Date(plan.generatedAt).toLocaleString()}</strong></span>
          <span>Instructions version: <strong>{plan.instructionsVersion}</strong></span>
          <span>Total files affected: <strong>{plan.totalFilesAffected}</strong></span>
        </div>

        {plan.cases.map((c) => (
          <div key={c.caseId} className="review-case">
            <div className="review-case-header">
              <span className="case-name">{c.caseName}</span>
              <CaseStatusBadge status={c.status} />
            </div>

            {c.patternDescription && (
              <p className="case-pattern">Pattern: <strong>{c.patternDescription}</strong></p>
            )}

            {/* Template mappings */}
            {c.discoveredTemplates.length > 0 && (
              <div className="review-templates">
                <h4>Discovered templates</h4>
                <div className="template-chips">
                  {c.discoveredTemplates.map((t) => <TemplateChip key={`${t.environment}-${t.id}`} t={t} />)}
                </div>
              </div>
            )}

            {/* Affected files */}
            {c.filesAffected.length > 0 && (
              <div className="review-files">
                <h4>{c.filesAffected.length} affected file{c.filesAffected.length !== 1 ? "s" : ""}</h4>
                <div className="af-list">
                  {c.filesAffected.map((f) => (
                    <AffectedFileRow key={f.filePath} file={f} base={sourceFolder} />
                  ))}
                </div>
              </div>
            )}

            {/* Exceptions */}
            {c.exceptions.length > 0 && (
              <details className="inv-errors">
                <summary className="inv-errors-summary">
                  {c.exceptions.length} exception{c.exceptions.length !== 1 ? "s" : ""}
                </summary>
                <div className="inv-error-list">
                  {c.exceptions.map((ex, i) => (
                    <div key={i} className="inv-error-row">
                      <span className={`inv-error-path ${ex.severity === "error" ? "sev-error" : "sev-warn"}`}>
                        {ex.severity === "error" ? "✕" : "⚠"} {ex.filePath ? shortPath(ex.filePath, sourceFolder) : "—"}
                      </span>
                      <span className="inv-error-msg">{ex.message}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}

        {/* Approval gate */}
        <div className="approval-gate">
          <label className="approval-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have reviewed the migration plan and confirm that the changes above are correct.
            No YAML files will be modified until I click <strong>Approve & Migrate</strong>.
          </label>
        </div>

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>← Back</button>
          <button
            type="button"
            className="primary-button approve-button"
            disabled={!confirmed || plan.totalFilesAffected === 0}
            onClick={onApprove}
          >
            Approve & Migrate <span>→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

type Page = "folders" | "scan" | "scope-select" | "mcp-status" | "inventory" | "analysis" | "review";

const STEPS: { key: Page; label: string }[] = [
  { key: "folders",       label: "01 Folders" },
  { key: "scan",          label: "02 Source Files" },
  { key: "scope-select",  label: "03 Migration Scope" },
  { key: "mcp-status",    label: "04 MCP Status" },
  { key: "inventory",     label: "05 Inventory" },
  { key: "analysis",      label: "06 Analyze & Plan" },
  { key: "review",        label: "07 Review & Approve" },
];

export default function App() {
  const [page, setPage] = useState<Page>("folders");

  // Step 1
  const [sourceFolder, setSourceFolder] = useState("");
  const [destinationFolder, setDestinationFolder] = useState("");
  const [pickerError, setPickerError] = useState("");

  // Step 2
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  // Step 3 — scope selection
  const [selectedScope, setSelectedScope] = useState<string | null>(null);

  // Step 4 — MCP status
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus | null>(null);
  const [mcpStatusLoading, setMcpStatusLoading] = useState(false);

  // Step 5 — inventory
  const [inventoryProgress, setInventoryProgress] = useState<InventoryProgress | null>(null);
  const [inventoryResult, setInventoryResult] = useState<InventoryResult | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const invUnsubRef = useRef<(() => void) | null>(null);

  // Step 6 — analysis
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [mcpWarnings, setMcpWarnings] = useState<string[]>([]);
  const anlUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      invUnsubRef.current?.();
      anlUnsubRef.current?.();
    };
  }, []);

  // ── Folder picker ──

  async function selectFolder(setter: (f: string) => void) {
    setPickerError("");
    try {
      if (!window.electronAPI) throw new Error("The desktop integration is not available.");
      const folder = await window.electronAPI.selectFolder();
      if (folder) setter(folder);
    } catch (err) {
      setPickerError(err instanceof Error ? `Unable to open the folder picker: ${err.message}` : "Unable to open the folder picker.");
    }
  }

  // ── Page transitions ──

  async function handleFoldersContinue() {
    setScanResult(null); setScanError(""); setScanning(true); setPage("scan");
    try {
      const result = await window.electronAPI.scanSourceFolder(sourceFolder);
      setScanResult(result);
    } catch (err) {
      setScanError(err instanceof Error ? `Scan failed: ${err.message}` : "Unable to scan the folder.");
    } finally {
      setScanning(false);
    }
  }

  async function handleScanContinue() {
    setSelectedScope(null);
    setPage("scope-select");
  }

  async function handleScopeContinue(scopeFolder: string) {
    console.log("🔍 Scope Continue - Setting selectedScope to:", scopeFolder);
    setSelectedScope(scopeFolder);
    setMcpStatus(null);
    setMcpStatusLoading(true);
    setPage("mcp-status");
    try {
      const status = await window.electronAPI.checkMcpStatus();
      setMcpStatus(status);
    } catch (err) {
      setMcpStatus({
        xpConnected: false,
        sitecoreAiConnected: false,
        warnings: [],
        errors: [err instanceof Error ? err.message : "Failed to check MCP status"],
      });
    } finally {
      setMcpStatusLoading(false);
    }
  }

  async function handleMcpStatusContinue() {
    console.log("🔍 MCP Status Continue - selectedScope:", selectedScope);
    setInventoryProgress(null); setInventoryResult(null); setInventoryError("");
    invUnsubRef.current?.();
    const unsub = window.electronAPI.onInventoryProgress(setInventoryProgress);
    invUnsubRef.current = unsub;
    setPage("inventory");
    try {
      console.log("🔍 Calling runInventory with scope:", selectedScope || "undefined (using source)");
      const { inventory } = await window.electronAPI.runInventory(sourceFolder, destinationFolder, selectedScope || undefined);
      setInventoryResult(inventory);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Inventory failed.");
    } finally {
      unsub(); invUnsubRef.current = null;
    }
  }

  async function handleInventoryContinue() {
    setAnalysisProgress(null); setMigrationPlan(null); setAnalysisError(""); setMcpWarnings([]);
    anlUnsubRef.current?.();
    const unsub = window.electronAPI.onAnalysisProgress(setAnalysisProgress);
    anlUnsubRef.current = unsub;
    setPage("analysis");
    try {
      const scopeToAnalyze = selectedScope || sourceFolder;
      const { plan, mcpWarnings: warnings } = await window.electronAPI.runAnalysis(scopeToAnalyze);
      setMigrationPlan(plan);
      setMcpWarnings(warnings);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      unsub(); anlUnsubRef.current = null;
    }
  }

  function handleAnalysisContinue() { setPage("review"); }

  function handleApprove() {
    // Migrate step — not yet implemented
    // Plan is approved; next stage will execute transforms
  }

  // ── Breadcrumb ──

  const pageIndex = STEPS.findIndex((s) => s.key === page);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Sitecore Migration Workbench</h1>
          <p>Sitecore XP → SitecoreAI</p>
        </div>
        <nav className="breadcrumb">
          {STEPS.map((step, i) => (
            <span key={step.key} className="breadcrumb-item">
              {i > 0 && <span className="breadcrumb-sep">›</span>}
              <span className={["breadcrumb-step", i === pageIndex ? "active" : i < pageIndex ? "done" : ""].filter(Boolean).join(" ")}>
                {step.label}
              </span>
            </span>
          ))}
        </nav>
      </header>

      {page === "folders"       && <FolderPage sourceFolder={sourceFolder} destinationFolder={destinationFolder} pickerError={pickerError} onSelectSource={() => selectFolder(setSourceFolder)} onSelectDestination={() => selectFolder(setDestinationFolder)} onContinue={handleFoldersContinue} />}
      {page === "scan"          && <ScanPage sourceFolder={sourceFolder} scanning={scanning} scanResult={scanResult} scanError={scanError} onBack={() => setPage("folders")} onContinue={handleScanContinue} />}
      {page === "scope-select"  && scanResult && <ScopeSelectPage scanResult={scanResult} onBack={() => setPage("scan")} onContinue={handleScopeContinue} />}
      {page === "mcp-status"    && <McpStatusPage mcpStatus={mcpStatus} loading={mcpStatusLoading} onBack={() => setPage("scope-select")} onContinue={handleMcpStatusContinue} />}
      {page === "inventory"     && <InventoryPage sourceFolder={sourceFolder} destinationFolder={destinationFolder} progress={inventoryProgress} inventoryResult={inventoryResult} inventoryError={inventoryError} onBack={() => setPage("mcp-status")} onContinue={handleInventoryContinue} />}
      {page === "analysis"      && <AnalysisPage sourceFolder={sourceFolder} progress={analysisProgress} plan={migrationPlan} analysisError={analysisError} mcpWarnings={mcpWarnings} onBack={() => setPage("inventory")} onContinue={handleAnalysisContinue} />}
      {page === "review"        && migrationPlan && <ReviewPage sourceFolder={sourceFolder} plan={migrationPlan} onBack={() => setPage("analysis")} onApprove={handleApprove} />}
    </main>
  );
}
