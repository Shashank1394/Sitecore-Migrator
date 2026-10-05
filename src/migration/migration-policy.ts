import type { SitecoreYamlItem } from "../yaml/sitecore-yaml-types.js";

export const SITECORE_TEMPLATE_IDS = {
  controllerRendering: "2a3e91a0-7987-44b5-ab34-35c2d9de83b9",
  jsonRendering: "04646a89-996f-4ee7-878a-ffdbf1f0ef0d",
  renderingFolder: "7ee0975b-0698-493e-b3a2-0b2ef33d0522",
} as const;

export type ItemMigrationKind =
  | "folder"
  | "controller-rendering"
  | "json-rendering"
  | "other";

export type IdMappingMode = "preserve" | "remap";

export interface MigrationPolicy {
  classifyItem(item: SitecoreYamlItem): ItemMigrationKind;
  getIdMappingMode(path: string): IdMappingMode;
  shouldTransformTemplate(item: SitecoreYamlItem): boolean;
  getTargetTemplateId(item: SitecoreYamlItem): string | undefined;
}

const PRESERVE_ID_ROOTS = [
  "/sitecore/layout",
  "/sitecore/media library",
  "/sitecore/system",
  "/sitecore/templates",
];

const REMAP_ID_ROOTS = ["/sitecore/content"];

function isPathUnderRoot(path: string, root: string): boolean {
  const normalizedPath = path.replace(/\/+$/, "").toLowerCase();
  const normalizedRoot = root.replace(/\/+$/, "").toLowerCase();

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function getIdMappingMode(path: string): IdMappingMode {
  if (PRESERVE_ID_ROOTS.some((root) => isPathUnderRoot(path, root))) {
    return "preserve";
  }

  if (REMAP_ID_ROOTS.some((root) => isPathUnderRoot(path, root))) {
    return "remap";
  }

  /*
   * Unknown paths must not be silently remapped.
   * Treat them as preserve until an explicit migration
   * rule is added.
   */
  return "preserve";
}

function classifyItem(item: SitecoreYamlItem): ItemMigrationKind {
  if (item.Template === SITECORE_TEMPLATE_IDS.renderingFolder) {
    return "folder";
  }

  if (item.Template === SITECORE_TEMPLATE_IDS.controllerRendering) {
    return "controller-rendering";
  }

  if (item.Template === SITECORE_TEMPLATE_IDS.jsonRendering) {
    return "json-rendering";
  }

  return "other";
}

function shouldTransformTemplate(item: SitecoreYamlItem): boolean {
  return classifyItem(item) === "controller-rendering";
}

function getTargetTemplateId(item: SitecoreYamlItem): string | undefined {
  if (!shouldTransformTemplate(item)) {
    return undefined;
  }

  return SITECORE_TEMPLATE_IDS.jsonRendering;
}

export const migrationPolicy: MigrationPolicy = {
  classifyItem,
  getIdMappingMode,
  shouldTransformTemplate,
  getTargetTemplateId,
};
