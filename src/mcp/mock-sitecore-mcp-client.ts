import type { SitecoreItemMetadata, SitecoreMcpClient } from "./mcp-client.js";

export class MockSitecoreMcpClient implements SitecoreMcpClient {
  private readonly items: SitecoreItemMetadata[];

  constructor(items: SitecoreItemMetadata[]) {
    this.items = items;
  }

  async getItemById(id: string): Promise<SitecoreItemMetadata | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async getItemByPath(path: string): Promise<SitecoreItemMetadata | null> {
    return this.items.find((item) => item.path === path) ?? null;
  }

  async getChildren(parentId: string): Promise<SitecoreItemMetadata[]> {
    return this.items.filter((item) => item.parentId === parentId);
  }

  async getItemByName(
    name: string,
    parentId: string,
  ): Promise<SitecoreItemMetadata | null> {
    return (
      this.items.find(
        (item) => item.name === name && item.parentId === parentId,
      ) ?? null
    );
  }
}
