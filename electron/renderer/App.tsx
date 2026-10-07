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

// ── Page 4: SitecoreAI Authentication ─────────────────────────────────────────

interface SitecoreAIAuthState {
  authenticated: boolean;
  authenticating: boolean;
  error: string;
}

function SitecoreAIAuthPage({
  authState,
  onAuthenticate,
  onBack,
  onContinue,
}: {
  authState: SitecoreAIAuthState;
  onAuthenticate: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="content">
      <div className="card sitecoreai-auth-card">
        <div className="card-header">
          <span className="step">04</span>
          <div>
            <h2>SitecoreAI Authentication</h2>
            <p>Connect to SitecoreAI MCP server to enable AI-powered template discovery</p>
          </div>
        </div>

        <div className="auth-container">
          {!authState.authenticated && !authState.authenticating && (
            <div className="auth-prompt">
              <div className="auth-icon">🔐</div>
              <h3>SitecoreAI Authentication</h3>
              <p className="auth-description">
                When you connect, a browser window will open automatically for you to sign in to your SitecoreAI account.
                The authentication is handled securely by the Marketer MCP server.
              </p>
              <button
                type="button"
                className="primary-button auth-button"
                onClick={onAuthenticate}
              >
                Connect to SitecoreAI
              </button>
            </div>
          )}

          {authState.authenticating && (
            <div className="auth-loading">
              <span className="scan-spinner" />
              <p>Preparing SitecoreAI MCP connection...</p>
              <p className="auth-hint">A browser window will open for authentication if needed</p>
            </div>
          )}

          {authState.authenticated && (
            <div className="auth-success">
              <div className="auth-success-icon">✓</div>
              <h3>Connected to SitecoreAI</h3>
              <p className="auth-ready">Ready to analyze templates</p>
            </div>
          )}

          {authState.error && (
            <div className="auth-error">
              <div className="auth-error-icon">✕</div>
              <p className="auth-error-message">{authState.error}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={onAuthenticate}
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <div className="actions actions-spaced">
          <button type="button" className="secondary-button" onClick={onBack}>
            ← Back
          </button>
          {authState.authenticated && (
            <button type="button" className="primary-button" onClick={onContinue}>
              Analyze with AI <span>→</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Page 5: Inventory ─────────────────────────────────────────────────────────

// ── Case Status Badge ─────────────────────────────────────────────────────────

function CaseStatusBadge({ status }: { status: CaseAnalysis["status"] }) {
  const map: Record<CaseAnalysis["status"], { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "badge--neutral" },
    investigating: { label: "Investigating", cls: "badge--active" },
    planning: { label: "Planning", cls: "badge--active" },
    complete: { label: "Complete", cls: "badge--success" },
    failed: { label: "Failed", cls: "badge--error" },
    skipped: { label: "Skipped", cls: "badge--neutral" },
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
  sourceFolder,
  progress,
  plan,
  analysisError,
  onBack,
  onContinue,
}: {
  sourceFolder: string;
  progress: AnalysisProgress | null;
  plan: MigrationPlan | null;
  analysisError: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const running =
    progress !== null &&
    progress.status !== "complete" &&
    progress.status !== "error";

  const pct =
    progress && progress.totalCases > 0
      ? Math.round(
          (progress.completedCases / progress.totalCases) * 100,
        )
      : 0;

  const selectedFolderName =
    sourceFolder.split(/[\\/]/).filter(Boolean).pop() ?? sourceFolder;

  return (
    <section className="content">
      <div className="card analysis-card">

        {/* Header */}
        <div className="card-header">
          <span className="step">05</span>

          <div>
            <h2>AI-Powered Analysis</h2>
            <p>
              Analyzing the selected migration folder using SitecoreAI Agent
              API.
            </p>
          </div>
        </div>

        {/* Selected folder */}
        <div className="analysis-folder-info">
          <div>
            <span className="analysis-info-label">Selected folder</span>
            <strong className="folder-pill">
              {selectedFolderName}
            </strong>
          </div>

          <div>
            <span className="analysis-info-label">Path</span>
            <span className="analysis-folder-path">
              {sourceFolder}
            </span>
          </div>
        </div>

        {/* Migration type */}
        <div className="analysis-migration-info">
          <div>
            <span className="analysis-info-label">
              Migration
            </span>

            <strong className="analysis-migration-value">
              Controller Rendering → Json Rendering
            </strong>
          </div>

          {plan && (
            <div>
              <span className="analysis-info-label">
                Files to update
              </span>

              <strong className="analysis-files-count">
                {plan.totalFilesAffected}
              </strong>
            </div>
          )}
        </div>

        {/* Live progress */}
        {progress && (
          <div className="inv-progress-block">
            <div className="inv-progress-header">
              <span className="inv-progress-label">
                {progress.message}
              </span>

              {progress.totalCases > 0 && (
                <span className="inv-progress-count">
                  {progress.completedCases} / {progress.totalCases} cases
                </span>
              )}
            </div>

            <div className="inv-progress-bar-track">
              <div
                className={`inv-progress-bar-fill ${
                  running
                    ? "inv-progress-bar-fill--animated"
                    : ""
                }`}
                style={{
                  width: `${
                    running && progress.totalCases === 0
                      ? 5
                      : pct
                  }%`,
                }}
              />
            </div>

            {progress.currentCase && running && (
              <p className="inv-current-file">
                Current case: {progress.currentCase}
              </p>
            )}

            {progress.investigationStep && running && (
              <p className="inv-current-file analysis-step">
                {progress.investigationStep}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {analysisError && (
          <p className="error-message">
            {analysisError}
          </p>
        )}

        {/* Case cards */}
        {plan && (
          <>
            <div className="analysis-summary-row">
              <StatCard
                label="Files scanned"
                value={plan.cases.reduce(
                  (total, c) => total + c.filesDiscovered,
                  0,
                )}
              />

              <StatCard
                label="Files affected"
                value={plan.totalFilesAffected}
                accent
              />

              <StatCard
                label="Exceptions"
                value={plan.totalExceptions}
                warn={plan.totalExceptions > 0}
              />
            </div>

            <div className="case-list">
              {plan.cases.map((c) => (
                <div
                  key={c.caseId}
                  className={`case-card ${
                    c.status === "failed"
                      ? "case-card--failed"
                      : ""
                  }`}
                >
                  <div className="case-card-header">
                    <span className="case-name">
                      {c.caseName}
                    </span>

                    <CaseStatusBadge status={c.status} />
                  </div>

                  {c.patternDescription &&
                    c.status !== "failed" && (
                      <p className="case-pattern">
                        Pattern:{" "}
                        <strong>
                          {c.patternDescription}
                        </strong>
                      </p>
                    )}

                  <div className="case-stats">
                    <span>
                      Files discovered:{" "}
                      <strong>
                        {c.filesDiscovered}
                      </strong>
                    </span>

                    <span>
                      Files affected:{" "}
                      <strong>
                        {c.filesAffected.length}
                      </strong>
                    </span>

                    <span>
                      Exceptions:{" "}
                      <strong>
                        {c.exceptions.length}
                      </strong>
                    </span>
                  </div>

                  {c.discoveredTemplates.length > 0 && (
                    <div className="template-chips">
                      {c.discoveredTemplates.map((t) => (
                        <TemplateChip
                          key={`${t.environment}-${t.id}`}
                          t={t}
                        />
                      ))}
                    </div>
                  )}

                  {c.exceptions.length > 0 && (
                    <details className="inv-errors">
                      <summary className="inv-errors-summary">
                        {c.exceptions.length} exception
                        {c.exceptions.length !== 1
                          ? "s"
                          : ""}
                      </summary>

                      <div className="inv-error-list">
                        {c.exceptions.map((ex, i) => (
                          <div
                            key={i}
                            className="inv-error-row"
                          >
                            <span
                              className={`inv-error-path ${
                                ex.severity === "error"
                                  ? "sev-error"
                                  : "sev-warn"
                              }`}
                            >
                              {ex.severity === "error"
                                ? "✕"
                                : "⚠"}{" "}
                              {ex.filePath
                                ? shortPath(
                                    ex.filePath,
                                    sourceFolder,
                                  )
                                : "—"}
                            </span>

                            <span className="inv-error-msg">
                              {ex.message}
                            </span>
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

        {/* Actions */}
        <div className="actions actions-spaced">
          <button
            type="button"
            className="secondary-button"
            onClick={onBack}
          >
            ← Back
          </button>

          {plan &&
            plan.totalFilesAffected > 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={onContinue}
              >
                Continue to Review Plan{" "}
                <span>→</span>
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
  sourceFolder,
  plan,
  onBack,
  onApprove,
}: {
  sourceFolder: string;
  plan: MigrationPlan;
  onBack: () => void;
  onApprove: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  const selectedFolderName =
    sourceFolder.split(/[\\/]/).filter(Boolean).pop() ?? sourceFolder;

  const filesScanned = plan.cases.reduce(
    (total, c) => total + c.filesDiscovered,
    0,
  );

  return (
    <section className="content">
      <div className="card review-card">
        {/* Header */}
        <div className="card-header">
          <span className="step">06</span>

          <div>
            <h2>Review & Approve</h2>
            <p>
              Review the changes that will be applied to the selected
              migration folder before anything is modified.
            </p>
          </div>
        </div>

        {/* Selected folder */}
        <div className="review-folder-info">
          <div>
            <span className="review-info-label">
              Selected folder
            </span>

            <strong className="folder-pill">
              {selectedFolderName}
            </strong>
          </div>

          <div>
            <span className="review-info-label">
              Source path
            </span>

            <span className="review-folder-path">
              {sourceFolder}
            </span>
          </div>
        </div>

        {/* Migration summary */}
        <div className="review-migration-summary">
          <div className="review-summary-item">
            <span className="review-info-label">
              Migration
            </span>

            <strong>
              Controller Rendering → Json Rendering
            </strong>
          </div>

          <div className="review-summary-item">
            <span className="review-info-label">
              Files scanned
            </span>

            <strong>{filesScanned}</strong>
          </div>

          <div className="review-summary-item">
            <span className="review-info-label">
              Files to update
            </span>

            <strong>{plan.totalFilesAffected}</strong>
          </div>

          <div className="review-summary-item">
            <span className="review-info-label">
              Exceptions
            </span>

            <strong
              className={
                plan.totalExceptions > 0
                  ? "review-exception-count"
                  : ""
              }
            >
              {plan.totalExceptions}
            </strong>
          </div>
        </div>

        {/* Plan metadata */}
        <div className="review-meta">
          <span>
            Plan generated:{" "}
            <strong>
              {new Date(
                plan.generatedAt,
              ).toLocaleString()}
            </strong>
          </span>

          <span>
            Instructions version:{" "}
            <strong>
              {plan.instructionsVersion}
            </strong>
          </span>
        </div>

        {/* Cases */}
        {plan.cases.map((c) => (
          <div
            key={c.caseId}
            className="review-case"
          >
            <div className="review-case-header">
              <span className="case-name">
                {c.caseName}
              </span>

              <CaseStatusBadge
                status={c.status}
              />
            </div>

            {c.patternDescription && (
              <p className="case-pattern">
                Pattern:{" "}
                <strong>
                  {c.patternDescription}
                </strong>
              </p>
            )}

            {/* Template mappings */}
            {c.discoveredTemplates.length > 0 && (
              <div className="review-templates">
                <h4>Discovered templates</h4>

                <div className="template-chips">
                  {c.discoveredTemplates.map((t) => (
                    <TemplateChip
                      key={`${t.environment}-${t.id}`}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Affected files */}
            {c.filesAffected.length > 0 && (
              <div className="review-files">
                <h4>
                  {c.filesAffected.length} affected file
                  {c.filesAffected.length !== 1
                    ? "s"
                    : ""}
                </h4>

                <div className="af-list">
                  {c.filesAffected.map((f) => (
                    <AffectedFileRow
                      key={f.filePath}
                      file={f}
                      base={sourceFolder}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Exceptions */}
            {c.exceptions.length > 0 && (
              <details className="inv-errors">
                <summary className="inv-errors-summary">
                  {c.exceptions.length} exception
                  {c.exceptions.length !== 1
                    ? "s"
                    : ""}
                </summary>

                <div className="inv-error-list">
                  {c.exceptions.map((ex, i) => (
                    <div
                      key={i}
                      className="inv-error-row"
                    >
                      <span
                        className={`inv-error-path ${
                          ex.severity === "error"
                            ? "sev-error"
                            : "sev-warn"
                        }`}
                      >
                        {ex.severity === "error"
                          ? "✕"
                          : "⚠"}{" "}
                        {ex.filePath
                          ? shortPath(
                              ex.filePath,
                              sourceFolder,
                            )
                          : "—"}
                      </span>

                      <span className="inv-error-msg">
                        {ex.message}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}

        {/* What will happen */}
        <div className="review-action-summary">
          <h4>What will happen when you approve</h4>

          <p>
            The selected{" "}
            <strong>{selectedFolderName}</strong>{" "}
            folder will be copied to the output directory.
            Only the YAML files listed above will have their{" "}
            <strong>Template</strong> changed from{" "}
            <strong>Controller Rendering</strong> to{" "}
            <strong>Json Rendering</strong>.
          </p>

          <p>
            The original source files will not be modified.
          </p>
        </div>

        {/* Approval gate */}
        <div className="approval-gate">
          <label className="approval-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) =>
                setConfirmed(e.target.checked)
              }
            />

            <span>
              I have reviewed the migration plan and confirm
              that the changes above are correct. No YAML files
              will be modified until I click{" "}
              <strong>Approve & Migrate</strong>.
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="actions actions-spaced">
          <button
            type="button"
            className="secondary-button"
            onClick={onBack}
          >
            ← Back
          </button>

          <button
            type="button"
            className="primary-button approve-button"
            disabled={
              !confirmed ||
              plan.totalFilesAffected === 0
            }
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

type Page = "folders" | "scan" | "scope-select" | "sitecoreai-auth" | "analysis" | "review";

const STEPS: { key: Page; label: string }[] = [
  { key: "folders", label: "01 Folders" },
  { key: "scan", label: "02 Source Files" },
  { key: "scope-select", label: "03 Migration Scope" },
  { key: "sitecoreai-auth", label: "04 SitecoreAI Auth" },
  { key: "analysis", label: "05 Analyze & Plan" },
  { key: "review", label: "06 Review & Approve" },
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

  // Step 4 — SitecoreAI authentication
  const [sitecoreAIAuth, setSitecoreAIAuth] = useState<{
    authenticated: boolean;
    authenticating: boolean;
    error: string;
    serverUrl?: string;
  }>({
    authenticated: false,
    authenticating: false,
    error: "",
  });

  // Step 5 — analysis
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const anlUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
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
    setSitecoreAIAuth({
      authenticated: false,
      authenticating: false,
      error: "",
    });
    setPage("sitecoreai-auth");
  }

  async function handleAuthenticateSitecoreAI() {
    setSitecoreAIAuth((prev) => ({ ...prev, authenticating: true, error: "" }));
    try {
      const result = await window.electronAPI.authenticateSitecoreAI();
      setSitecoreAIAuth({
        authenticated: result.connected,
        authenticating: false,
        error: result.connected ? "" : (result.error || "Connection failed"),
      });
    } catch (err) {
      setSitecoreAIAuth({
        authenticated: false,
        authenticating: false,
        error: err instanceof Error ? err.message : "Authentication failed",
      });
    }
  }

  async function handleAuthContinue() {
    if (!selectedScope) {
      setAnalysisError("Please select a migration folder before continuing.");
      return;
    }

    setAnalysisProgress(null);
    setMigrationPlan(null);
    setAnalysisError("");

    anlUnsubRef.current?.();

    const unsub = window.electronAPI.onAnalysisProgress(
      setAnalysisProgress,
    );

    anlUnsubRef.current = unsub;
    setPage("analysis");

    try {
      // IMPORTANT:
      // Analysis is restricted to the folder explicitly selected
      // by the user. Do not fall back to the parent source folder.
      const { plan } = await window.electronAPI.runAnalysis(
        selectedScope,
      );

      setMigrationPlan(plan);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "Analysis failed.",
      );
    } finally {
      unsub();
      anlUnsubRef.current = null;
    }
  }

  function handleAnalysisContinue() { setPage("review"); }

  function handleApprove() {
    if (!migrationPlan || !selectedScope) return;

    void (async () => {
      try {
        const { applied, errors } =
          await window.electronAPI.applyMigration(
            migrationPlan,
            selectedScope,
            destinationFolder,
          );

        alert(
          `Migration complete!\n\n` +
          `✓ ${applied} file(s) updated.\n\n` +
          `Output folder: ${destinationFolder}` +
          (errors.length > 0
            ? `\n\n⚠ ${errors.length} error(s):\n${errors.join("\n")}`
            : ""),
        );
      } catch (err) {
        alert(
          `Migration failed: ${err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
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

      {page === "folders" && <FolderPage sourceFolder={sourceFolder} destinationFolder={destinationFolder} pickerError={pickerError} onSelectSource={() => selectFolder(setSourceFolder)} onSelectDestination={() => selectFolder(setDestinationFolder)} onContinue={handleFoldersContinue} />}
      {page === "scan" && <ScanPage sourceFolder={sourceFolder} scanning={scanning} scanResult={scanResult} scanError={scanError} onBack={() => setPage("folders")} onContinue={handleScanContinue} />}
      {page === "scope-select" && scanResult && <ScopeSelectPage scanResult={scanResult} onBack={() => setPage("scan")} onContinue={handleScopeContinue} />}
      {page === "sitecoreai-auth" && <SitecoreAIAuthPage authState={sitecoreAIAuth} onAuthenticate={handleAuthenticateSitecoreAI} onBack={() => setPage("scope-select")} onContinue={handleAuthContinue} />}
      {page === "analysis" && selectedScope && (
        <AnalysisPage
          sourceFolder={selectedScope}
          progress={analysisProgress}
          plan={migrationPlan}
          analysisError={analysisError}
          onBack={() => setPage("sitecoreai-auth")}
          onContinue={handleAnalysisContinue}
        />
      )}
      {page === "review" && migrationPlan && selectedScope && (
        <ReviewPage
          sourceFolder={selectedScope}
          plan={migrationPlan}
          onBack={() => setPage("analysis")}
          onApprove={handleApprove}
        />
      )}
    </main>
  );
}
