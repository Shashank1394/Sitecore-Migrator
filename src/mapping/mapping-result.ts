import type { SitecoreItemMetadata } from "../mcp/mcp-client.js";

export type MappingStatus = "matched" | "missing" | "ambiguous";

export interface MappingCandidate {
  item: SitecoreItemMetadata;
  reason: string;
}

export interface MappingResult {
  status: MappingStatus;
  sourceId: string;
  sourcePath: string;
  target?: SitecoreItemMetadata;
  candidates?: MappingCandidate[];
  reason?: string;
}
