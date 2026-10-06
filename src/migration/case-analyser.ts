import { scanYamlFiles } from "../yaml/yaml-scanner.js";
import { readYamlFile } from "../yaml/yaml-reader.js";
import type { MigrationCase } from "./instruction-types.js";
import type {
  CaseAnalysis,
  AffectedFile,
  CaseException,
  DiscoveredTemplate,
  PlannedFieldChange,
} from "./analysis-types.js";
import type { SitecoreMcpClient } from "../mcp/mcp-client.js";

// ── Progress callback for this case ──────────────────────────────────────────

export type CaseProgressCallback = (step: string) => void;

// ── MCP client interface ──────────────────────────────────────────────────────

export interface McpClients {
  sitecoreAI: SitecoreMcpClient;
}

// ── Template mapping storage ──────────────────────────────────────────────────

interface TemplateMapping {
  sourceGuid: string;
  sourceName: string;
  targetGuid: string;
  targetName: string;
  targetPath: string;
}

// ── AI-powered template discovery ─────────────────────────────────────────────

/**
 * Uses SitecoreAI MCP to discover the target template based on XP template name.
 * This is AI-powered template mapping using the investigation steps as hints.
 */
async function discoverTargetTemplate(
  client: SitecoreMcpClient,
  sourceTemplateGuid: string,
  investigationSteps: Array<{ matches: string; searchPath?: string }>,
  onProgress: CaseProgressCallback,
): Promise<{ id: string; name: string; path: string } | null> {
  // Try each investigation step until we find a match
  for (const step of investigationSteps) {
    const searchPath = step.searchPath || "/sitecore/templates";
    onProgress(`AI Discovery: Searching for "${step.matches}" in ${searchPath}...`);

    try {
      // Try direct path first
      const directPath = `${searchPath}/${step.matches}`;
      const directAttempt = await client.getItemByPath(directPath).catch(() => null);
      
      if (directAttempt) {
        onProgress(`✓ Found: ${directAttempt.name} at ${directPath}`);
        return {
          id: directAttempt.id,
          name: directAttempt.name,
          path: directAttempt.path || directPath,
        };
      }

      // Search within the path hierarchy
      const found = await searchTemplateByName(client, searchPath, step.matches, onProgress);
      if (found) {
        return found;
      }
    } catch (err) {
      onProgress(`⚠ Search failed for "${step.matches}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return null;
}

/**
 * Recursively searches for a template by name pattern in SitecoreAI.
 */
async function searchTemplateByName(
  client: SitecoreMcpClient,
  searchPath: string,
  namePattern: string,
  onProgress: CaseProgressCallback,
  depth: number = 0,
): Promise<{ id: string; name: string; path: string } | null> {
  if (depth > 5) return null; // Prevent deep recursion

  try {
    const root = await client.getItemByPath(searchPath).catch(() => null);
    if (!root) return null;

    const children = await client.getChildren(root.id).catch(() => []);

    // Check direct children first
    for (const child of children) {
      if (child.name.toLowerCase().includes(namePattern.toLowerCase())) {
        onProgress(`✓ Found match: ${child.name}`);
        return {
          id: child.id,
          name: child.name,
          path: child.path || `${searchPath}/${child.name}`,
        };
      }
    }

    // Recursively search child folders
    for (const child of children) {
      const childPath = child.path || `${searchPath}/${child.name}`;
      const found = await searchTemplateByName(client, childPath, namePattern, onProgress, depth + 1);
      if (found) return found;
    }
  } catch (err) {
    // Silent failure - keep searching
  }

  return null;
}

/**
 * Normalizes a GUID string to uppercase format with braces.
 */
function normalizeGuid(guid: string): string {
  const cleaned = guid.replace(/[{}]/g, "").toUpperCase();
  return `{${cleaned}}`;
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

  // ── Phase 1: Scan YAML files within this case's scope ─────────────────────

  onProgress(`Scanning YAML files under ${migrationCase.scope.sitecorePath}…`);

  const allFiles = await scanYamlFiles(sourceDirectory, migrationCase.scope.recursive);

  // Read all items and filter to scope
  const scopedItems: Array<{ 
    filePath: string; 
    itemId: string; 
    templateId: string; 
    sitecorePath: string;
    parentId: string;
  }> = [];

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
          parentId: item.Parent,
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

  if (scopedItems.length === 0) {
    return {
      caseId: migrationCase.id,
      caseName: migrationCase.name,
      status: "complete",
      filesDiscovered: 0,
      filesAffected: [],
      discoveredTemplates: [],
      patternDescription: "No items found in scope",
      exceptions,
    };
  }

  // ── Phase 2: Collect unique template GUIDs from YAML files ───────────────

  const uniqueTemplateGuids = new Set<string>();
  for (const item of scopedItems) {
    const normalized = normalizeGuid(item.templateId);
    uniqueTemplateGuids.add(normalized);
  }

  onProgress(`Found ${uniqueTemplateGuids.size} unique template GUID(s) in scoped items.`);

  // ── Phase 3: AI-powered template discovery via SitecoreAI MCP ─────────────

  const templateMappings = new Map<string, TemplateMapping>();
  const sitecoreAISteps = migrationCase.investigate.sitecoreAI || [];

  if (sitecoreAISteps.length === 0) {
    exceptions.push({
      message: `No SitecoreAI investigation steps defined in migration case "${migrationCase.name}"`,
      severity: "error",
    });
  }

  for (const guid of uniqueTemplateGuids) {
    onProgress(`🤖 AI Discovery: Finding target for template ${guid}...`);

    // Use the investigation steps to guide AI discovery
    const targetTemplate = await discoverTargetTemplate(
      clients.sitecoreAI,
      guid,
      sitecoreAISteps,
      onProgress,
    );

    if (targetTemplate) {
      templateMappings.set(guid, {
        sourceGuid: guid,
        sourceName: `Template ${guid.substring(1, 9)}`, // Short name from GUID
        targetGuid: targetTemplate.id,
        targetName: targetTemplate.name,
        targetPath: targetTemplate.path,
      });

      // Add to discovered templates
      discoveredTemplates.push({
        name: `XP Template ${guid.substring(1, 9)}`,
        id: guid,
        environment: "xp",
        path: "",
      });

      discoveredTemplates.push({
        name: targetTemplate.name,
        id: targetTemplate.id,
        environment: "sitecoreAI",
        path: targetTemplate.path,
      });

      onProgress(`✓ Mapped: ${guid} → ${targetTemplate.name} (${targetTemplate.id})`);
    } else {
      exceptions.push({
        message: `AI Discovery: Could not find target template for ${guid}. Tried patterns: ${sitecoreAISteps.map(s => s.matches).join(", ")}`,
        severity: "error",
      });
    }
  }

  // ── Phase 4: Build migration plan with AI-discovered mappings ─────────────

  const affectedFiles: AffectedFile[] = [];

  for (const item of scopedItems) {
    const normalizedGuid = normalizeGuid(item.templateId);
    const mapping = templateMappings.get(normalizedGuid);
    
    if (mapping) {
      const change: PlannedFieldChange = {
        field: "Template",
        from: item.templateId,
        to: mapping.targetGuid,
        description: `AI-discovered: ${mapping.sourceName} → ${mapping.targetName}`,
      };

      affectedFiles.push({
        filePath: item.filePath,
        itemId: item.itemId,
        sitecorePath: item.sitecorePath,
        plannedChanges: [change],
      });
    }
  }

  onProgress(`Built migration plan: ${affectedFiles.length} files will be transformed.`);

  // ── Phase 5: Validate ─────────────────────────────────────────────────────

  for (const check of migrationCase.validate) {
    if (check.check === "targetTemplateExists") {
      // Verify all target templates exist in SitecoreAI
      for (const mapping of templateMappings.values()) {
        try {
          const exists = await clients.sitecoreAI.getItemById(mapping.targetGuid);
          if (exists) {
            onProgress(`✓ Validation: ${mapping.targetName} exists in SitecoreAI`);
          } else {
            exceptions.push({
              message: `Validation: target template ${mapping.targetGuid} not found in SitecoreAI`,
              severity: "error",
            });
          }
        } catch (err) {
          exceptions.push({
            message: `Validation: failed to verify ${mapping.targetGuid}: ${err instanceof Error ? err.message : String(err)}`,
            severity: "error",
          });
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
      } else {
        onProgress(`✓ Validation: no duplicate IDs found`);
      }
    }
  }

  // ── Build pattern description ─────────────────────────────────────────────

  const mappings = Array.from(templateMappings.values());
  const patternDescription = mappings.length > 0
    ? mappings.map(m => `${m.sourceName} → ${m.targetName}`).join(", ")
    : "No template mappings discovered";

  const status = exceptions.some((e) => e.severity === "error") 
    ? "failed" 
    : affectedFiles.length > 0 
    ? "complete" 
    : "complete";

  return {
    caseId: migrationCase.id,
    caseName: migrationCase.name,
    status,
    filesDiscovered: scopedItems.length,
    filesAffected: affectedFiles,
    discoveredTemplates,
    patternDescription,
    exceptions,
  };
}
