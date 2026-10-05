import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { MappingResult } from "./mapping-result.js";
import type { HierarchicalMappingEngine } from "./hierarchical-mapping-engine.js";
import type { MappingContext } from "./mapping-context.js";

export interface MigrationMappingSummary {
  total: number;
  matched: number;
  missing: number;
  ambiguous: number;
  results: MappingResult[];
}

export class MigrationMapper {
  constructor(
    private readonly mappingEngine: HierarchicalMappingEngine,
    private readonly context: MappingContext,
  ) {}

  async mapItems(items: LoadedYamlItem[]): Promise<MigrationMappingSummary> {
    const orderedItems = this.sortParentFirst(items);
    const results: MappingResult[] = [];

    for (const item of orderedItems) {
      const result = await this.mappingEngine.mapItem(item);

      results.push(result);
    }

    return {
      total: results.length,
      matched: results.filter((result) => result.status === "matched").length,
      missing: results.filter((result) => result.status === "missing").length,
      ambiguous: results.filter((result) => result.status === "ambiguous")
        .length,
      results,
    };
  }

  getContext(): MappingContext {
    return this.context;
  }

  private sortParentFirst(items: LoadedYamlItem[]): LoadedYamlItem[] {
    const itemsById = new Map<string, LoadedYamlItem>();

    for (const item of items) {
      itemsById.set(item.item.ID, item);
    }

    const sorted: LoadedYamlItem[] = [];
    const visited = new Set<string>();

    const visit = (item: LoadedYamlItem): void => {
      if (visited.has(item.item.ID)) {
        return;
      }

      visited.add(item.item.ID);

      const parent = itemsById.get(item.item.Parent);

      if (parent) {
        visit(parent);
      }

      sorted.push(item);
    };

    for (const item of items) {
      visit(item);
    }

    return sorted;
  }
}
