/**
 * PENNY - Command Registration & Vault I/O Layer
 *
 * The bridge between PENNY's pure-logic modules and Obsidian's vault API.
 * Responsibilities:
 *
 * 1. Registers all command-palette commands (process, dry-run, migrate,
 *    new-chapter, new-character, git operations, research, status).
 * 2. Reads files from the vault and passes their contents to the pipeline.
 * 3. Writes pipeline results (new version files, state, reviews, logs)
 *    back to the vault.
 * 4. Manages the progress modal lifecycle and re-entrancy guards.
 * 5. Provides git commit/push via child_process execFile.
 * 6. Defines the ProjectInitModal for scaffolding new projects.
 *
 * This is the only module (besides main.ts and the UI modules) that
 * directly uses Obsidian APIs. All annotation processing logic lives
 * in the pure modules (parser, pipeline, assembler, etc.).
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
import { getLogFilePath, pennyLog } from "./logger";
import { runPipeline } from "./pipeline";
import type { PipelineResult } from "./pipeline";
import { showPennyError } from "./error-modal";
import { safeCreateFile } from "./file-conflict-modal";
import { PennyProgressModal } from "./progress-modal";
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
    id: "init",
    name: "Initialize project",
    callback: () => {
      new ProjectInitModal(plugin).open();
    },
  });

  // -- Process this chapter ----------------------------------------------
  plugin.addCommand({
    id: "process-chapter",
    name: "Process this chapter",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "p" }],
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !isChapterFile(file, plugin)) return false;
      if (checking) return true;

      if (!requireProvider(plugin)) return false;
      processChapter(plugin, file);
      return true;
    },
  });

  // -- Process all chapters ----------------------------------------------
  plugin.addCommand({
    id: "process-all",
    name: "Process all chapters",
    callback: async () => {
      if (!requireProvider(plugin)) return;

      const chapters = getAnnotatedChapters(plugin);
      if (chapters.length === 0) {
        new Notice("PENNY: No annotated chapters found.");
        return;
      }

      // Quick scan to count how many chapters actually have annotations
      let annotatedCount = 0;
      for (const f of chapters) {
        const text = await plugin.app.vault.cachedRead(f);
        if (text.includes("%%") && text.match(/%% \w+:/)) annotatedCount++;
      }
      new Notice(`PENNY: Found ${annotatedCount} chapter(s) with annotations (${chapters.length} total).`);
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
    id: "dry-run",
    name: "Dry run",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }],
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !isChapterFile(file, plugin)) return false;
      if (checking) return true;

      dryRun(plugin, file);
      return true;
    },
  });

  // -- Migrate chapters --------------------------------------------------
  plugin.addCommand({
    id: "migrate",
    name: "Migrate chapters",
    callback: () => {
      migrateChapters(plugin);
    },
  });

  // -- Show status -------------------------------------------------------
  plugin.addCommand({
    id: "status",
    name: "Show status",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file) return false;
      if (checking) return true;

      showStatus(plugin, file);
      return true;
    },
  });

  // -- New chapter -------------------------------------------------------
  plugin.addCommand({
    id: "new-chapter",
    name: "New chapter",
    callback: () => {
      createNewChapter(plugin);
    },
  });

  // -- New character -----------------------------------------------------
  plugin.addCommand({
    id: "new-character",
    name: "New character",
    callback: () => {
      createNewCharacter(plugin);
    },
  });

  // -- Git commit --------------------------------------------------------
  plugin.addCommand({
    id: "git-commit",
    name: "Commit progress",
    callback: () => {
      gitCommit(plugin);
    },
  });

  // -- Git push ----------------------------------------------------------
  plugin.addCommand({
    id: "git-push",
    name: "Push",
    callback: () => {
      gitPush(plugin);
    },
  });

  // -- Git commit and push -----------------------------------------------
  plugin.addCommand({
    id: "git-commit-push",
    name: "Commit and push",
    callback: async () => {
      await gitCommit(plugin);
      await gitPush(plugin);
    },
  });

  // -- Research ------------------------------------------------------------
  plugin.addCommand({
    id: "research",
    name: "Do research",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "r" }],
    callback: () => {
      new ResearchModal(plugin).open();
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
export function requireProvider(plugin: PennyPlugin): boolean {
  const s = plugin.settings;

  const routes: Array<{ tier: string; provider: string }> = s.useSameModelForAll
    ? [
        { tier: "standard", provider: s.routeStandard.provider },
        { tier: "research", provider: s.routeResearch.provider },
      ]
    : [
        { tier: "light", provider: s.routeLight.provider },
        { tier: "standard", provider: s.routeStandard.provider },
        { tier: "heavy", provider: s.routeHeavy.provider },
        { tier: "research", provider: s.routeResearch.provider },
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
        showPennyError(plugin.app,
          `Route ${tierLabel} uses Anthropic but no API key is set.`,
          "Open Settings > PENNY > Providers to configure your Anthropic API key.");
        return false;
      }
    } else if (provider === "ollama") {
      if (!s.ollamaEndpoint) {
        showPennyError(plugin.app,
          `Route ${tierLabel} uses Ollama but no endpoint is configured.`,
          "Open Settings > PENNY > Providers to configure the Ollama endpoint.");
        return false;
      }
    } else if (provider === "google") {
      if (!s.googleApiKey) {
        showPennyError(plugin.app,
          `Route ${tierLabel} uses Google Gemini but no API key is set.`,
          "Open Settings > PENNY > Providers to configure your Google API key.");
        return false;
      }
    } else if (provider === "openai") {
      if (!s.openaiApiKey) {
        showPennyError(plugin.app,
          `Route ${tierLabel} uses OpenAI but no API key is set.`,
          "Open Settings > PENNY > Providers to configure your OpenAI API key.");
        return false;
      }
    } else {
      showPennyError(plugin.app,
        `Route ${tierLabel} uses unknown provider '${provider}'.`,
        "Check Settings > PENNY > Model Routing.");
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
  // Use vault.adapter for dotfiles (.version, .state.json) that Obsidian's
  // vault cache doesn't index. Falls back to vault.read for normal files.
  try {
    const exists = await plugin.app.vault.adapter.exists(path);
    if (!exists) return "";
    return await plugin.app.vault.adapter.read(path);
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
    showPennyError(plugin.app,
      `Failed to read ${file.basename}`,
      msg);
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

  // Declare modal outside try so it is accessible in catch for cleanup
  let modal: PennyProgressModal | null = null;

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

    pennyLog("info", s.logLevel, `Processing ${file.path} (chapter: ${chapterId}, book: ${bookId})`);

    // Read version and state files
    const versionContent = await safeRead(plugin, `${folderPath}/.version`);
    const stateContent = await safeRead(plugin, `${folderPath}/.state.json`);

    // Detect characters for voice test pre-filtering
    const { frontmatter: fm } = parseFrontmatter(content);
    const focusField = typeof fm.focus === "string" ? fm.focus : "";
    const detectedChars = detectCharacters(content, focusField);

    // Gather context files from vault
    const contextFiles = await gatherContextFiles(plugin, content, detectedChars, bookId);

    pennyLog("debug", s.logLevel, `Annotations found: ${actionableCount} actionable`);

    // Pre-compute all output paths and add to processingFiles BEFORE the
    // pipeline runs, preventing the auto-save hook from picking them up
    // during the async pipeline execution.
    let currentVersion = readVersion(versionContent);
    let effectiveVersionContent = versionContent;
    const expectedNextVersion = nextVersion(currentVersion);
    let newVersionPath = `${folderPath}/${chapterId}.v${expectedNextVersion}.md`;
    const versionFilePath = `${folderPath}/.version`;
    const stateFilePath = `${folderPath}/.state.json`;

    // If a file at the expected version path already exists,
    // scan the folder for the highest existing version and use that + 1.
    const versionFileExists = await plugin.app.vault.adapter.exists(newVersionPath);
    if (versionFileExists) {
      const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        let maxVer = 0;
        for (const child of folder.children) {
          const match = child.name.match(/\.v(\d+)\.md$/);
          if (match) maxVer = Math.max(maxVer, parseInt(match[1]));
        }
        currentVersion = maxVer;
        effectiveVersionContent = String(maxVer);
        const actualNextVersion = nextVersion(maxVer);
        newVersionPath = `${folderPath}/${chapterId}.v${actualNextVersion}.md`;
      }
    }

    // Pre-compute review and log paths so they are in processingFiles
    // BEFORE the pipeline runs (prevents auto-save hook from picking them up).
    const effectiveNextVersion = nextVersion(currentVersion);
    const reviewPath = getReviewFilePath(reviewsFolder, bookId, chapterId, effectiveNextVersion);
    const logPath = getLogFilePath(activityLogFolder, bookId);

    const newPaths = [newVersionPath, versionFilePath, stateFilePath, reviewPath, logPath];
    for (const p of newPaths) {
      plugin.processingFiles.add(p);
      createdPaths.push(p);
    }

    // Create and open the progress modal (unless running silently or disabled in settings)
    if (!options?.silent && s.showProgressModal) {
      modal = new PennyProgressModal(plugin.app, `Processing ${chapterId}`, s.showStatusNotices);
      modal.open();
    }

    // Run the pipeline (pass pre-parsed annotations to avoid redundant parsing)
    const result = await runPipeline({
      content,
      versionContent: effectiveVersionContent,
      stateContent,
      contextFiles,
      settings: s,
      chapterId,
      bookId,
      preParsedAnnotations: allAnnotations,
      getProvider: (name: string) => {
        pennyLog("debug", s.logLevel, `Provider requested: ${name}`);
        return plugin.providerRegistry.get(name);
      },
      onProgress: (event) => modal?.update(event),
      isCancelled: () => modal?.isCancelled() ?? false,
    });

    if (!result) {
      if (modal) modal.close();
      if (!options?.silent) {
        const wasCancelled = modal?.isCancelled();
        new Notice(wasCancelled
          ? `PENNY: Processing of ${file.basename} was cancelled.`
          : `PENNY: No new annotations to process in ${file.basename}.`
        );
      }
      return null;
    }

    pennyLog("info", s.logLevel, `Pipeline complete: ${result.annotationsProcessed} processed, v${result.newVersion} (${result.durationMs}ms)`);

    // Write new version file (overwrite if exists -- version scan should prevent this,
    // but handle edge cases like interrupted previous runs)
    const createdVersionFile = await upsertFile(plugin, newVersionPath, result.newContent);
    if (!createdVersionFile) {
      if (modal) modal.close();
      return null;
    }

    // Update .version and .state.json (upsert -- these always exist after first run)
    await upsertFile(plugin, versionFilePath, String(result.newVersion));
    await upsertFile(plugin, stateFilePath, result.stateJson);

    // Write review note (reviewPath pre-computed above)
    const reviewFolder = reviewPath.split("/").slice(0, -1).join("/");
    await ensureFolder(plugin, reviewFolder);
    await upsertFile(plugin, reviewPath, result.reviewContent);

    // Append to activity log (logPath pre-computed above)
    const logFolder = logPath.split("/").slice(0, -1).join("/");
    await ensureFolder(plugin, logFolder);
    const existingLog = plugin.app.vault.getAbstractFileByPath(logPath);
    if (existingLog && existingLog instanceof TFile) {
      const existing = await plugin.app.vault.read(existingLog);
      await plugin.app.vault.modify(existingLog, existing + result.logLine);
    } else {
      await safeCreateFile(plugin, logPath, result.logLine);
    }

    pennyLog("info", s.logLevel, `Version ${result.newVersion} created for ${chapterId}`);

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
        createdPaths,
      });
      if (s.autoPushAfterCommit) {
        await gitPush(plugin);
      }
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    if (modal) modal.close();
    const logFolder = normalizePath(plugin.settings.activityLogFolder);
    showPennyError(plugin.app,
      `Error processing ${file.basename}: ${message}`,
      stack,
      `${logFolder}/activity.jsonl`
    );
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
    showPennyError(plugin.app,
      `Drafts folder "${draftsFolder}" not found.`,
      "Check your project structure settings in Settings > PENNY > Project Structure.");
    return;
  }

  let migratedCount = 0;
  let skippedCount = 0;

  // Iterate through book folders
  for (const child of abstractFile.children) {
    if (!(child instanceof TFolder)) continue;
    const bookFolder = child;

    // Snapshot the children array -- vault.delete mutates the live array during iteration
    const bookChildren = [...bookFolder.children];
    for (const bookChild of bookChildren) {
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
        const versionedFile = await safeCreateFile(plugin, versionedFilePath, content);
        if (!versionedFile) {
          showPennyError(
            plugin.app,
            `Migration failed for ${bookChild.path}`,
            "Could not create versioned file. Original left intact.",
          );
          continue;
        }

        // Verify the written file matches the original content
        const writtenContent = await plugin.app.vault.read(versionedFile);
        if (writtenContent !== content) {
          showPennyError(
            plugin.app,
            `Migration verification failed for ${bookChild.path}`,
            "Written content does not match original. Original left intact.",
          );
          continue;
        }

        // Write .version manifest
        await upsertFile(plugin, versionFilePath, "1");

        // Write .state.json
        const stateFilePath = `${chapterFolderPath}/.state.json`;
        await upsertFile(plugin, stateFilePath, generateStateJson());

        // Remove original flat file only after verified write
        await plugin.app.vault.delete(bookChild);

        migratedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showPennyError(plugin.app,
          `Failed to migrate ${bookChild.path}`,
          message);
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
    const newFile = await safeCreateFile(plugin, filePath, content);
    if (!newFile) return;
    await safeCreateFile(plugin, `${chapterFolderPath}/.version`, "1");
    await safeCreateFile(plugin, `${chapterFolderPath}/.state.json`, generateStateJson());

    // Open the new file
    await plugin.app.workspace.getLeaf("tab").openFile(newFile);
    new Notice(`PENNY: Created ${chapterName} in ${bookFolderPath}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showPennyError(plugin.app, `Failed to create chapter`, message);
  }
}

/**
 * Create a new character file from template.
 */
