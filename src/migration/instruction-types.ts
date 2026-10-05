// ── Instruction schema types ──────────────────────────────────────────────────
// These mirror the structure of migration-instructions.yaml.
// No Sitecore IDs appear here — IDs are discovered at runtime.

export interface InstructionScope {
  sitecorePath: string;
  recursive: boolean;
}

export type McpEnvironment = "xp" | "sitecoreAI";

export interface InvestigationStep {
  find: "template";
  where: "templateName";
  matches: string;           // human-readable name to search for, e.g. "Controller Rendering"
  searchPath?: string;       // optional subtree to search within
  description: string;
}

export interface InvestigateBlock {
  xp?: InvestigationStep[];
  sitecoreAI?: InvestigationStep[];
}

export interface TransformRule {
  field: string;
  strategy: "remap-to-discovered";
  sourceInvestigationRef: string;   // e.g. "xp.Controller Rendering"
  targetInvestigationRef: string;   // e.g. "sitecoreAI.Json Rendering"
  description: string;
}

export interface ValidationCheck {
  check: "targetTemplateExists" | "noDuplicateIds";
  via?: McpEnvironment;
  description: string;
}

export interface MigrationCase {
  id: string;
  name: string;
  description: string;
  scope: InstructionScope;
  investigate: InvestigateBlock;
  transform: TransformRule[];
  preserve: string[];
  validate: ValidationCheck[];
}

export interface MigrationInstructions {
  version: string;
  cases: MigrationCase[];
}
