import type { SitecoreMcpClient } from "../mcp/mcp-client.js";
import { scanYamlFiles } from "../yaml/yaml-scanner.js";
import { readYamlFile } from "../yaml/yaml-reader.js";
import type { MigrationCase, InvestigationStep } from "./instruction-types.js";
import type {
  CaseAnalysis,
  AffectedFile,
  CaseException,
  DiscoveredTemplate,
  PlannedFieldChange,
} from "./analysis-types.js";

// ── Progress callback for this case ──────────────────────────────────────────

export type CaseProgressCallback = (step: string) => void;

// ── MCP clients passed in (never constructed here) ───────────────────────────

export interface McpClients {
  xp: SitecoreMcpClient;
  sitecoreAI: SitecoreMcpClient;
}

// ── Template discovery via MCP ────────────────────────────────────────────────

/**
 * Finds a template by name within a Sitecore environment using the MCP client.
 * Walks the tree under searchPath (or a sensible default) looking for an item
 * whose name matches the instruction's `matches` field.
 *
 * Never guesses a GUID — returns null if not found.
 */
async function discoverTemplateByName(
  client: SitecoreMcpClient,
  step: InvestigationStep,
  onProgress: CaseProgressCallback,
): Promise<DiscoveredTemplate | null> {
  const searchPath = step.searchPath ?? "/sitecore/templates";

  onProgress(`Querying MCP: looking for template "${step.matches}" under ${searchPath}…`);

  // Try by path first — many template items live at a predictable path
  const directAttempt = await client.getItemByPath(
    `${searchPath}/${step.matches}`,
  ).catch(() => null);

  if (directAttempt && directAttempt.name === step.matches) {
    return {
      name: step.matches,
      id: directAttempt.id,
      environment: "xp",
      path: directAttempt.path,
    };
  }

  // Walk children of the searchPath
  const root = await client.getItemByPath(searchPath).catch(() => null);
  if (!root) {
    return null;
  }

  const found = await walkForTemplate(client, root.id, step.matches, onProgress, 0);
  return found;
}

async function walkForTemplate(
  client: SitecoreMcpClient,
  parentId: string,
  targetName: string,
  onProgress: CaseProgressCallback,
  depth: number,
): Promise<DiscoveredTemplate | null> {
  if (depth > 6) return null; // safety limit

  const children = await client.getChildren(parentId).catch(() => []);

  for (const child of children) {
    if (child.name.toLowerCase() === targetName.toLowerCase()) {
      return {
        name: targetName,
        id: child.id,
        environment: "xp",
        path: child.path,
      };
    }
  }

  // Recurse
  for (const child of children) {
    const found = await walkForTemplate(client, child.id, targetName, onProgress, depth + 1);
    if (found) return found;
  }

  return null;
}

// ── Main analyser ─────────────────────────────────────────────────────────────

