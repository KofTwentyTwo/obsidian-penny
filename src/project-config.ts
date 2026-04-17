/**
 * PENNY - Per-Project Configuration
 *
 * Reads PENNY.md files from the project directory tree to provide
 * per-project setting overrides. Walks up from a chapter file's
 * directory looking for the nearest PENNY.md (like how .gitignore
 * resolution works).
 *
 * A PENNY.md file can contain two sections:
 * - `## Project`: key-value pairs that override PennySettings fields
 *   (e.g. `drafts: my-drafts`, `context-budget: 500000`)
 * - `## Voice Rules`: free-form text that overrides customVoiceRules
 *
 * Called by commands.ts before running the pipeline, so each book or
 * series can have its own style guide paths, voice rules, etc.
 */

import type { PennySettings } from "./types";

/**
 * Map of PENNY.md key names (lowercase, kebab-case) to their corresponding
 * PennySettings field names. Only these keys are recognized in the
 * `## Project` section of a PENNY.md file.
 */
const KEY_MAP: Record<string, keyof PennySettings> = {
  "drafts": "draftsFolder",
  "style-guide": "styleGuide",
  "voice-tests": "voiceTests",
  "characters": "characterSheetsFolder",
  "plot": "plotOutlinesFolder",
  "wiki": "wikiFolder",
  "reviews": "reviewsFolder",
  "series-bible": "seriesBible",
  "themes": "themesFile",
  "context-budget": "contextBudget",
  "max-tokens": "maxTokens",
};

/**
 * Minimal vault interface so this module has no direct Obsidian dependency.
 * The real Obsidian Vault object satisfies this shape at runtime.
 * In tests, a simple mock can be substituted.
 */
export interface VaultReader {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
  };
}

/**
 * Walk up from a file's directory looking for a PENNY.md file.
 * Checks each parent directory up to the vault root.
 *
 * @param filePath - Path of the chapter file being processed
 * @param vault    - Vault reader for checking file existence and reading content
 * @returns Parsed settings overrides, or null if no PENNY.md is found
 */
export async function findProjectConfig(
  filePath: string,
  vault: VaultReader,
): Promise<Partial<PennySettings> | null> {
  // Guard: strip leading slash to prevent absolute adapter paths
  const safePath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  const parts = safePath.split("/");
  // Remove the filename to start from the directory
  parts.pop();

  // Walk up directory tree
  while (parts.length > 0) {
    const candidate = parts.join("/") + "/PENNY.md";
    try {
      const exists = await vault.adapter.exists(candidate);
      if (exists) {
        const content = await vault.adapter.read(candidate);
        return parseProjectConfig(content);
      }
    } catch {
      // Skip unreadable paths
    }
    parts.pop();
  }

  // Check vault root
  try {
    const exists = await vault.adapter.exists("PENNY.md");
    if (exists) {
      const content = await vault.adapter.read("PENNY.md");
      return parseProjectConfig(content);
    }
  } catch {
    // Skip
  }

  return null;
}

/**
 * Parse a PENNY.md file into settings overrides.
 *
 * Extracts:
 * - `## Project` section: simple `key: value` pairs mapped to PennySettings fields
 * - `## Voice Rules` section: free-form text used as customVoiceRules
 *
 * HTML comments within the Voice Rules section are stripped.
 *
 * @param content - Full content of the PENNY.md file
 * @returns Partial PennySettings with only the overridden fields
 */
export function parseProjectConfig(content: string): Partial<PennySettings> {
  const overrides: Partial<PennySettings> = {};

  const lines = content.split("\n");
  let inProjectSection = false;

  for (const line of lines) {
    // Detect section headings
    if (/^##\s+/.test(line)) {
      inProjectSection = /^##\s+Project\b/i.test(line);
      continue;
    }

    if (!inProjectSection) continue;

    // Parse `key: value` pairs
    const kvMatch = line.match(/^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i);
    if (!kvMatch) continue;

    const rawKey = kvMatch[1].toLowerCase().trim();
    const rawValue = kvMatch[2].trim();

    const settingsKey = KEY_MAP[rawKey];
    if (!settingsKey) continue;

    // Type-coerce based on the target field
    if (settingsKey === "contextBudget" || settingsKey === "maxTokens") {
      const num = parseInt(rawValue, 10);
      if (!isNaN(num) && num > 0) {
        (overrides as Record<string, unknown>)[settingsKey] = num;
      }
    } else {
      (overrides as Record<string, unknown>)[settingsKey] = rawValue;
    }
  }

  // Also parse voice rules section
  let inVoiceSection = false;
  const voiceSection: string[] = [];

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inVoiceSection = /^##\s+Voice\s+Rules\b/i.test(line);
      continue;
    }
    if (inVoiceSection) {
      voiceSection.push(line);
    }
  }

  // Filter out multi-line HTML comments from the voice section
  const voiceLines: string[] = [];
  let inComment = false;
  for (const line of voiceSection) {
    if (line.trim().startsWith("<!--")) inComment = true;
    if (inComment) {
      if (line.trim().endsWith("-->")) inComment = false;
      continue;
    }
    voiceLines.push(line);
  }

  // Strip inline HTML comments that weren't caught by the multi-line filter
  const cleaned = voiceLines.map(line =>
    line.replace(/<!--[\s\S]*?-->/g, "").trim()
  ).filter(line => line.length > 0);

  const voiceRulesText = cleaned.join("\n").trim();
  if (voiceRulesText) {
    overrides.customVoiceRules = voiceRulesText;
  }

  return overrides;
}
