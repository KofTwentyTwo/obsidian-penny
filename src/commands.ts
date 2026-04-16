/**
 * PENNY - Command Registration
 *
 * Registers all command palette commands and defines the ProjectInitModal
 * for scaffolding new novel projects.
 */

import { FileSystemAdapter, Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import { execFile } from "child_process";
import type PennyPlugin from "./main";
import type { ProjectInitOptions } from "./types";
import { parseAnnotations } from "./parser";
import { selectVoiceTestSection } from "./context";
import type { ContextFiles } from "./context";
import { parseFrontmatter, detectCharacters } from "./frontmatter";
import { getReviewFilePath } from "./reviewer";
import { getLogFilePath } from "./logger";
import { runPipeline } from "./pipeline";
import type { PipelineResult } from "./pipeline";
import { globMatch } from "./utils";
import { readVersion, nextVersion } from "./versioner";
import { generateStateJson } from "./migrate";
import { findProjectConfig } from "./project-config";

/**
 * Normalize a settings path by stripping trailing slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\/+$/, "");
}

/**
 * Register all PENNY commands with the Obsidian command palette.
 *
 * @param plugin - The PENNY plugin instance
 */
export function registerCommands(plugin: PennyPlugin): void {
  // -- Initialize project ------------------------------------------------
  plugin.addCommand({
    id: "penny:init",
    name: "Initialize project",
    callback: () => {
      new ProjectInitModal(plugin).open();
    },
  });

  // -- Process this chapter ----------------------------------------------
  plugin.addCommand({
    id: "penny:process-chapter",
    name: "Process this chapter",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !isChapterFile(file, plugin)) return false;
      if (checking) return true;

      if (!requireProvider(plugin)) return;
      processChapter(plugin, file);
    },
  });

  // -- Process all chapters ----------------------------------------------
  plugin.addCommand({
    id: "penny:process-all",
    name: "Process all chapters",
    callback: async () => {
      if (!requireProvider(plugin)) return;

      const chapters = getAnnotatedChapters(plugin);
      if (chapters.length === 0) {
        new Notice("PENNY: No annotated chapters found.");
        return;
      }

      new Notice(`PENNY: Processing ${chapters.length} chapter(s)...`);
      let processedCount = 0;
      let totalAnnotations = 0;
      let skippedCount = 0;
      for (const file of chapters) {
        const result = await processChapter(plugin, file, { silent: true });
        if (result) {
          processedCount++;
          totalAnnotations += result.annotationsProcessed;
        } else {
          skippedCount++;
        }
      }
      new Notice(
        `PENNY: Processed ${processedCount} chapters (${totalAnnotations} annotations), skipped ${skippedCount} with no annotations.`,
      );
    },
  });

  // -- Dry run -----------------------------------------------------------
  plugin.addCommand({
    id: "penny:dry-run",
    name: "Dry run",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !isChapterFile(file, plugin)) return false;
      if (checking) return true;

      dryRun(plugin, file);
    },
  });

  // -- Migrate chapters --------------------------------------------------
  plugin.addCommand({
    id: "penny:migrate",
    name: "Migrate chapters",
    callback: () => {
      migrateChapters(plugin);
    },
  });

  // -- Show status -------------------------------------------------------
  plugin.addCommand({
    id: "penny:status",
    name: "Show status",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file) return false;
      if (checking) return true;

      showStatus(plugin, file);
    },
  });

  // -- New chapter -------------------------------------------------------
  plugin.addCommand({
    id: "penny:new-chapter",
    name: "New chapter",
    callback: () => {
      createNewChapter(plugin);
    },
  });

  // -- New character -----------------------------------------------------
  plugin.addCommand({
    id: "penny:new-character",
    name: "New character",
    callback: () => {
      createNewCharacter(plugin);
    },
  });

  // -- Git commit --------------------------------------------------------
  plugin.addCommand({
    id: "penny:git-commit",
    name: "Commit progress",
    callback: () => {
      gitCommit(plugin);
    },
  });

  // -- Git push ----------------------------------------------------------
  plugin.addCommand({
    id: "penny:git-push",
    name: "Push",
    callback: () => {
      gitPush(plugin);
    },
  });

  // -- Git commit and push -----------------------------------------------
  plugin.addCommand({
    id: "penny:git-commit-push",
    name: "Commit and push",
    callback: async () => {
      await gitCommit(plugin);
      await gitPush(plugin);
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check that every LLM provider referenced by any route tier is properly
 * configured. Validates all three routes (light, standard, heavy) rather
 * than just the standard route.
 *
 * Returns true only if every required provider is usable.
 */
function requireProvider(plugin: PennyPlugin): boolean {
  const s = plugin.settings;

  const routes: Array<{ tier: string; provider: string }> = s.useSameModelForAll
    ? [{ tier: "standard", provider: s.routeStandard.provider }]
    : [
        { tier: "light", provider: s.routeLight.provider },
        { tier: "standard", provider: s.routeStandard.provider },
        { tier: "heavy", provider: s.routeHeavy.provider },
      ];

  // De-duplicate providers while keeping which tier(s) use them
  const providerTiers = new Map<string, string[]>();
  for (const r of routes) {
    const existing = providerTiers.get(r.provider) ?? [];
    existing.push(r.tier);
    providerTiers.set(r.provider, existing);
  }

  for (const [provider, tiers] of providerTiers) {
    const tierLabel = tiers.map((t) => `'${t}'`).join(", ");

    if (provider === "anthropic") {
      if (!s.anthropicApiKey) {
        new Notice(
          `PENNY: Route ${tierLabel} uses Anthropic but no API key is set. Open Settings > PENNY > Providers.`
        );
        return false;
      }
    } else if (provider === "ollama") {
      if (!s.ollamaEndpoint) {
        new Notice(
          `PENNY: Route ${tierLabel} uses Ollama but no endpoint is configured. Open Settings > PENNY > Providers.`
        );
        return false;
      }
    } else {
      new Notice(
        `PENNY: Route ${tierLabel} uses unknown provider '${provider}'. Check Settings > PENNY > Model Routing.`
      );
      return false;
    }
  }

  return true;
}

/**
 * Check whether a file matches the chapter file pattern.
 */
function isChapterFile(file: TFile, plugin: PennyPlugin): boolean {
  return globMatch(plugin.settings.chapterFilePattern, file.name);
}

/**
 * Find all chapter files that contain actionable annotations.
 */
function getAnnotatedChapters(plugin: PennyPlugin): TFile[] {
  const allFiles = plugin.app.vault.getMarkdownFiles();
  const draftsFolder = normalizePath(plugin.settings.draftsFolder);

  return allFiles.filter((f) => {
    if (!f.path.startsWith(draftsFolder + "/")) return false;
    if (!isChapterFile(f, plugin)) return false;
    // We cannot synchronously read content here, so return all chapter files.
    // The process function will skip files with no actionable annotations.
    return true;
  });
}

// ============================================================================
// Command implementations
// ============================================================================

/**
 * Safely read a vault file by path. Returns empty string if the file
 * does not exist or cannot be read.
 */
async function safeRead(plugin: PennyPlugin, path: string): Promise<string> {
  if (!path) return "";
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!file || !(file instanceof TFile)) return "";
  try {
    return await plugin.app.vault.read(file);
  } catch {
    return "";
  }
}

/**
 * Read all markdown files in a folder, returning their contents as an array.
 * Returns empty array if the folder does not exist.
 */
async function readFolderFiles(plugin: PennyPlugin, folderPath: string): Promise<string[]> {
  if (!folderPath) return [];
  const results: string[] = [];
  const allFiles = plugin.app.vault.getMarkdownFiles();
  const prefix = normalizePath(folderPath) + "/";
  for (const f of allFiles) {
    if (f.path.startsWith(prefix)) {
      try {
        const content = await plugin.app.vault.cachedRead(f);
        if (content.trim()) results.push(content);
      } catch {
        // Skip unreadable files
      }
    }
  }
  return results;
}

/**
 * Gather all context files from the vault based on settings paths.
 */
async function gatherContextFiles(
  plugin: PennyPlugin,
  chapterContent: string,
  characters: string[],
  bookId: string,
): Promise<ContextFiles> {
  const s = plugin.settings;

  // Normalize all folder/file paths to strip trailing slashes
  const plotOutlinesFolder = normalizePath(s.plotOutlinesFolder);
  const characterSheetsFolder = normalizePath(s.characterSheetsFolder);
  const wikiFolder = normalizePath(s.wikiFolder);

  // Read voice tests and pre-filter by detected characters
  let voiceTests = await safeRead(plugin, s.voiceTests);
  if (voiceTests && characters.length > 0) {
    voiceTests = selectVoiceTestSection(voiceTests, characters);
  }

  const styleGuide = await safeRead(plugin, s.styleGuide);

  // Read book-specific outline: {plotOutlinesFolder}/{bookId}/outline.md
  // Fall back to reading plotOutlinesFolder as a file path (user may have set a direct file)
  let outline = "";
  if (plotOutlinesFolder) {
    const bookOutlinePath = `${plotOutlinesFolder}/${bookId}/outline.md`;
    outline = await safeRead(plugin, bookOutlinePath);
    if (!outline) {
      outline = await safeRead(plugin, plotOutlinesFolder);
    }
  }

  const seriesBible = await safeRead(plugin, s.seriesBible);
  const themes = await safeRead(plugin, s.themesFile);
  const characterFiles = await readFolderFiles(plugin, characterSheetsFolder);
  const wikiFiles = await readFolderFiles(plugin, wikiFolder);

  return {
    chapter: chapterContent,
    voiceTests,
    styleGuide,
    outline,
    seriesBible,
    themes,
    characters: characterFiles,
    wiki: wikiFiles,
  };
}

/**
 * Extract the chapter folder path from a chapter file.
 * e.g. "04-drafts/book-1/ch-05/ch-05.v2.md" -> "04-drafts/book-1/ch-05"
 */
function chapterFolderPath(file: TFile): string {
  const parts = file.path.split("/");
  parts.pop(); // remove filename
  return parts.join("/");
}

/**
 * Extract a chapter identifier from a file.
 * e.g. "ch-05.v2" -> "ch-05"
 */
function chapterIdFromFile(file: TFile): string {
  return file.basename.replace(/\.v\d+$/, "");
}

/**
 * Extract book identifier from the file path.
 * e.g. "04-drafts/book-1/ch-05/ch-05.v2.md" -> "book-1"
 */
function bookIdFromFile(file: TFile): string {
  const parts = file.path.split("/");
  for (const p of parts) {
    if (/^book-\d+$/.test(p)) return p;
  }
  return "book-1";
}


// Pipeline logic lives in ./pipeline.ts

/**
 * Process annotations in a single chapter file.
 * Runs the full pipeline: parse -> context -> draft -> assemble -> version.
 */
export async function processChapter(plugin: PennyPlugin, file: TFile, options?: { silent?: boolean }): Promise<PipelineResult | null> {
  plugin.processingFiles.add(file.path);

  // Paths of files we create during processing -- added to processingFiles
  // BEFORE vault.create to prevent the auto-save hook from picking them up.
  const createdPaths: string[] = [];

  try {
  let content: string;
  try {
    content = await plugin.app.vault.read(file);
  } catch (readErr) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    new Notice(`PENNY: Failed to read ${file.basename} -- ${msg}`);
    return null;
  }

  // Quick check: any actionable annotations at all?
  const allAnnotations = parseAnnotations(content);
  const actionableCount = allAnnotations.filter((a) => a.actionable).length;

  if (actionableCount === 0) {
    if (!options?.silent) {
      new Notice(`PENNY: No actionable annotations in ${file.basename}.`);
    }
    return null;
  }

  plugin.statusBar?.setProcessing();

  try {
    // Merge per-project config overrides from PENNY.md (if present)
    let s = plugin.settings;
    const projectOverrides = await findProjectConfig(file.path, plugin.app.vault);
    if (projectOverrides) {
      s = { ...s, ...projectOverrides };
    }

    // Normalize folder paths from settings
    const reviewsFolder = normalizePath(s.reviewsFolder);
    const activityLogFolder = normalizePath(s.activityLogFolder);

    const folderPath = chapterFolderPath(file);
    const chapterId = chapterIdFromFile(file);
    const bookId = bookIdFromFile(file);

    if (s.verboseLogging) {
      console.log(`[PENNY] Processing ${file.path} (chapter: ${chapterId}, book: ${bookId})`);
    }

    // Read version and state files
    const versionContent = await safeRead(plugin, `${folderPath}/.version`);
    const stateContent = await safeRead(plugin, `${folderPath}/.state.json`);

    // Detect characters for voice test pre-filtering
    const { frontmatter: fm } = parseFrontmatter(content);
    const focusField = typeof fm.focus === "string" ? fm.focus : "";
    const detectedChars = detectCharacters(content, focusField);

    // Gather context files from vault
    const contextFiles = await gatherContextFiles(plugin, content, detectedChars, bookId);

    if (s.verboseLogging) {
      console.log(`[PENNY] Annotations found: ${actionableCount} actionable`);
    }

    // Pre-compute all output paths and add to processingFiles BEFORE the
    // pipeline runs, preventing the auto-save hook from picking them up
    // during the async pipeline execution.
    const currentVersion = readVersion(versionContent);
    const expectedNextVersion = nextVersion(currentVersion);
    const newVersionPath = `${folderPath}/${chapterId}.v${expectedNextVersion}.md`;
    const versionFilePath = `${folderPath}/.version`;
    const stateFilePath = `${folderPath}/.state.json`;

    const newPaths = [newVersionPath, versionFilePath, stateFilePath];
    for (const p of newPaths) {
      plugin.processingFiles.add(p);
      createdPaths.push(p);
    }

    // Run the pipeline
    const result = await runPipeline({
      content,
      versionContent,
      stateContent,
      contextFiles,
      settings: s,
      chapterId,
      bookId,
      getProvider: (name: string) => {
        if (s.verboseLogging) {
          console.log(`[PENNY] Provider requested: ${name}`);
        }
        return plugin.providerRegistry.get(name);
      },
    });

    if (!result) {
      if (!options?.silent) {
        new Notice(`PENNY: No new annotations to process in ${file.basename}.`);
      }
      return null;
    }

    if (s.verboseLogging) {
      console.log(`[PENNY] Pipeline complete: ${result.annotationsProcessed} processed, v${result.newVersion} (${result.durationMs}ms)`);
    }

    // Write new version file
    await plugin.app.vault.create(newVersionPath, result.newContent);

    // Update .version file
    const versionFile = plugin.app.vault.getAbstractFileByPath(versionFilePath);
    if (versionFile && versionFile instanceof TFile) {
      await plugin.app.vault.modify(versionFile, String(result.newVersion));
    } else {
      await plugin.app.vault.create(versionFilePath, String(result.newVersion));
    }

    // Update .state.json
    const stateFile = plugin.app.vault.getAbstractFileByPath(stateFilePath);
    if (stateFile && stateFile instanceof TFile) {
      await plugin.app.vault.modify(stateFile, result.stateJson);
    } else {
      await plugin.app.vault.create(stateFilePath, result.stateJson);
    }

    // Write review note
    const reviewPath = getReviewFilePath(reviewsFolder, bookId, chapterId, result.newVersion);
    const reviewFolder = reviewPath.split("/").slice(0, -1).join("/");
    await ensureFolder(plugin, reviewFolder);
    await plugin.app.vault.create(reviewPath, result.reviewContent);

    // Append to activity log
    const logPath = getLogFilePath(activityLogFolder, bookId);
    const logFolder = logPath.split("/").slice(0, -1).join("/");
    await ensureFolder(plugin, logFolder);
    const existingLog = plugin.app.vault.getAbstractFileByPath(logPath);
    if (existingLog && existingLog instanceof TFile) {
      const existing = await plugin.app.vault.read(existingLog);
      await plugin.app.vault.modify(existingLog, existing + result.logLine);
    } else {
      await plugin.app.vault.create(logPath, result.logLine);
    }

    if (s.verboseLogging) {
      console.log(`[PENNY] Version ${result.newVersion} created for ${chapterId}`);
    }

    // Show completion notice
    const errorNote = result.hadErrors ? " (with errors -- check review note)" : "";
    new Notice(
      `PENNY: Processed ${result.annotationsProcessed} annotation(s) in ${file.basename}. ` +
        `Created v${result.newVersion}${errorNote}. (${result.durationMs}ms)`,
      8000,
    );

    // Auto-commit if enabled
    if (s.autoCommitAfterProcessing) {
      await gitCommit(plugin, {
        chapter: chapterId,
        version: String(result.newVersion),
        tags: result.tags.join(", "),
      });
      if (s.autoPushAfterCommit) {
        await gitPush(plugin);
      }
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Error processing ${file.basename} -- ${message}`);
    return null;
  } finally {
    plugin.statusBar?.setReady();
    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile) {
      plugin.statusBar?.update(activeFile, plugin);
    }
  }
  } finally {
    plugin.processingFiles.delete(file.path);
    // Clean up all created file paths from the processing guard
    for (const p of createdPaths) {
      plugin.processingFiles.delete(p);
    }
  }
}

/**
 * Show annotation counts and what would change without processing.
 */
async function dryRun(plugin: PennyPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const annotations = parseAnnotations(content);
  const actionableCount = annotations.filter((a) => a.actionable).length;
  const passthroughCount = annotations.filter((a) => !a.actionable).length;
  const total = annotations.length;

  const lines: string[] = [
    `PENNY Dry Run: ${file.basename}`,
    `---`,
    `Total annotations: ${total}`,
    `  Actionable: ${actionableCount} (would be processed)`,
    `  NOTE/RESEARCH: ${passthroughCount} (would be preserved)`,
  ];

  if (actionableCount === 0) {
    lines.push("", "Nothing to process.");
  } else {
    // Show per-tag breakdown
    const tagCounts: Record<string, number> = {};
    for (const a of annotations) {
      if (a.actionable) {
        tagCounts[a.tag] = (tagCounts[a.tag] || 0) + 1;
      }
    }
    lines.push("", "Breakdown:");
    for (const [tag, count] of Object.entries(tagCounts)) {
      lines.push(`  ${tag}: ${count}`);
    }
    lines.push("", `Running "Process this chapter" would create a new version.`);
  }

  new Notice(lines.join("\n"), 10000);
}

/**
 * Show status information for the active file.
 */
async function showStatus(plugin: PennyPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const annotations = parseAnnotations(content);
  const actionableCount = annotations.filter((a) => a.actionable).length;
  const passthroughCount = annotations.filter((a) => !a.actionable).length;

  const versionMatch = file.basename.match(/\.v(\d+)$/);
  const version = versionMatch ? versionMatch[1] : "unknown";

  const lines: string[] = [
    `PENNY Status: ${file.basename}`,
    `---`,
    `Version: ${version}`,
    `Actionable annotations: ${actionableCount}`,
    `Notes/research: ${passthroughCount}`,
    `---`,
    `Annotation syntax: %% TAG: instruction %%`,
    `Tags: REWRITE, EXPAND, CUT, TONE, DIALOG, PLOT, PACING, CHARACTER`,
    `Non-processed: NOTE, RESEARCH`,
  ];

  new Notice(lines.join("\n"), 12000);
}

/**
 * Migrate flat chapter files to versioned folder structure.
 */
async function migrateChapters(plugin: PennyPlugin): Promise<void> {
  const draftsFolder = normalizePath(plugin.settings.draftsFolder);
  const abstractFile = plugin.app.vault.getAbstractFileByPath(draftsFolder);

  if (!abstractFile || !(abstractFile instanceof TFolder)) {
    new Notice(
      `PENNY: Drafts folder "${draftsFolder}" not found. Check your project structure settings.`
    );
    return;
  }

  let migratedCount = 0;
  let skippedCount = 0;

  // Iterate through book folders
  for (const child of abstractFile.children) {
    if (!(child instanceof TFolder)) continue;
    const bookFolder = child;

    for (const bookChild of bookFolder.children) {
      if (!(bookChild instanceof TFile)) continue;
      if (!isChapterFile(bookChild, plugin)) continue;

      // Already in a versioned folder -- skip
      const parentName = bookChild.parent?.name;
      if (parentName && parentName === bookChild.basename.replace(/\.md$/, "")) {
        skippedCount++;
        continue;
      }

      const chapterName = bookChild.basename.replace(/\.md$/, "");
      const chapterFolderPath = `${bookFolder.path}/${chapterName}`;
      const versionedFilePath = `${chapterFolderPath}/${chapterName}.v1.md`;
      const versionFilePath = `${chapterFolderPath}/.version`;

      try {
        // Read original content
        const content = await plugin.app.vault.read(bookChild);

        // Create the chapter folder
        await ensureFolder(plugin, chapterFolderPath);

        // Write versioned file
        await plugin.app.vault.create(versionedFilePath, content);

        // Verify the written file matches the original content
        const versionedFile = plugin.app.vault.getAbstractFileByPath(versionedFilePath);
        if (!versionedFile || !(versionedFile instanceof TFile)) {
          new Notice(
            `PENNY: Migration verification failed for ${bookChild.path} -- versioned file not found after write. Original left intact.`
          );
          continue;
        }
        const writtenContent = await plugin.app.vault.read(versionedFile);
        if (writtenContent !== content) {
          new Notice(
            `PENNY: Migration verification failed for ${bookChild.path} -- written content does not match original. Original left intact.`
          );
          continue;
        }

        // Write .version manifest
        await plugin.app.vault.create(versionFilePath, "1");

        // Write .state.json
        const stateFilePath = `${chapterFolderPath}/.state.json`;
        await plugin.app.vault.create(stateFilePath, generateStateJson());

        // Remove original flat file only after verified write
        await plugin.app.vault.delete(bookChild);

        migratedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(
          `PENNY: Failed to migrate ${bookChild.path} -- ${message}`
        );
      }
    }
  }

  if (migratedCount === 0 && skippedCount === 0) {
    new Notice(
      `PENNY: No flat chapter files found. Chapters may already be migrated, or check that your drafts folder structure matches: ${draftsFolder}/{book-N}/ch-XX.md`,
    );
  } else {
    new Notice(
      `PENNY: Migration complete. Migrated: ${migratedCount}, already migrated: ${skippedCount}.`
    );
  }
}

/**
 * Create a new chapter file from template.
 */
async function createNewChapter(plugin: PennyPlugin): Promise<void> {
  const activeFile = plugin.app.workspace.getActiveFile();
  const draftsFolder = normalizePath(plugin.settings.draftsFolder);

  // Try to infer the book folder from the active file.
  // Compute depth dynamically so multi-segment draftsFolder paths work correctly.
  let bookFolderPath: string | null = null;
  if (activeFile && activeFile.path.startsWith(draftsFolder + "/")) {
    const parts = activeFile.path.split("/");
    const draftsParts = draftsFolder.split("/").length;
    if (parts.length > draftsParts) {
      bookFolderPath = parts.slice(0, draftsParts + 1).join("/");
    }
  }

  if (!bookFolderPath) {
    bookFolderPath = `${draftsFolder}/book-1`;
  }

  // Find the next chapter number
  const existingFiles = plugin.app.vault.getMarkdownFiles().filter((f) =>
    f.path.startsWith(bookFolderPath + "/")
  );

  let maxChapter = 0;
  const chapterNumPattern = /ch-(\d+)/;
  for (const f of existingFiles) {
    const match = f.path.match(chapterNumPattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxChapter) maxChapter = num;
    }
  }

  const nextNum = maxChapter + 1;
  const paddedNum = String(nextNum).padStart(2, "0");
  const chapterName = `ch-${paddedNum}`;
  const chapterFolderPath = `${bookFolderPath}/${chapterName}`;
  const filePath = `${chapterFolderPath}/${chapterName}.v1.md`;

  // Extract book number from folder name
  const bookMatch = bookFolderPath.match(/book-(\d+)/);
  const bookNum = bookMatch ? parseInt(bookMatch[1], 10) : 1;

  const content = generateChapterTemplate(bookNum, nextNum);

  try {
    await ensureFolder(plugin, chapterFolderPath);
    const newFile = await plugin.app.vault.create(filePath, content);
    await plugin.app.vault.create(`${chapterFolderPath}/.version`, "1");
    await plugin.app.vault.create(`${chapterFolderPath}/.state.json`, generateStateJson());

    // Open the new file
    await plugin.app.workspace.getLeaf("tab").openFile(newFile);
    new Notice(`PENNY: Created ${chapterName} in ${bookFolderPath}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Failed to create chapter -- ${message}`);
  }
}

/**
 * Create a new character file from template.
 */
async function createNewCharacter(plugin: PennyPlugin): Promise<void> {
  const charFolder = plugin.settings.characterSheetsFolder;
  if (!charFolder) {
    new Notice(
      "PENNY: Character sheets folder not configured. Set it in Settings > PENNY > Project Structure."
    );
    return;
  }

  const supportingPath = `${charFolder}/supporting`;
  await ensureFolder(plugin, supportingPath);

  // Generate a placeholder name
  const timestamp = Date.now();
  const filePath = `${supportingPath}/new-character-${timestamp}.md`;

  const content = [
    "---",
    "type: character",
    "role: supporting",
    'book-appearance: [1]',
    "status: draft",
    "---",
    "",
    "# Character Name",
    "",
    "## Overview",
    "",
    "> One-sentence summary of who this character is and what they want.",
    "",
    "## Physical Description",
    "",
    "",
    "## Personality",
    "",
    "",
    "## Background",
    "",
    "",
    "## Voice",
    "",
    "> How does this character speak? What makes their dialogue recognizable?",
    "",
    "## Relationship to Protagonist",
    "",
    "",
    "## Arc",
    "",
    "> How does this character change across the story?",
    "",
  ].join("\n");

  try {
    const newFile = await plugin.app.vault.create(filePath, content);
    await plugin.app.workspace.getLeaf("tab").openFile(newFile);
    new Notice("PENNY: Created new character file. Rename it to match the character.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Failed to create character file -- ${message}`);
  }
}

// ============================================================================
// Git commands
// ============================================================================

/**
 * Execute a git command in the vault directory using execFile
 * to avoid shell injection risks.
 *
 * @param plugin - Plugin instance for vault path resolution
 * @param args - Array of arguments to pass to git
 * @returns stdout output trimmed
 */
function gitExec(plugin: PennyPlugin, args: string[]): Promise<string> {
  const vaultPath = getVaultBasePath(plugin);
  if (!vaultPath) {
    return Promise.reject(new Error("Vault adapter is not a local filesystem"));
  }
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", vaultPath, ...args],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/**
 * Get the vault's base filesystem path.
 * Returns null if the adapter is not a FileSystemAdapter (e.g., a sync adapter).
 */
function getVaultBasePath(plugin: PennyPlugin): string | null {
  if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
    return null;
  }
  return plugin.app.vault.adapter.getBasePath();
}

/**
 * Verify all prerequisites for git operations:
 * 1. Vault uses a local FileSystemAdapter
 * 2. Git is installed and on PATH
 * 3. The vault directory is inside a git repository
 *
 * Returns the vault path on success, or null after showing a Notice on failure.
 */
async function verifyGitPrerequisites(plugin: PennyPlugin): Promise<string | null> {
  const vaultPath = getVaultBasePath(plugin);
  if (!vaultPath) {
    new Notice("PENNY: Git operations require a local vault (not a sync adapter).");
    return null;
  }

  // Check git is installed
  try {
    await gitExecRaw(["--version"]);
  } catch {
    new Notice("PENNY: Git is not installed or not on PATH.");
    return null;
  }

  // Check vault is a git repo
  try {
    const result = await gitExecRaw(["-C", vaultPath, "rev-parse", "--is-inside-work-tree"]);
    if (result.trim() !== "true") {
      new Notice("PENNY: This vault is not a git repository. Run 'git init' first.");
      return null;
    }
  } catch {
    new Notice("PENNY: This vault is not a git repository. Run 'git init' first.");
    return null;
  }

  return vaultPath;
}

/**
 * Execute a raw git command (without vault path prefix).
 * Used for prerequisite checks like `git --version`.
 */
function gitExecRaw(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { timeout: 10000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/** Optional processing result info for building formatted commit messages. */
interface CommitContext {
  chapter?: string;
  version?: string;
  tags?: string;
}

/**
 * Stage and commit changes with an auto-generated message.
 *
 * When called with a CommitContext (after processing), uses the user's
 * commitMessageFormat template. Otherwise builds a message from changed files.
 */
async function gitCommit(plugin: PennyPlugin, ctx?: CommitContext): Promise<void> {
  const vaultPath = await verifyGitPrerequisites(plugin);
  if (!vaultPath) return;

  try {
    // Check for changes
    const status = await gitExec(plugin, ["status", "--porcelain"]);
    if (!status) {
      new Notice("PENNY: No changes to commit.");
      return;
    }

    // Build commit message from changed files
    const changedFiles = status
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const chapterChanges: string[] = [];
    const reviewChanges: string[] = [];
    const otherChanges: string[] = [];

    for (const line of changedFiles) {
      const filePath = line.slice(3); // Strip status prefix (e.g., " M " or "?? ")
      if (filePath.includes("04-drafts") || filePath.includes("drafts")) {
        const chMatch = filePath.match(/ch-\d+/);
        if (chMatch && !chapterChanges.includes(chMatch[0])) {
          chapterChanges.push(chMatch[0]);
        }
      } else if (
        filePath.includes("07-reviews") ||
        filePath.includes("reviews")
      ) {
        reviewChanges.push(filePath);
      } else {
        otherChanges.push(filePath);
      }
    }

    // Use commitMessageFormat template when we have processing context
    let message: string;
    const fmt = plugin.settings.commitMessageFormat;
    if (ctx && fmt) {
      message = fmt
        .replace(/\{chapter\}/g, ctx.chapter ?? chapterChanges.join(", ") ?? "unknown")
        .replace(/\{version\}/g, ctx.version ?? "?")
        .replace(/\{tags\}/g, ctx.tags ?? "");
    } else if (chapterChanges.length > 0) {
      message = `docs: revise ${chapterChanges.join(", ")}`;
    } else {
      message = "docs: PENNY writing session";
    }

    const bodyParts: string[] = [];
    if (chapterChanges.length > 0) {
      bodyParts.push(`Chapters: ${chapterChanges.join(", ")}`);
    }
    if (reviewChanges.length > 0) {
      bodyParts.push(`Reviews: ${reviewChanges.length} file(s)`);
    }
    if (otherChanges.length > 0) {
      bodyParts.push(`Other: ${otherChanges.length} file(s)`);
    }

    const fullMessage =
      bodyParts.length > 0
        ? `${message}\n\n${bodyParts.join("\n")}`
        : message;

    // Stage and commit
    await gitExec(plugin, ["add", "-A"]);
    await gitExec(plugin, ["commit", "-m", fullMessage]);

    new Notice(`PENNY: Committed. ${message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Git commit failed -- ${message}`);
  }
}

/**
 * Push to the remote repository.
 */
async function gitPush(plugin: PennyPlugin): Promise<void> {
  const vaultPath = await verifyGitPrerequisites(plugin);
  if (!vaultPath) return;

  try {
    await gitExec(plugin, ["push"]);
    new Notice("PENNY: Pushed to remote.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Git push failed -- ${message}`);
  }
}

// ============================================================================
// Project scaffolding
// ============================================================================

/**
 * Ensure a folder exists in the vault, creating parent folders as needed.
 */
async function ensureFolder(plugin: PennyPlugin, path: string): Promise<void> {
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;

  // Create parent folders recursively
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = plugin.app.vault.getAbstractFileByPath(current);
    if (!(folder instanceof TFolder)) {
      await plugin.app.vault.createFolder(current);
    }
  }
}

/**
 * Generate template content for a new chapter file.
 */
function generateChapterTemplate(book: number, chapter: number): string {
  return [
    "---",
    "type: chapter",
    `book: ${book}`,
    `chapter: ${chapter}`,
    'title: ""',
    "pov: protagonist",
    "status: outline",
    "wordcount: 0",
    'focus: ""',
    'thread: ""',
    "act: 1",
    "---",
    "",
    `# Book ${book}, Chapter ${chapter}`,
    "",
    "## Scene Summary",
    "",
    "> What happens in this chapter, in 2-3 sentences.",
    "",
    "## Key Beats",
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "---",
    "",
    "<!-- Prose begins below -->",
    "",
  ].join("\n");
}

/**
 * Scaffold the full project structure from init wizard options.
 */
async function scaffoldProject(
  plugin: PennyPlugin,
  options: ProjectInitOptions
): Promise<void> {
  const root = options.projectName;

  // Series-level folders
  const folders = [
    `${root}/00-series`,
    `${root}/01-world`,
    `${root}/01-world/cultures`,
    `${root}/01-world/geography`,
    `${root}/01-world/history`,
    `${root}/01-world/politics`,
    `${root}/01-world/systems`,
    `${root}/02-characters`,
    `${root}/02-characters/protagonists`,
    `${root}/02-characters/supporting`,
    `${root}/02-characters/antagonists`,
    `${root}/02-characters/factions`,
    `${root}/05-wiki`,
    `${root}/06-reference`,
    `${root}/06-reference/research`,
  ];

  // Per-book folders
  for (let b = 1; b <= options.numberOfBooks; b++) {
    folders.push(`${root}/03-plot/book-${b}`);
    folders.push(`${root}/07-reviews/book-${b}`);

    for (let c = 1; c <= options.chaptersPerBook; c++) {
      const padded = String(c).padStart(2, "0");
      folders.push(`${root}/04-drafts/book-${b}/ch-${padded}`);
    }
  }

  if (options.includeTemplates) {
    folders.push(`${root}/templates`);
  }

  // Create all folders
  for (const folder of folders) {
    await ensureFolder(plugin, folder);
  }

  // -- Generate files ---------------------------------------------------

  const povLabel = options.pov === "first" ? "First" : "Third";
  const tenseLabel = options.tense === "past" ? "Past" : "Present";

  // Series bible
  await plugin.app.vault.create(
    `${root}/00-series/series-bible.md`,
    [
      "---",
      "type: series-bible",
      "status: draft",
      "---",
      "",
      "# Series Bible",
      "",
      "## Premise",
      "",
      "> What is this series about, in 2-3 sentences?",
      "",
      "## Genre",
      "",
      "",
      "## Tone",
      "",
      "",
      "## Rules of the World",
      "",
      "> What is possible and impossible in this world?",
      "",
      "## Central Question",
      "",
      "> What question does the series explore?",
      "",
    ].join("\n")
  );

  // Series arc
  await plugin.app.vault.create(
    `${root}/00-series/series-arc.md`,
    [
      "---",
      "type: series-arc",
      "status: draft",
      "---",
      "",
      "# Series Arc",
      "",
      "## The Lie",
      "",
      "> What does the protagonist believe at the start that is wrong?",
      "",
      "## The Truth",
      "",
      "> What does the protagonist come to understand?",
      "",
      "## Book-by-Book Arc",
      "",
      "",
    ].join("\n")
  );

  // Themes
  await plugin.app.vault.create(
    `${root}/00-series/themes.md`,
    [
      "---",
      "type: themes",
      "status: draft",
      "---",
      "",
      "# Themes",
      "",
      "## Primary Theme",
      "",
      "",
      "## Secondary Themes",
      "",
      "- ",
      "",
    ].join("\n")
  );

  // Timeline
  await plugin.app.vault.create(
    `${root}/00-series/timeline.md`,
    [
      "---",
      "type: timeline",
      "status: draft",
      "---",
      "",
      "# Timeline",
      "",
      "> Chronological list of events across the series.",
      "",
    ].join("\n")
  );

  // World rules
  await plugin.app.vault.create(
    `${root}/01-world/rules.md`,
    [
      "---",
      "type: world-rules",
      "status: draft",
      "---",
      "",
      "# World Rules",
      "",
      "## What Is Possible",
      "",
      "",
      "## What Is Impossible",
      "",
      "",
      "## Costs and Constraints",
      "",
      "",
    ].join("\n")
  );

  // Style guide
  await plugin.app.vault.create(
    `${root}/06-reference/style-guide.md`,
    [
      "---",
      "type: style-guide",
      "status: draft",
      "---",
      "",
      "# Style Guide",
      "",
      "## Point of View",
      `${povLabel} person. ${tenseLabel} tense.`,
      "",
      "## Register",
      "<!-- Describe your narrative voice here. How does your narrator sound?",
      "     Formal? Casual? Technical? Lyrical? Think about your comp titles. -->",
      "",
      "## Voice Rules",
      "<!-- What are the non-negotiable rules for your prose?",
      "     PENNY will enforce these on every revision. -->",
      "",
      "## Things to Avoid",
      "<!-- What should never appear in your prose?",
      "     Be specific -- PENNY uses this to flag violations. -->",
      "",
    ].join("\n")
  );

  // Voice tests
  await plugin.app.vault.create(
    `${root}/06-reference/voice-tests.md`,
    [
      "---",
      "type: voice-tests",
      "status: draft",
      "---",
      "",
      "# Voice Tests",
      "",
      "<!-- Write 2-3 sample passages that represent your ideal prose voice.",
      "     PENNY uses these as the gold standard for every revision.",
      "     Include examples of dialogue, narration, and action. -->",
      "",
      "## Example 1",
      "",
      "",
      "## Example 2",
      "",
      "",
    ].join("\n")
  );

  // Comp titles
  await plugin.app.vault.create(
    `${root}/06-reference/comp-titles.md`,
    [
      "---",
      "type: comp-titles",
      "status: draft",
      "---",
      "",
      "# Comp Titles",
      "",
      "> Books similar to yours in voice, genre, audience, or premise.",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
    ].join("\n")
  );

  // Wiki index
  await plugin.app.vault.create(
    `${root}/05-wiki/index.md`,
    [
      "---",
      "type: wiki-index",
      "status: active",
      "---",
      "",
      "# Wiki Index",
      "",
      "> Master index of all characters, locations, objects, and lore.",
      "> Keep this updated as the story evolves.",
      "",
      "## Characters",
      "",
      "",
      "## Locations",
      "",
      "",
      "## Concepts",
      "",
      "",
    ].join("\n")
  );

  // Per-book outlines and chapters
  for (let b = 1; b <= options.numberOfBooks; b++) {
    await plugin.app.vault.create(
      `${root}/03-plot/book-${b}/outline.md`,
      [
        "---",
        "type: outline",
        `book: ${b}`,
        "status: draft",
        "---",
        "",
        `# Book ${b} Outline`,
        "",
        "## Act 1",
        "",
        "### Setup",
        "",
        "",
        "### Inciting Incident",
        "",
        "",
        "## Act 2",
        "",
        "### Rising Action",
        "",
        "",
        "### Midpoint",
        "",
        "",
        "### Complications",
        "",
        "",
        "## Act 3",
        "",
        "### Crisis",
        "",
        "",
        "### Climax",
        "",
        "",
        "### Resolution",
        "",
        "",
      ].join("\n")
    );

    for (let c = 1; c <= options.chaptersPerBook; c++) {
      const padded = String(c).padStart(2, "0");
      const chapterContent = generateChapterTemplate(b, c);
      await plugin.app.vault.create(
        `${root}/04-drafts/book-${b}/ch-${padded}/ch-${padded}.v1.md`,
        chapterContent
      );
      await plugin.app.vault.create(
        `${root}/04-drafts/book-${b}/ch-${padded}/.version`,
        "1"
      );
      await plugin.app.vault.create(
        `${root}/04-drafts/book-${b}/ch-${padded}/.state.json`,
        generateStateJson()
      );
    }
  }

  // Templates
  if (options.includeTemplates) {
    await plugin.app.vault.create(
      `${root}/templates/chapter.md`,
      generateChapterTemplate(1, 1)
    );

    await plugin.app.vault.create(
      `${root}/templates/character.md`,
      [
        "---",
        "type: character",
        "role: supporting",
        'book-appearance: [1]',
        "status: draft",
        "---",
        "",
        "# {{Name}}",
        "",
        "## Overview",
        "",
        "",
        "## Physical Description",
        "",
        "",
        "## Personality",
        "",
        "",
        "## Background",
        "",
        "",
        "## Voice",
        "",
        "",
        "## Relationship to Protagonist",
        "",
        "",
        "## Arc",
        "",
        "",
      ].join("\n")
    );

    await plugin.app.vault.create(
      `${root}/templates/location.md`,
      [
        "---",
        "type: location",
        "status: draft",
        "---",
        "",
        "# {{Location Name}}",
        "",
        "## Description",
        "",
        "",
        "## Significance",
        "",
        "",
        "## Sensory Details",
        "",
        "",
      ].join("\n")
    );

    await plugin.app.vault.create(
      `${root}/templates/faction.md`,
      [
        "---",
        "type: faction",
        "status: draft",
        "---",
        "",
        "# {{Faction Name}}",
        "",
        "## Purpose",
        "",
        "",
        "## Members",
        "",
        "",
        "## Relationship to Protagonist",
        "",
        "",
      ].join("\n")
    );

    await plugin.app.vault.create(
      `${root}/templates/scene.md`,
      [
        "---",
        "type: scene",
        "status: draft",
        "---",
        "",
        "# Scene: {{Title}}",
        "",
        "## Goal",
        "",
        "",
        "## Characters Present",
        "",
        "",
        "## Key Beats",
        "",
        "1. ",
        "2. ",
        "3. ",
        "",
      ].join("\n")
    );
  }

  // PENNY.md project config
  await plugin.app.vault.create(
    `${root}/PENNY.md`,
    [
      "# PENNY Configuration",
      "",
      "## Project",
      `name: ${options.projectName}`,
      "drafts: 04-drafts",
      "style-guide: 06-reference/style-guide.md",
      "voice-tests: 06-reference/voice-tests.md",
      "characters: 02-characters",
      "plot: 03-plot",
      "wiki: 05-wiki",
      "reviews: 07-reviews",
      "",
      "## Voice Rules",
      "<!-- Project-specific voice rules go here.",
      "     These override the global voice rules in plugin settings. -->",
      "",
      "## Annotation Reference",
      "<!-- Quick reference for the annotation convention -->",
      "%% REWRITE: instruction %%",
      "%% EXPAND: instruction %%",
      "%% CUT: instruction %%",
      "%% TONE: instruction %%",
      "%% DIALOG: instruction %%",
      "%% PLOT: instruction %%",
      "%% PACING: instruction %%",
      "%% CHARACTER: instruction %%",
      "%% NOTE: author note (not processed) %%",
      "%% RESEARCH: needs checking (not processed) %%",
      "",
    ].join("\n")
  );
}

// ============================================================================
// ProjectInitModal
// ============================================================================

/**
 * Modal dialog for the project initialization wizard.
 *
 * Collects project name, number of books, chapters per book,
 * POV, and tense, then scaffolds the full directory structure.
 */
export class ProjectInitModal extends Modal {
  private plugin: PennyPlugin;
  private options: ProjectInitOptions = {
    projectName: "",
    numberOfBooks: 1,
    chaptersPerBook: 20,
    includeTemplates: true,
    pov: "first",
    tense: "past",
  };

  constructor(plugin: PennyPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-init-modal");

    contentEl.createEl("h2", { text: "Initialize a New Novel Project" });
    contentEl.createEl("p", {
      text: "PENNY will create the full project structure for your novel, including folders, templates, and configuration files.",
    });

    new Setting(contentEl)
      .setName("Project name")
      .setDesc(
        "The name of your novel or series. This becomes the root folder name."
      )
      .addText((text) =>
        text.setPlaceholder("My Novel").onChange((value) => {
          this.options.projectName = value.trim();
        })
      );

    new Setting(contentEl)
      .setName("Number of books")
      .setDesc("How many books in the series. Creates per-book subfolders.")
      .addText((text) =>
        text.setValue("1").onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 20) {
            this.options.numberOfBooks = parsed;
          }
        })
      );

    new Setting(contentEl)
      .setName("Chapters per book")
      .setDesc(
        "Starting number of chapters. You can always add more later."
      )
      .addText((text) =>
        text.setValue("20").onChange((value) => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            this.options.chaptersPerBook = parsed;
          }
        })
      );

    new Setting(contentEl)
      .setName("Point of view")
      .setDesc("Narrative POV for the style guide.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("first", "First person")
          .addOption("third", "Third person")
          .setValue(this.options.pov)
          .onChange((value) => {
            this.options.pov = value as "first" | "third";
          })
      );

    new Setting(contentEl)
      .setName("Tense")
      .setDesc("Narrative tense for the style guide.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("past", "Past tense")
          .addOption("present", "Present tense")
          .setValue(this.options.tense)
          .onChange((value) => {
            this.options.tense = value as "past" | "present";
          })
      );

    new Setting(contentEl)
      .setName("Include templates")
      .setDesc(
        "Create template files for chapters, characters, locations, factions, and scenes."
      )
      .addToggle((toggle) =>
        toggle.setValue(true).onChange((value) => {
          this.options.includeTemplates = value;
        })
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create Project")
        .setCta()
        .onClick(async () => {
          if (!this.options.projectName) {
            new Notice("PENNY: Please enter a project name.");
            return;
          }

          // Check if folder already exists
          const existing = this.plugin.app.vault.getAbstractFileByPath(
            this.options.projectName
          );
          if (existing) {
            new Notice(
              `PENNY: A folder named "${this.options.projectName}" already exists.`
            );
            return;
          }

          button.setDisabled(true);
          button.setButtonText("Creating...");

          try {
            await scaffoldProject(this.plugin, this.options);
            new Notice(
              `PENNY: Project "${this.options.projectName}" created successfully.`
            );
            this.close();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            new Notice(`PENNY: Project creation failed -- ${message}`);
            button.setDisabled(false);
            button.setButtonText("Create Project");
          }
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
