import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import type { MappingResult } from "./mapping-result.js";
import type { MappingStrategy } from "./mapping-strategy.js";

export class MappingStrategyRunner {
  constructor(private readonly resolver: SitecoreItemResolver) {}

  async run(
    strategy: MappingStrategy,
    source: LoadedYamlItem,
    targetParentId?: string,
  ): Promise<MappingResult> {
    switch (strategy) {
      case "exact-path": {
        const result = await this.resolver.resolveByPath(source);

        if (result.target) {
          return {
            status: "matched",
            sourceId: source.item.ID,
            sourcePath: source.item.Path,
            target: result.target,
            reason: "exact-path",
          };
        }

        return {
          status: "missing",
          sourceId: source.item.ID,
          sourcePath: source.item.Path,
          reason: "No target item found by exact path.",
        };
      }

      case "name-and-parent": {
        if (!targetParentId) {
          return {
            status: "missing",
            sourceId: source.item.ID,
            sourcePath: source.item.Path,
            reason: "Target parent ID is required for name-and-parent mapping.",
          };
        }

        const result = await this.resolver.resolveByNameAndParent(
          source,
          targetParentId,
        );

        if (result.target) {
          return {
            status: "matched",
            sourceId: source.item.ID,
            sourcePath: source.item.Path,
            target: result.target,
            reason: "name-and-parent",
          };
        }

        return {
          status: "missing",
          sourceId: source.item.ID,
          sourcePath: source.item.Path,
          reason: "No target item found by name and parent.",
        };
      }

      case "exact-id":
        return {
          status: "missing",
          sourceId: source.item.ID,
          sourcePath: source.item.Path,
          reason: "Exact-ID mapping is not implemented yet.",
        };

      default: {
        const exhaustiveCheck: never = strategy;
        return exhaustiveCheck;
      }
    }
  }
}
