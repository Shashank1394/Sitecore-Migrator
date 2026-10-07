/**
 * Repairs YAML files that were written with the wrong Template GUID format.
 *
 * Bad:  Template: "{04646A89-996F-4EE7-878A-FFDBF1F0EF0D}"   ← braced + uppercase
 * Good: Template: "04646a89-996f-4ee7-878a-ffdbf1f0ef0d"     ← no braces + lowercase
 *
 * Also removes any corruption introduced by the earlier botched PowerShell fix
 * (duplicate content / literal scriptblock text).
 *
 * Usage:
 *   node scripts/fix-corrupt-output.mjs <folder>
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/fix-corrupt-output.mjs <folder>");
  process.exit(1);
}

let fixed = 0;
let skipped = 0;
let errors = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(fullPath);
    } else if (e.isFile() && (extname(e.name) === ".yml" || extname(e.name) === ".yaml")) {
      await fixFile(fullPath);
    }
  }
}

async function fixFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");

    // ── Step 1: strip any corruption from the first PS scriptblock pass ──────
    // The botched pass made the file look like:
    //   ---\nID: ...\nParent: ...\n 'Template: "' + ---\nID: ...\n...clean content...
    // The clean content always starts at the second "---" marker (possibly
    // embedded mid-line). Extract everything from "---\nID:" onward.
    let content = raw;
    
    // Find the LAST occurrence of a YAML doc-start that is followed by \nID:
    const docPattern = /---\r?\nID:/g;
    let lastMatch = null;
    let m;
    while ((m = docPattern.exec(content)) !== null) lastMatch = m;
    if (lastMatch && lastMatch.index > 0) {
      content = content.slice(lastMatch.index);
    }

    // ── Step 2: fix Template: "{UPPERCASE-GUID}" → Template: "lowercase-guid" ─
    const before = content;
    content = content.replace(
      /^(Template:\s*)["']?\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}["']?/gm,
      (_, prefix, guid) => `${prefix}"${guid.toLowerCase()}"`,
    );

    if (content === raw) {
      skipped++;
      return;
    }

    await writeFile(filePath, content, "utf-8");
    fixed++;
    console.log(`✓ Fixed: ${filePath}`);
  } catch (err) {
    errors++;
    console.error(`✕ Error processing ${filePath}: ${err.message}`);
  }
}

console.log(`Scanning: ${folder}\n`);
await walk(folder);
console.log(`\nDone. Fixed: ${fixed}  |  Already clean: ${skipped}  |  Errors: ${errors}`);
