/**
 * PENNY - Chapter Migration (pure logic)
 *
 * Logic for converting flat chapter files to versioned folders.
 * Pure functions -- no Obsidian API dependencies.
 */

import type { VersionState } from "./types";

/**
 * A migration plan for a single chapter file.
 */
export interface MigrationPlan {
  /** Original flat file path, e.g. `04-drafts/book-1/ch-01.md` */
  originalPath: string;
  /** Target folder path, e.g. `04-drafts/book-1/ch-01/` */
  folderPath: string;
  /** Path for the v1 file, e.g. `04-drafts/book-1/ch-01/ch-01.v1.md` */
  v1Path: string;
  /** Path for the .version file */
  versionPath: string;
  /** Path for the .state.json file */
  statePath: string;
  /** True if this chapter appears to already be in folder format */
  alreadyMigrated: boolean;
}

/**
 * Given a list of file paths, plan the migration from flat to versioned
 * folder structure.
 *
 * Flat chapter files match `ch-NN.md` (not `ch-NN.vN.md` which are already
 * versioned). Paths that look like they are already inside a chapter folder
 * are marked as `alreadyMigrated`.
 */
export function planMigration(files: string[]): MigrationPlan[] {
  const plans: MigrationPlan[] = [];

  for (const filePath of files) {
    // Extract the filename from the path.
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1];

    // Only process flat chapter files: ch-NN.md (not ch-NN.vN.md).
    const flatChapterRe = /^(ch-\d+)\.md$/;
    const match = filename.match(flatChapterRe);
    if (!match) continue;

    const chapterSlug = match[1]; // e.g. "ch-01"
    const parentDir = parts.slice(0, -1).join("/");

    // Check if the parent directory is already a chapter folder.
    // If the parent dir name matches the chapter slug, it's already migrated.
    const parentDirName = parts.length >= 2 ? parts[parts.length - 2] : "";
    const alreadyMigrated = parentDirName === chapterSlug;

    const folderPath = `${parentDir}/${chapterSlug}`;
    const v1Path = `${folderPath}/${chapterSlug}.v1.md`;
    const versionPath = `${folderPath}/.version`;
    const statePath = `${folderPath}/.state.json`;

    plans.push({
      originalPath: filePath,
      folderPath,
      v1Path,
      versionPath,
      statePath,
      alreadyMigrated,
    });
  }

  return plans;
}

/**
 * Generate the v1 content from the original file.
 * The content stays the same -- this is a straight copy.
 */
export function generateV1Content(originalContent: string): string {
  return originalContent;
}

/**
 * Generate the initial .version file content.
 */
export function generateVersionFile(): string {
  return "1";
}

/**
 * Generate the initial .state.json file content.
 */
export function generateStateJson(): string {
  const initialState: VersionState = {
    version: 1,
    lastProcessed: null,
    processedAnnotations: [],
  };
  return JSON.stringify(initialState, null, 2);
}
