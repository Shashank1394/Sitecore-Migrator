import { scanYamlFiles } from "./yaml-scanner.js";
import { readYamlFile } from "./yaml-reader.js";
import type { SitecoreYamlItem } from "./sitecore-yaml-types.js";

export interface LoadedYamlItem {
  filePath: string;
  item: SitecoreYamlItem;
}

export async function loadYamlItems(
  directory: string,
  recursive = true,
): Promise<LoadedYamlItem[]> {
  const filePaths = await scanYamlFiles(directory, recursive);

  const items: LoadedYamlItem[] = [];

  for (const filePath of filePaths) {
    const item = await readYamlFile(filePath);

    items.push({
      filePath,
      item,
    });
  }

  return items;
}
