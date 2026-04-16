/**
 * PENNY - YAML Frontmatter
 *
 * Parse and update chapter frontmatter.
 * Pure functions -- no Obsidian API dependencies.
 *
 * Uses a simple YAML subset parser (key: value pairs, arrays) rather than
 * pulling in a full YAML library, keeping the plugin dependency-free.
 */

import type { ChapterFrontmatter } from "./types";

/** Regex that matches the YAML frontmatter block delimited by `---`. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse frontmatter and body from a chapter file.
 *
 * Returns the parsed frontmatter object and the body text (everything after
 * the closing `---`).  If no frontmatter is found, returns an empty
 * frontmatter object and the full content as body.
 */
export function parseFrontmatter(content: string): {
  frontmatter: ChapterFrontmatter;
  body: string;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = match[1];
  const body = content.slice(match[0].length).replace(/^\r?\n/, "");
  const frontmatter: ChapterFrontmatter = {};

  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Array continuation: `  - value`
    if (/^\s+-\s+/.test(line) && currentKey && currentArray !== null) {
      const val = line.replace(/^\s+-\s+/, "").trim();
      currentArray.push(val);
      continue;
    }

    // Flush any pending array.
    if (currentKey && currentArray !== null) {
      (frontmatter as Record<string, unknown>)[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key: value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // If value is empty, this might be the start of an array.
    if (rawValue === "" || rawValue === "[]") {
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Inline array: [a, b, c]
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1);
      const items = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
      (frontmatter as Record<string, unknown>)[key] = items;
      continue;
    }

    // Parse value type.
    (frontmatter as Record<string, unknown>)[key] = parseYamlValue(rawValue);
  }

  // Flush any trailing array.
  if (currentKey && currentArray !== null) {
    (frontmatter as Record<string, unknown>)[currentKey] = currentArray;
  }

  return { frontmatter, body };
}

function parseYamlValue(raw: string): string | number | boolean {
  // Remove surrounding quotes.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Number
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.length > 0) return num;
  // String
  return raw;
}

/**
 * Check if a string value needs quoting for safe YAML serialization.
 * Values containing YAML-unsafe characters must be double-quoted.
 */
function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;
  // Leading/trailing whitespace
  if (value !== value.trim()) return true;
  // Starts with a YAML-special character
  if (/^[@!*&'"]/.test(value)) return true;
  // Contains characters that could break YAML parsing
  if (/[:#\[\]{}"']/.test(value)) return true;
  return false;
}

/**
 * Quote a string value for YAML serialization using double quotes.
 * Internal double quotes are escaped.
 */
function quoteYamlValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Serialize frontmatter and body back into a markdown string.
 */
export function serializeFrontmatter(frontmatter: ChapterFrontmatter, body: string): string {
  const yamlLines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        yamlLines.push(`${key}:`);
      } else {
        yamlLines.push(`${key}:`);
        for (const item of value) {
          const itemStr = String(item);
          yamlLines.push(`  - ${needsYamlQuoting(itemStr) ? quoteYamlValue(itemStr) : itemStr}`);
        }
      }
    } else if (typeof value === "string" && value === "") {
      yamlLines.push(`${key}: ""`);
    } else if (typeof value === "string" && needsYamlQuoting(value)) {
      yamlLines.push(`${key}: ${quoteYamlValue(value)}`);
    } else {
      yamlLines.push(`${key}: ${value}`);
    }
  }

  const yaml = yamlLines.join("\n");
  return `---\n${yaml}\n---\n${body}`;
}

/**
 * Update agent-managed fields on the frontmatter.
 * Returns a new object; does not mutate the input.
 */
export function updateAgentFields(
  frontmatter: ChapterFrontmatter,
  updates: Partial<ChapterFrontmatter>,
): ChapterFrontmatter {
  return { ...frontmatter, ...updates };
}

/**
 * Count prose words in the chapter body.
 *
 * Only counts text after the `proseMarker` comment.  If the marker is not
 * found, counts all words in the body.
 */
export function countProseWords(content: string, proseMarker: string): number {
  let text = content;

  if (proseMarker) {
    const idx = content.indexOf(proseMarker);
    if (idx !== -1) {
      text = content.slice(idx + proseMarker.length);
    }
  }

  // Strip markdown comments %% ... %%
  text = text.replace(/%%.*?%%/g, "");
  // Strip HTML comments <!-- ... -->
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Strip markdown headings markers (keep the text)
  text = text.replace(/^#{1,6}\s/gm, "");

  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Detect characters mentioned in the chapter.
 *
 * 1. Parse the `focus` frontmatter field (comma-separated names).
 * 2. Scan dialogue for attribution patterns like `NAME said`, `said NAME`,
 *    `NAME asked`, etc.
 *
 * Returns a deduplicated, lowercased array of character identifiers.
 */
export function detectCharacters(content: string, focusField: string): string[] {
  const chars = new Set<string>();

  // From focus field.
  if (focusField) {
    const parts = focusField.split(/[,+&]/).map((s) => s.trim().toLowerCase());
    for (const p of parts) {
      if (p.length > 0) chars.add(p);
    }
  }

  // From dialogue attribution patterns.
  const attributionRe = /(?:^|\s)([A-Z][a-z]+)\s+(?:said|asked|whispered|muttered|yelled|replied|shouted|murmured|called|snapped)/gm;
  let m: RegExpExecArray | null;
  while ((m = attributionRe.exec(content)) !== null) {
    chars.add(m[1].toLowerCase());
  }

  // Reverse: `said Name`
  const reverseRe = /(?:said|asked|whispered|muttered|yelled|replied|shouted|murmured|called|snapped)\s+([A-Z][a-z]+)/gm;
  while ((m = reverseRe.exec(content)) !== null) {
    chars.add(m[1].toLowerCase());
  }

  return Array.from(chars);
}