async function createNewCharacter(plugin: PennyPlugin): Promise<void> {
  const charFolder = plugin.settings.characterSheetsFolder;
  if (!charFolder) {
    showPennyError(plugin.app,
      "Character sheets folder not configured.",
      "Set it in Settings > PENNY > Project Structure.");
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
    showPennyError(plugin.app, `Failed to create character file`, message);
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
    showPennyError(plugin.app,
      "Git operations require a local vault.",
      "The vault adapter is not a local filesystem (sync adapter detected).");
    return null;
  }

  // Check git is installed
  try {
    await gitExecRaw(["--version"]);
  } catch {
    showPennyError(plugin.app,
      "Git is not installed or not on PATH.",
      "Install git and ensure it is available in your system PATH.");
    return null;
  }

  // Check vault is a git repo
  try {
    const result = await gitExecRaw(["-C", vaultPath, "rev-parse", "--is-inside-work-tree"]);
    if (result.trim() !== "true") {
      showPennyError(plugin.app,
        "This vault is not a git repository.",
        "Run 'git init' in the vault directory first.");
      return null;
    }
  } catch {
    showPennyError(plugin.app,
      "This vault is not a git repository.",
      "Run 'git init' in the vault directory first.");
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
  /** Paths that PENNY created/modified during processing -- staged individually. */
  createdPaths?: string[];
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
      let filePath = line.slice(3); // Strip status prefix (e.g., " M " or "?? ")
      // Handle renamed/copied files: "R  old -> new" format
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop() ?? filePath;
      }
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

    // Stage only PENNY-related files
    if (ctx?.createdPaths?.length) {
      for (const p of ctx.createdPaths) {
        await gitExec(plugin, ["add", p]);
      }
    } else {
      // Fallback: stage only drafts and reviews folders
      const s = plugin.settings;
      if (s.draftsFolder) await gitExec(plugin, ["add", normalizePath(s.draftsFolder)]);
      if (s.reviewsFolder) await gitExec(plugin, ["add", normalizePath(s.reviewsFolder)]);
      if (s.activityLogFolder) await gitExec(plugin, ["add", normalizePath(s.activityLogFolder)]);
    }
    await gitExec(plugin, ["commit", "-m", fullMessage]);

    new Notice(`PENNY: Committed. ${message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showPennyError(plugin.app, "Git commit failed", message);
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
    showPennyError(plugin.app, "Git push failed", message);
  }
}

// ============================================================================
// Project scaffolding
// ============================================================================

/**
 * Ensure a folder exists in the vault, creating parent folders as needed.
 */
async function ensureFolder(plugin: PennyPlugin, path: string): Promise<void> {
  // Use adapter.exists for dotfolders (.penny-log) that vault cache misses
  const exists = await plugin.app.vault.adapter.exists(path);
  if (exists) return;

  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const partExists = await plugin.app.vault.adapter.exists(current);
    if (!partExists) {
      await plugin.app.vault.adapter.mkdir(current);
    }
  }
}

/**
 * Create or overwrite a file. Silently overwrites if the file exists.
 * Uses vault.adapter (filesystem level) to check existence because
 * Obsidian's vault cache doesn't index dotfiles (.version, .state.json)
 * or files in dotfolders (.penny-log/).
 */
async function upsertFile(plugin: PennyPlugin, path: string, content: string): Promise<TFile | null> {
  // Check filesystem directly -- vault.getAbstractFileByPath misses dotfiles
  const exists = await plugin.app.vault.adapter.exists(path);
  if (exists) {
    // Try vault.modify first (works if file is in the vault cache)
    const cached = plugin.app.vault.getAbstractFileByPath(path);
    if (cached && cached instanceof TFile) {
      await plugin.app.vault.modify(cached, content);
      return cached;
    }
    // File exists on disk but not in vault cache (dotfile) -- write directly
    await plugin.app.vault.adapter.write(path, content);
    // Try to get the TFile reference (may still be null for dotfiles)
    const afterWrite = plugin.app.vault.getAbstractFileByPath(path);
    return afterWrite instanceof TFile ? afterWrite : null;
  }
  return await plugin.app.vault.create(path, content);
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
            showPennyError(this.plugin.app,
              `A folder named "${this.options.projectName}" already exists.`,
              "Choose a different project name.");
            return;
          }

          // Validate project name
          const name = this.options.projectName;
          if (name.includes("..") || name.startsWith("/") || /[:<>"|?*]/.test(name)) {
            showPennyError(this.plugin.app,
              "Invalid project name.",
              "Project name cannot contain path traversal sequences or special characters (: < > \" | ? *).");
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
            showPennyError(this.plugin.app, "Project creation failed", message);
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

// ============================================================================
// Research Command
// ============================================================================

/**
 * Modal for entering a research query. The user types a question or topic,
 * PENNY sends it to the LLM, and writes the result to the research folder
 * organized by topic.
 */
class ResearchModal extends Modal {
  private plugin: PennyPlugin;
  private queryEl!: HTMLTextAreaElement;

  constructor(plugin: PennyPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "PENNY Research" });
    contentEl.createEl("p", {
      text: "Ask PENNY to research a topic for your novel. Results are saved to your research folder, organized by topic.",
      cls: "setting-item-description",
    });

    const textArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "e.g., According to James Hoffmann, with a dark espresso bean, what is the correct amounts of coffee and water for a double shot?",
        rows: "4",
      },
    });
    textArea.style.width = "100%";
    textArea.style.marginBottom = "12px";
    textArea.style.fontFamily = "var(--font-interface)";
    textArea.style.fontSize = "0.95em";
    this.queryEl = textArea;

    const buttonRow = contentEl.createEl("div", { cls: "penny-progress-buttons" });
    const researchBtn = buttonRow.createEl("button", { text: "Research" });
    researchBtn.addEventListener("click", async () => {
      const query = this.queryEl.value.trim();
      if (!query) {
        new Notice("PENNY: Please enter a research question.");
        return;
      }
      researchBtn.disabled = true;
      researchBtn.setText("Researching...");
      try {
        await executeResearch(this.plugin, query);
        this.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showPennyError(this.plugin.app, "Research failed", msg);
        researchBtn.disabled = false;
        researchBtn.setText("Research");
      }
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    // Focus the textarea
    setTimeout(() => textArea.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Execute a research query: call the LLM, determine the topic/filename,
 * and write the result to the research folder.
 */
async function executeResearch(plugin: PennyPlugin, query: string): Promise<void> {
  const s = plugin.settings;
  const researchFolder = normalizePath(s.researchFolder || "06-reference/research");

  // Use the research route (configurable in settings under Model Routing)
  const route = s.routeResearch;
  const provider = plugin.providerRegistry.get(route.provider);
  if (!provider) {
    throw new Error(`Provider "${route.provider}" not available. Check your settings.`);
  }

  // Step 1: Ask the LLM to research AND suggest a topic/filename
  const systemPrompt = `You are PENNY, a research assistant for a novel-writing project. The author needs factual research to inform their fiction writing.

Your task:
1. Research the topic thoroughly and provide a detailed, factual answer.
2. At the very end of your response, on its own line, write the topic category and filename in this exact format:
   TOPIC: Category Name
   FILENAME: descriptive-filename.md

For example:
   TOPIC: Coffee
   FILENAME: espresso-brewing-ratios.md

Or:
   TOPIC: Physics
   FILENAME: speed-of-light-as-constant.md

Rules:
- Be thorough and factual. Cite specific sources, experts, or references where possible.
- Write in a clear, informative style suitable for reference notes.
- The TOPIC should be a broad category (1-3 words).
- The FILENAME should be descriptive and use kebab-case.
- Include relevant numbers, measurements, and specifics.`;

  const resolvedModel = route.model === "auto-latest" ? "claude-sonnet-4-6" : route.model;
  const response = await provider.complete({
    systemPrompt,
    userPrompt: query,
    model: resolvedModel,
    maxTokens: s.maxTokens ?? 16000,
    apiKey: route.provider === "anthropic" ? s.anthropicApiKey
          : route.provider === "ollama" ? (s.ollamaApiKey || undefined)
          : route.provider === "google" ? s.googleApiKey
          : route.provider === "openai" ? s.openaiApiKey
          : undefined,
    endpoint: route.provider === "ollama" ? s.ollamaEndpoint : undefined,
  });

  const text = response.text;

  // Step 2: Extract topic and filename from the response
  const topicMatch = text.match(/TOPIC:\s*(.+)/i);
  const filenameMatch = text.match(/FILENAME:\s*(.+)/i);

  const topic = topicMatch ? topicMatch[1].trim() : "General";
  let filename = filenameMatch ? filenameMatch[1].trim() : slugify(query.slice(0, 60)) + ".md";
  if (!filename.endsWith(".md")) filename += ".md";

  // Remove the TOPIC/FILENAME lines from the content
  const content = text
    .replace(/TOPIC:\s*.+/i, "")
    .replace(/FILENAME:\s*.+/i, "")
    .trim();

  // Step 3: Build the file path: researchFolder/Topic/filename.md
  const topicFolder = `${researchFolder}/${topic}`;
  const filePath = `${topicFolder}/${filename}`;

  // Step 4: Check if file already exists -- if so, append/update
  await ensureFolder(plugin, topicFolder);

  const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
  if (existingFile && existingFile instanceof TFile) {
    // File exists -- append the new research
    const existing = await plugin.app.vault.read(existingFile);
    const updated = existing + "\n\n---\n\n## Updated Research\n\n**Query:** " + query + "\n\n" + content;
    await plugin.app.vault.modify(existingFile, updated);
    new Notice(`PENNY: Research updated in ${topic}/${filename}`, 6000);
  } else {
    // Create new file
    const fileContent = `---
type: research
topic: "${topic}"
query: "${query.replace(/"/g, '\\"')}"
date: ${new Date().toISOString().split("T")[0]}
---

# ${topic}: ${filename.replace(/\.md$/, "").replace(/-/g, " ")}

**Research query:** ${query}

---

${content}
`;
    await plugin.app.vault.create(filePath, fileContent);
    new Notice(`PENNY: Research saved to ${topic}/${filename}`, 6000);
  }

  // Open the file
  const newFile = plugin.app.vault.getAbstractFileByPath(filePath);
  if (newFile && newFile instanceof TFile) {
    await plugin.app.workspace.getLeaf("tab").openFile(newFile);
  }
}

/** Convert a string to a kebab-case filename slug */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
