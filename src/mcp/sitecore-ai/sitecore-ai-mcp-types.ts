export interface SitecoreAiMcpRequest {
  tool: "get_content_item_by_id" | "get_content_item_by_path";

  arguments: {
    itemId?: string;
    itemPath?: string;
    language?: string;
    failOnNotFound?: boolean;
  };
}

export interface SitecoreAiMcpResponse {
  itemId: string;
  name: string;
  path: string;

  template?: {
    templateId: string;
    name: string;
  };

  fields?: Record<string, unknown>;

  children?: {
    nodes: SitecoreAiMcpChild[];
  };
}

export interface SitecoreAiMcpChild {
  itemId: string;
  name: string;
  path: string;

  template?: {
    templateId: string;
    name: string;
  };

  fields?: Record<string, unknown>;
}
