import type { LoadedYamlItem } from "./yaml-loader.js";

export class YamlIndex {
  private readonly itemsById = new Map<string, LoadedYamlItem>();
  private readonly itemsByPath = new Map<string, LoadedYamlItem>();
  private readonly childrenByParentId = new Map<string, LoadedYamlItem[]>();

  constructor(items: LoadedYamlItem[]) {
    for (const loadedItem of items) {
      this.add(loadedItem);
    }
  }

  private add(loadedItem: LoadedYamlItem): void {
    const { item } = loadedItem;

    if (this.itemsById.has(item.ID)) {
      throw new Error(`Duplicate Sitecore item ID found: ${item.ID}`);
    }

    if (this.itemsByPath.has(item.Path)) {
      throw new Error(`Duplicate Sitecore item path found: ${item.Path}`);
    }

    this.itemsById.set(item.ID, loadedItem);
    this.itemsByPath.set(item.Path, loadedItem);

    const children = this.childrenByParentId.get(item.Parent);

    if (children) {
      children.push(loadedItem);
    } else {
      this.childrenByParentId.set(item.Parent, [loadedItem]);
    }
  }

  getById(id: string): LoadedYamlItem | undefined {
    return this.itemsById.get(id);
  }

  getByPath(path: string): LoadedYamlItem | undefined {
    return this.itemsByPath.get(path);
  }

  getChildren(parentId: string): LoadedYamlItem[] {
    return this.childrenByParentId.get(parentId) ?? [];
  }

  get size(): number {
    return this.itemsById.size;
  }
}
