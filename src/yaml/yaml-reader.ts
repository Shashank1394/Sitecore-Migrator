import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

import type { SitecoreYamlItem } from "./sitecore-yaml-types.js";

export async function readYamlFile(
  filePath: string,
): Promise<SitecoreYamlItem> {
  const content = await readFile(filePath, "utf-8");

  const parsed = yaml.load(content);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Sitecore YAML structure: ${filePath}`);
  }

  return parsed as SitecoreYamlItem;
}
