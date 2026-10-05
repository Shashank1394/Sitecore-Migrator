# Sitecore XP → SitecoreAI Migration Skill

## Purpose

Migrate serialized Sitecore XP YAML files to SitecoreAI-compatible
YAML using AI reasoning and Sitecore MCP tools.

The migration agent must be able to:

- inspect Sitecore XP items
- inspect SitecoreAI items
- determine migration requirements
- discover reusable migration patterns
- apply discovered patterns across large sets of files
- preserve information that does not need to change
- identify exceptions that require individual investigation
- validate the resulting YAML
- produce a migration report

The objective is NOT to independently reason through every YAML file.

The objective is to discover migration rules once and safely apply
those rules to all applicable files.

---

# Core Principles

## 1. AI determines the migration rule

Do not hard-code assumptions about Sitecore migration.

The agent must investigate the source and target using MCP when
necessary.

The agent is responsible for determining:

- what the source item represents
- what the target item represents
- whether the item requires transformation
- which fields require changes
- which fields must remain unchanged
- whether IDs must be remapped
- whether a discovered transformation can be applied to other files

---

## 2. Discover once, apply many times

When multiple YAML files appear to follow the same structure,
do NOT independently reason through every file.

Instead:

1. Inspect a representative sample.
2. Query Sitecore XP.
3. Query SitecoreAI.
4. Determine the migration pattern.
5. Validate the pattern against additional samples.
6. Create an internal migration rule.
7. Apply that rule to every matching file.
8. Investigate only files that do not match the rule.

Example:

If the agent determines that all 48 Controller Rendering items
in a rendering folder require:

    Controller Rendering
            ↓
       JSON Rendering

and the only serialized change required is:

    Template:
      XP Controller Rendering ID
            ↓
      SitecoreAI JSON Rendering ID

then the agent must NOT reason independently about all 48 files.

After validating the rule against representative files, apply the
same transformation to all matching Controller Rendering files.

---

# 3. Never guess Sitecore IDs

Never invent or fabricate GUIDs.

When an ID needs to change:

1. Determine what the ID represents.
2. Determine whether the item is shared/global or site-specific.
3. Query SitecoreAI when the target ID is not known.
4. Use the discovered target ID.
5. Record the mapping.

If a target cannot be determined:

    status = unresolved

Do not guess.

---

# 4. Preserve by default

The migration agent must follow this principle:

> Change only what the migration requires.

Do not rewrite or clean up YAML unnecessarily.

Do not:

- reformat unrelated fields
- delete fields without evidence
- rename fields unnecessarily
- modify values that do not require migration
- regenerate IDs
- reorder unrelated structures
- normalize YAML for cosmetic reasons

The goal is a minimal migration diff.

---

# Migration Workflow

## Phase 1 — Discover the migration scope

Before modifying files:

1. Identify the files included in the migration.
2. Group files by:
   - Sitecore template
   - item type
   - path
   - rendering type
   - structural pattern
3. Determine which groups contain repeated structures.

Do not immediately process every file individually.

---

# Phase 2 — Analyze representative files

For each significant group:

1. Select representative YAML files.
2. Read their complete structure.
3. Identify:
   - ID
   - Parent
   - Template
   - Path
   - SharedFields
   - Languages
   - Versions
   - Fields
   - references
4. Determine what the item represents.
5. Query Sitecore XP when source information is required.
6. Query SitecoreAI when target information is required.

Use enough representative files to establish confidence
that the discovered rule applies to the group.

---

# Phase 3 — Build migration rules

After investigating representative files, create an internal
migration plan.

The migration plan should contain rules such as:

```text
Rule:
Source item type:
Source template:
Target item type:
Target template:
Fields to change:
Fields to preserve:
ID mapping requirements:
Applicability:
Validation requirements:
```
