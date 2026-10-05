import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { SitecoreItemMetadata, SitecoreMcpClient } from "./mcp-client.js";

export interface ResolvedSitecoreItem {
  source: LoadedYamlItem;
  target: SitecoreItemMetadata | null;
}

export class SitecoreItemResolver {
  constructor(private readonly targetClient: SitecoreMcpClient) {}

  async resolveByPath(source: LoadedYamlItem): Promise<ResolvedSitecoreItem> {
    const target = await this.targetClient.getItemByPath(source.item.Path);

    return {
      source,
      target,
    };
  }

  async resolveByNameAndParent(
    source: LoadedYamlItem,
    targetParentId: string,
  ): Promise<ResolvedSitecoreItem> {
    const itemName = this.getItemName(source.item.Path);

    const target = await this.targetClient.getItemByName(
      itemName,
      targetParentId,
    );

    return {
      source,
      target,
    };
  }

  private getItemName(path: string): string {
    const normalizedPath = path.replace(/\/+$/, "");
    const lastSlashIndex = normalizedPath.lastIndexOf("/");

    if (lastSlashIndex === -1) {
      return normalizedPath;
    }

    return normalizedPath.slice(lastSlashIndex + 1);
  }
}
