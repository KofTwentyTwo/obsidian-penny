/**
 * PENNY - Per-Project Configuration
 *
 * Reads PENNY.md files from the project directory tree to provide
 * per-project setting overrides. Walks up from a chapter file's
 * directory looking for the nearest PENNY.md.
 *
 * Parsed key-value pairs from the `## Project` section override
 * global settings.
 */

import type { PennySettings } from "./types";

/** Map of PENNY.md keys to PennySettings field names. */
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
 * The real Vault satisfies this shape.
 */
export interface VaultReader {
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
  };
}

/**
 * Walk up from a file's directory looking for a PENNY.md file.
 * Returns the parsed overrides or null if no PENNY.md is found.
 */
export async function findProjectConfig(
  filePath: string,
  vault: VaultReader,
): Promise<Partial<PennySettings> | null> {
  const parts = filePath.split("/");
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
 * Parse the `## Project` section from a PENNY.md file.
 * Extracts simple `key: value` pairs and maps them to PennySettings fields.
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

  const voiceRulesText = voiceLines.join("\n").trim();
  if (voiceRulesText) {
    overrides.customVoiceRules = voiceRulesText;
  }

  return overrides;
}
