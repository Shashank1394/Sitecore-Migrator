import type { SitecoreItemMetadata, SitecoreMcpClient } from "../mcp-client.js";

interface SitecoreAiTemplate {
  templateId: string;
  name: string;
}

interface SitecoreAiItem {
  itemId: string;
  name: string;
  path: string;
  template?: SitecoreAiTemplate;
  fields?: Record<string, unknown>;
  children?: {
    nodes?: SitecoreAiItem[];
  };
}

export interface SitecoreAiMcpTransport {
  getContentItemById(itemId: string, language?: string): Promise<unknown>;

  getContentItemByPath(
    itemPath: string,
    language?: string,
    failOnNotFound?: boolean,
  ): Promise<unknown>;
}

export class SitecoreAiMcpClient implements SitecoreMcpClient {
  constructor(
    private readonly transport: SitecoreAiMcpTransport,
    private readonly language = "en",
  ) {}

  async getItemById(id: string): Promise<SitecoreItemMetadata | null> {
    const response = await this.transport.getContentItemById(id, this.language);

    const item = this.parseItem(response);

    return item ? this.toMetadata(item) : null;
  }

  async getItemByPath(path: string): Promise<SitecoreItemMetadata | null> {
    const response = await this.transport.getContentItemByPath(
      path,
      this.language,
      false,
    );

    const item = this.parseItem(response);

    return item ? this.toMetadata(item) : null;
  }

  async getChildren(parentId: string): Promise<SitecoreItemMetadata[]> {
    const parent = await this.getItemById(parentId);

    if (!parent) {
      return [];
    }

    const response = await this.transport.getContentItemByPath(
      parent.path,
      this.language,
      false,
    );

    const item = this.parseItem(response);

    if (!item?.children?.nodes) {
      return [];
    }

    return item.children.nodes.map((child) =>
      this.toMetadata(child, parent.id),
    );
  }

  async getItemByName(
    name: string,
    parentId: string,
  ): Promise<SitecoreItemMetadata | null> {
    const children = await this.getChildren(parentId);

    const matches = children.filter((child) => child.name === name);

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple SitecoreAI items named "${name}" found under parent ${parentId}.`,
      );
    }

    return matches[0];
  }

  private parseItem(response: unknown): SitecoreAiItem | null {
    if (!response) {
      return null;
    }

    const item = this.unwrapResponse(response);

    if (!item || typeof item !== "object") {
      return null;
    }

    const candidate = item as Record<string, unknown>;

    if (
      typeof candidate.itemId !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.path !== "string"
    ) {
      throw new Error(
        "Unexpected SitecoreAI MCP response: itemId, name, or path is missing.",
      );
    }

    return candidate as unknown as SitecoreAiItem;
  }

  private unwrapResponse(response: unknown): unknown {
    if (
      typeof response === "object" &&
      response !== null &&
      "itemId" in response
    ) {
      return response;
    }

    if (
      typeof response === "object" &&
      response !== null &&
      "data" in response
    ) {
      return (
        response as {
          data: unknown;
        }
      ).data;
    }

    return response;
  }

  private toMetadata(
    item: SitecoreAiItem,
    parentId?: string,
  ): SitecoreItemMetadata {
    if (!item.template?.templateId) {
      throw new Error(
        `SitecoreAI item "${item.path}" does not contain a template ID.`,
      );
    }

    return {
      id: item.itemId,
      name: item.name,
      path: item.path,
      parentId: parentId ?? this.getParentIdFromPath(item.path),
      templateId: item.template.templateId,
    };
  }

  private getParentIdFromPath(path: string): string {
    /*
     * SitecoreAI does not return parentId in the
     * content-item response. For direct item lookups,
     * the parent ID cannot safely be inferred from the path.
     *
     * Return an empty value here and let callers that
     * require parent relationships obtain the parent
     * through getChildren().
     */
    return "";
  }
}
