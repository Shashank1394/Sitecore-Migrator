# Template Mappings Configuration

## Overview

The Sitecore XP to SitecoreAI migration workbench now uses a **manual template mapping file** instead of connecting to MCP servers. This approach is simpler, faster, and doesn't require complex authentication.

## How It Works

1. The analyzer reads Template GUIDs directly from YAML files in your XP serialization folder
2. It looks up the target SitecoreAI GUIDs from `template-mappings.json`
3. It generates a migration plan showing which YAML files need Template field changes

**No MCP servers, no OAuth, no API keys required** for the core migration analysis.

## Configuration File

### Location
Place `template-mappings.json` in the project root (same folder as `package.json`)

### Format
```json
{
  "description": "Manual mapping of XP template GUIDs to SitecoreAI template GUIDs",
  "mappings": [
    {
      "xpTemplateGuid": "{04646A89-996F-4EE7-878A-FFDBF1F0EF0D}",
      "xpTemplateName": "Json Rendering",
      "xpTemplatePath": "/sitecore/templates/Foundation/JavaScript Services/Json Rendering",
      "sitecoreAITemplateGuid": "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}",
      "sitecoreAITemplateName": "Target Template Name",
      "sitecoreAITemplatePath": "/sitecore/templates/...",
      "notes": "Optional notes about this mapping"
    }
  ]
}
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `xpTemplateGuid` | Yes | Source XP template GUID in `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` format |
| `xpTemplateName` | Yes | Human-readable name of the XP template |
| `xpTemplatePath` | No | Full Sitecore path to the XP template (for documentation) |
| `sitecoreAITemplateGuid` | Yes | Target SitecoreAI template GUID (replace PLACEHOLDER with actual GUID) |
| `sitecoreAITemplateName` | Yes | Human-readable name of the SitecoreAI template |
| `sitecoreAITemplatePath` | No | Full Sitecore path to the SitecoreAI template (for documentation) |
| `notes` | No | Any additional notes about this mapping |

## Getting Template GUIDs

### From Sitecore XP
The XP template GUIDs are already in your YAML files in the `Template` field:

```yaml
---
ID: "some-item-id"
Template: "{04646A89-996F-4EE7-878A-FFDBF1F0EF0D}"  # <-- This GUID
...
```

### From SitecoreAI
You need to find the equivalent template GUIDs in your SitecoreAI instance:

**Option 1: Content Editor**
1. Open SitecoreAI Content Editor
2. Navigate to `/sitecore/templates`
3. Find the equivalent template
4. Copy its GUID from the item properties

**Option 2: Database Query**
If you have database access:
```sql
SELECT ItemId, Name, TemplatePath 
FROM Items 
WHERE Name LIKE '%Rendering%'
```

**Option 3: GraphQL (if available)**
```graphql
query {
  item(path: "/sitecore/templates/...") {
    id
    name
    path
  }
}
```

## Example: Rendering Templates

Here's a complete example for common JSS rendering templates:

```json
{
  "description": "XP to SitecoreAI template mappings for JSS renderings",
  "mappings": [
    {
      "xpTemplateGuid": "{04646A89-996F-4EE7-878A-FFDBF1F0EF0D}",
      "xpTemplateName": "Json Rendering",
      "xpTemplatePath": "/sitecore/templates/Foundation/JavaScript Services/Json Rendering",
      "sitecoreAITemplateGuid": "{REPLACE-WITH-ACTUAL-GUID}",
      "sitecoreAITemplateName": "Component",
      "sitecoreAITemplatePath": "/sitecore/templates/Components/Component",
      "notes": "JSS Json Rendering maps to SitecoreAI Component"
    },
    {
      "xpTemplateGuid": "{2A3E91A0-7987-44B5-AB34-35C2D9DE83B9}",
      "xpTemplateName": "Controller Rendering",
      "xpTemplatePath": "/sitecore/templates/System/Layout/Renderings/Controller Rendering",
      "sitecoreAITemplateGuid": "{REPLACE-WITH-ACTUAL-GUID}",
      "sitecoreAITemplateName": "MVC Component",
      "sitecoreAITemplatePath": "/sitecore/templates/Components/MVC Component",
      "notes": "MVC Controller Rendering maps to SitecoreAI MVC Component"
    }
  ]
}
```

## Validation

The analyzer will automatically validate your mappings:

✅ **Checks performed:**
- All XP template GUIDs found in YAML files must have a mapping entry
- No target GUID can be "PLACEHOLDER"
- GUID format must be `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`

⚠️ **Warnings:**
- If a template is found in your YAMLs but not in the mappings file, you'll get an error
- Update `template-mappings.json` to add the missing mapping

## Workflow

1. **Scan your YAMLs:** Run the app and select your XP serialization folder
2. **See what templates are used:** The analyzer will show you all unique template GUIDs
3. **Fill in the mappings:** Get the target GUIDs from your SitecoreAI instance and update `template-mappings.json`
4. **Re-run analysis:** The analyzer will now generate a complete migration plan

## Benefits of Manual Mappings

✅ **Simplicity:** No authentication, no MCP servers, no OAuth flows
✅ **Speed:** Instant lookups from a local JSON file
✅ **Transparency:** You control the exact mappings
✅ **Reliability:** No network dependencies or API failures
✅ **Maintainability:** Easy to update and version control

## Need Help?

1. Check the JSON schema: `template-mappings.schema.json` provides autocomplete in VS Code
2. Start with the provided template in `template-mappings.json`
3. Run the analyzer - it will tell you which template GUIDs are missing mappings

## Future: Optional MCP Integration

If you want to automate template discovery later, we can add MCP integration as an **optional feature** that:
- Queries SitecoreAI MCP to find target templates automatically
- Generates the `template-mappings.json` file for you
- Still works offline once the file is generated

But the manual approach is the simplest starting point.
