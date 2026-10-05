import type { LoadedYamlItem } from "../yaml/yaml-loader.js";
import type { SitecoreItemResolver } from "../mcp/sitecore-item-resolver.js";
import { MappingContext } from "./mapping-context.js";
import type { MappingResult } from "./mapping-result.js";

export class HierarchicalMappingEngine {
  constructor(
    private readonly resolver: SitecoreItemResolver,
    private readonly context: MappingContext,
  ) {}

  async mapItem(source: LoadedYamlItem): Promise<MappingResult> {
    const byPath = await this.resolver.resolveByPath(source);

    if (byPath.target) {
      const result: MappingResult = {
        status: "matched",
        sourceId: source.item.ID,
        sourcePath: source.item.Path,
        target: byPath.target,
        reason: "exact-path",
      };

      this.context.setMapping(result);

      return result;
    }

    const targetParentId = this.context.getTargetId(source.item.Parent);

    if (!targetParentId) {
      const result: MappingResult = {
        status: "missing",
        sourceId: source.item.ID,
        sourcePath: source.item.Path,
        reason:
          "Target parent has not been mapped, so name-and-parent mapping cannot be performed.",
      };

      this.context.setMapping(result);

      return result;
    }

    const byNameAndParent = await this.resolver.resolveByNameAndParent(
      source,
      targetParentId,
    );

    if (byNameAndParent.target) {
      const result: MappingResult = {
        status: "matched",
        sourceId: source.item.ID,
        sourcePath: source.item.Path,
        target: byNameAndParent.target,
        reason: "name-and-parent",
      };

      this.context.setMapping(result);

      return result;
    }

    const result: MappingResult = {
      status: "missing",
      sourceId: source.item.ID,
      sourcePath: source.item.Path,
      reason: "No target item found by exact path or name and parent.",
    };

    this.context.setMapping(result);

    return result;
  }
}
