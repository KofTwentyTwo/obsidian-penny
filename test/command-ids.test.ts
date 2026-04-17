/**
 * PENNY - Command ID Prefix Test
 *
 * Verifies that command IDs registered in commands.ts do NOT include
 * the "penny:" prefix. Obsidian automatically prepends the plugin manifest
 * ID to command IDs, so including "penny:" in the id field would produce
 * double-prefixed IDs like "penny:penny:process-chapter".
 *
 * This is a structural test that reads the source file directly rather
 * than importing the module (which depends on Obsidian APIs).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMMANDS_SOURCE = readFileSync(
  resolve(__dirname, "../src/commands.ts"),
  "utf-8",
);

/**
 * Extract all command ID strings from addCommand({ id: "..." }) calls.
 * Matches both single-quoted and double-quoted id values.
 */
function extractCommandIds(source: string): string[] {
  const pattern = /id:\s*["']([^"']+)["']/g;
  const ids: string[] = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

describe("command registration IDs", () => {
  const ids = extractCommandIds(COMMANDS_SOURCE);

  it("finds at least one command ID in the source", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it("no command ID starts with 'penny:' (Obsidian adds the prefix automatically)", () => {
    for (const id of ids) {
      expect(id).not.toMatch(/^penny:/);
    }
  });

  it("all command IDs are kebab-case (lowercase alphanumeric with hyphens)", () => {
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("no duplicate command IDs exist", () => {
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
