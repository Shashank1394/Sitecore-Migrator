import path from "node:path";

import { scanYamlFiles } from "../yaml/yaml-scanner.js";
import { readYamlFile } from "../yaml/yaml-reader.js";

export interface RenderingAnalysisFile {
  filePath: string;
  itemId: string;
  parentId: string;
  templateId: string;
  sitecorePath: string;
}

export interface RenderingAnalysisInput {
  sourceFolder: string;
  files: RenderingAnalysisFile[];
}

/**
 * Reads all YAML files from the selected directory and extracts
 * only the root Sitecore item information that the LLM needs.
 *
 * This function does NOT decide whether a file is a rendering.
 * It does NOT call MCP.
 * It does NOT modify any YAML.
 */
export async function collectRenderingAnalysisInput(
  sourceFolder: string,
): Promise<RenderingAnalysisInput> {
  const yamlFiles = await scanYamlFiles(sourceFolder, true);

  const files: RenderingAnalysisFile[] = [];

  for (const filePath of yamlFiles) {
    const item = await readYamlFile(filePath);

    if (
      typeof item.ID !== "string" ||
      typeof item.Parent !== "string" ||
      typeof item.Template !== "string" ||
      typeof item.Path !== "string"
    ) {
      continue;
    }

    files.push({
      filePath: path.resolve(filePath),
      itemId: item.ID,
      parentId: item.Parent,
      templateId: item.Template,
      sitecorePath: item.Path,
    });
  }

  return {
    sourceFolder: path.resolve(sourceFolder),
    files,
  };
}
