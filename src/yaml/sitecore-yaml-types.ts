export interface SitecoreYamlField {
  ID: string;
  Hint?: string;
  Value?: unknown;
  [key: string]: unknown;
}

export interface SitecoreYamlVersion {
  Version: number;
  Fields: SitecoreYamlField[];
  [key: string]: unknown;
}

export interface SitecoreYamlLanguage {
  Language: string;
  Versions: SitecoreYamlVersion[];
  [key: string]: unknown;
}

export interface SitecoreYamlItem {
  ID: string;
  Parent: string;
  Template: string;
  Path: string;
  DB?: string;
  Languages?: SitecoreYamlLanguage[];
  [key: string]: unknown;
}