export async function analyseCase(
  migrationCase: MigrationCase,
  sourceDirectory: string,
  clients: McpClients,
  onProgress: CaseProgressCallback,
): Promise<CaseAnalysis> {
  const exceptions: CaseException[] = [];
  const discoveredTemplates: DiscoveredTemplate[] = [];

  // ── Phase 1: scan YAML files within this case's scope ────────────────────

  onProgress(`Scanning YAML files under ${migrationCase.scope.sitecorePath}…`);

  // The source directory contains serialized items. We filter to those whose
  // Sitecore path starts with the case scope path.
  const allFiles = await scanYamlFiles(sourceDirectory, migrationCase.scope.recursive);

  // Read all items and filter to scope — we never modify them here
  const scopedItems: Array<{ filePath: string; itemId: string; templateId: string; sitecorePath: string }> = [];

  for (const filePath of allFiles) {
    try {
      const item = await readYamlFile(filePath);
      if (
        item.Path &&
        (item.Path === migrationCase.scope.sitecorePath ||
          item.Path.startsWith(migrationCase.scope.sitecorePath + "/"))
      ) {
        scopedItems.push({
          filePath,
          itemId: item.ID,
          templateId: item.Template,
          sitecorePath: item.Path,
        });
      }
    } catch (err) {
      exceptions.push({
        filePath,
        message: err instanceof Error ? err.message : String(err),
        severity: "warning",
      });
    }
  }

  onProgress(`Found ${scopedItems.length} items under scope.`);

  // ── Phase 2: investigate — discover template IDs via MCP ─────────────────

  // Key: "<env>.<templateName>" → DiscoveredTemplate
  const discoveryMap = new Map<string, DiscoveredTemplate>();

  for (const step of (migrationCase.investigate.xp ?? [])) {
    onProgress(`XP MCP: ${step.description}`);
    try {
      const result = await discoverTemplateByName(clients.xp, step, onProgress);
      if (result) {
        const key = `xp.${step.matches}`;
        discoveryMap.set(key, { ...result, environment: "xp" });
        discoveredTemplates.push({ ...result, environment: "xp" });
        onProgress(`XP MCP: found "${step.matches}" → ${result.id}`);
      } else {
        exceptions.push({
          message: `XP MCP: could not find template "${step.matches}" under ${step.searchPath ?? "/sitecore/templates"}`,
          severity: "error",
        });
      }
    } catch (err) {
      exceptions.push({
        message: `XP MCP investigation failed for "${step.matches}": ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
      });
    }
  }

  for (const step of (migrationCase.investigate.sitecoreAI ?? [])) {
    onProgress(`SitecoreAI MCP: ${step.description}`);
    try {
      const result = await discoverTemplateByName(clients.sitecoreAI, step, onProgress);
      if (result) {
        const key = `sitecoreAI.${step.matches}`;
        discoveryMap.set(key, { ...result, environment: "sitecoreAI" });
        discoveredTemplates.push({ ...result, environment: "sitecoreAI" });
        onProgress(`SitecoreAI MCP: found "${step.matches}" → ${result.id}`);
      } else {
        exceptions.push({
          message: `SitecoreAI MCP: could not find template "${step.matches}" under ${step.searchPath ?? "/sitecore/templates"}`,
          severity: "error",
        });
      }
    } catch (err) {
      exceptions.push({
        message: `SitecoreAI MCP investigation failed for "${step.matches}": ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
      });
    }
  }

  // ── Phase 3: plan — determine which files are affected and what changes ───

  const affectedFiles: AffectedFile[] = [];

  for (const rule of migrationCase.transform) {
    const sourceTemplate = discoveryMap.get(rule.sourceInvestigationRef);
    const targetTemplate = discoveryMap.get(rule.targetInvestigationRef);

    if (!sourceTemplate || !targetTemplate) {
      exceptions.push({
        message: `Cannot build transform for field "${rule.field}": ` +
          `source ref "${rule.sourceInvestigationRef}" ` +
          (sourceTemplate ? "OK" : "NOT FOUND") + ", " +
          `target ref "${rule.targetInvestigationRef}" ` +
          (targetTemplate ? "OK" : "NOT FOUND"),
        severity: "error",
      });
      continue;
    }

    for (const scoped of scopedItems) {
      if (scoped.templateId === sourceTemplate.id) {
        const change: PlannedFieldChange = {
          field: rule.field,
          from: sourceTemplate.id,
          to: targetTemplate.id,
          description: rule.description,
        };

        const existing = affectedFiles.find((f) => f.filePath === scoped.filePath);
        if (existing) {
          existing.plannedChanges.push(change);
        } else {
          affectedFiles.push({
            filePath: scoped.filePath,
            itemId: scoped.itemId,
            sitecorePath: scoped.sitecorePath,
            plannedChanges: [change],
          });
        }
      }
    }
  }

  // ── Phase 4: validate ─────────────────────────────────────────────────────

  for (const check of migrationCase.validate) {
    if (check.check === "targetTemplateExists") {
      const targetRef = migrationCase.transform[0]?.targetInvestigationRef;
      if (targetRef) {
        const target = discoveryMap.get(targetRef);
        if (!target) {
          exceptions.push({
            message: `Validation: target template for "${targetRef}" was not discovered — cannot confirm it exists`,
            severity: "error",
          });
        } else {
          onProgress(`Validation: confirmed target template exists (${target.id})`);
        }
      }
    }

    if (check.check === "noDuplicateIds") {
      const ids = affectedFiles.map((f) => f.itemId);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length > 0) {
        for (const dupe of [...new Set(dupes)]) {
          exceptions.push({
            itemId: dupe,
            message: `Validation: duplicate item ID "${dupe}" found among affected files`,
            severity: "error",
          });
        }
      }
    }
  }

  // ── Build pattern description ─────────────────────────────────────────────

  const sourceDisc = discoveredTemplates.find((t) => t.environment === "xp");
  const targetDisc = discoveredTemplates.find((t) => t.environment === "sitecoreAI");
  const patternDescription =
    sourceDisc && targetDisc
      ? `${sourceDisc.name} → ${targetDisc.name}`
      : affectedFiles.length > 0
      ? `${migrationCase.transform[0]?.field ?? "Field"} remapping`
      : "No pattern discovered";

  return {
    caseId: migrationCase.id,
    caseName: migrationCase.name,
    status: exceptions.some((e) => e.severity === "error") ? "failed" : "complete",
    filesDiscovered: scopedItems.length,
    filesAffected: affectedFiles,
    discoveredTemplates,
    patternDescription,
    exceptions,
  };
}
