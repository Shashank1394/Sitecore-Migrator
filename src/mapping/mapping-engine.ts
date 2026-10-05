import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import type { MappingResult } from "./mapping-result.js";
import type { MappingStrategy } from "./mapping-strategy.js";

export class MappingEngine {
  constructor(private readonly resolver: SitecoreItemResolver) {}

  async mapItem(source: LoadedYamlItem): Promise<MappingResult> {
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

  getStrategy(): MappingStrategy {
    return "exact-path";
  }
}
