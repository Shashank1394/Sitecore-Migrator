import { migrationPolicy, SITECORE_TEMPLATE_IDS } from "./migration-policy.js";
import type { SitecoreYamlItem } from "../yaml/sitecore-yaml-types.js";

function createItem(template: string, path: string): SitecoreYamlItem {
  return {
    ID: "test-id",
    Parent: "parent-id",
    Template: template,
    Path: path,
  };
}

// --------------------------------------------------
// Folder
// --------------------------------------------------

const folder = createItem(
  SITECORE_TEMPLATE_IDS.renderingFolder,
  "/sitecore/layout/Renderings/Feature/EnterpriseComponents",
);

if (migrationPolicy.classifyItem(folder) !== "folder") {
  throw new Error("Rendering folder classification failed.");
}

if (migrationPolicy.shouldTransformTemplate(folder)) {
  throw new Error("Rendering folders must not be transformed.");
}

console.log("Rendering folder policy passed.");

// --------------------------------------------------
// Controller Rendering
// --------------------------------------------------

const controllerRendering = createItem(
  SITECORE_TEMPLATE_IDS.controllerRendering,
  "/sitecore/layout/Renderings/Feature/EnterpriseComponents/Accordion/Accordion",
);

if (
  migrationPolicy.classifyItem(controllerRendering) !== "controller-rendering"
) {
  throw new Error("Controller rendering classification failed.");
}

if (!migrationPolicy.shouldTransformTemplate(controllerRendering)) {
  throw new Error("Controller rendering should be transformed.");
}

const targetTemplate = migrationPolicy.getTargetTemplateId(controllerRendering);

if (targetTemplate !== SITECORE_TEMPLATE_IDS.jsonRendering) {
  throw new Error("Controller rendering target template is incorrect.");
}

console.log("Controller rendering policy passed.");

// --------------------------------------------------
// JSON Rendering
// --------------------------------------------------

const jsonRendering = createItem(
  SITECORE_TEMPLATE_IDS.jsonRendering,
  "/sitecore/layout/Renderings/Feature/Test",
);

if (migrationPolicy.classifyItem(jsonRendering) !== "json-rendering") {
  throw new Error("JSON rendering classification failed.");
}

if (migrationPolicy.shouldTransformTemplate(jsonRendering)) {
  throw new Error("JSON rendering must not be transformed again.");
}

console.log("JSON rendering policy passed.");

// --------------------------------------------------
// Global ID preservation
// --------------------------------------------------

const globalPath =
  "/sitecore/layout/Renderings/Feature/EnterpriseComponents/Accordion";

if (migrationPolicy.getIdMappingMode(globalPath) !== "preserve") {
  throw new Error("Global Sitecore IDs should be preserved.");
}

console.log("Global ID preservation policy passed.");

// --------------------------------------------------
// Site content ID remapping
// --------------------------------------------------

const sitePath =
  "/sitecore/content/Microsites/EnterpriseComponents/Data/Copy Banner";

if (migrationPolicy.getIdMappingMode(sitePath) !== "remap") {
  throw new Error("Site content IDs should be remapped.");
}

console.log("Site content ID remapping policy passed.");

// --------------------------------------------------
// Unknown path
// --------------------------------------------------

const unknownPath = "/some/unknown/sitecore/path";

if (migrationPolicy.getIdMappingMode(unknownPath) !== "preserve") {
  throw new Error("Unknown paths must default to preserve.");
}

console.log("Unknown path safety policy passed.");

console.log("");
console.log("Migration policy test passed.");
