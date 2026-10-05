export interface SitecoreItemMetadata {
  id: string;
  name: string;
  path: string;
  parentId: string;
  templateId: string;
  database?: string;
}

export interface SitecoreMcpClient {
  getItemById(id: string): Promise<SitecoreItemMetadata | null>;

  getItemByPath(path: string): Promise<SitecoreItemMetadata | null>;

  getChildren(parentId: string): Promise<SitecoreItemMetadata[]>;

  getItemByName(
    name: string,
    parentId: string,
  ): Promise<SitecoreItemMetadata | null>;
}
