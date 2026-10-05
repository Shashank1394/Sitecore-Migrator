import type { MappingResult } from "./mapping-result.js";

export class MappingContext {
  private readonly mappingsBySourceId = new Map<string, MappingResult>();

  setMapping(result: MappingResult): void {
    this.mappingsBySourceId.set(result.sourceId, result);
  }

  getMapping(sourceId: string): MappingResult | undefined {
    return this.mappingsBySourceId.get(sourceId);
  }

  hasMapping(sourceId: string): boolean {
    return this.mappingsBySourceId.has(sourceId);
  }

  getTargetId(sourceId: string): string | undefined {
    return this.mappingsBySourceId.get(sourceId)?.target?.id;
  }

  get size(): number {
    return this.mappingsBySourceId.size;
  }
}
