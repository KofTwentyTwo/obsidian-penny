/**
 * PENNY - Command Registration
 *
 * Registers all command palette commands and defines the ProjectInitModal
 * for scaffolding new novel projects.
 */

import { Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import { execFile } from "child_process";
import type PennyPlugin from "./main";
import type { ProjectInitOptions } from "./types";

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
      for (const file of chapters) {
        await processChapter(plugin, file);
      }
      new Notice(`PENNY: Finished processing ${chapters.length} chapter(s).`);
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
 * Check whether at least one LLM provider is configured.
 *
 * For Anthropic, an API key is required. For Ollama, just the endpoint
 * (defaulted). Shows a notice if nothing is usable.
 */
function requireProvider(plugin: PennyPlugin): boolean {
  const s = plugin.settings;
  const hasAnthropic = !!s.anthropicApiKey;
  const hasOllama = !!s.ollamaEndpoint;

  if (!hasAnthropic && !hasOllama) {
    new Notice(
      "PENNY: No LLM provider configured. Open Settings > PENNY to add an Anthropic API key or configure Ollama."
    );
    return false;
  }

  // Check that the routed provider is actually configured
  const route = s.routeStandard; // representative route
  if (route.provider === "anthropic" && !hasAnthropic) {
    new Notice(
      "PENNY: Model routing uses Anthropic but no API key is set. Open Settings > PENNY > Providers."
    );
    return false;
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
 * Simple glob matcher supporting * and ? wildcards.
 * Uses iterative comparison to avoid ReDoS.
 */
function globMatch(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let matchTi = -1;

  while (ti < text.length) {
    if (
      pi < pattern.length &&
      (pattern[pi] === text[ti] || pattern[pi] === "?")
    ) {
      pi++;
      ti++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starPi = pi;
      matchTi = ti;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      matchTi++;
      ti = matchTi;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}

/**
 * Count annotations in file content.
 */
function countAnnotations(content: string): { actionable: number; passthrough: number } {
  const ACTIONABLE_PATTERN =
    /%%\s*(?:REWRITE|EXPAND|CUT|TONE|DIALOG|PLOT|PACING|CHARACTER)\s*:.*?%%/g;
  const PASSTHROUGH_PATTERN = /%%\s*(?:NOTE|RESEARCH)\s*:.*?%%/g;

  const actionableMatches = content.match(ACTIONABLE_PATTERN);
  const passthroughMatches = content.match(PASSTHROUGH_PATTERN);

  return {
    actionable: actionableMatches ? actionableMatches.length : 0,
    passthrough: passthroughMatches ? passthroughMatches.length : 0,
  };
}

/**
 * Find all chapter files that contain actionable annotations.
 */
function getAnnotatedChapters(plugin: PennyPlugin): TFile[] {
  const allFiles = plugin.app.vault.getMarkdownFiles();
  const draftsFolder = plugin.settings.draftsFolder;

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
 * Process annotations in a single chapter file.
 * This is a stub that will call into parser -> context -> drafter -> assembler
 * once those modules are implemented.
 */
async function processChapter(plugin: PennyPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const counts = countAnnotations(content);

  if (counts.actionable === 0) {
    new Notice(`PENNY: No actionable annotations in ${file.basename}.`);
    return;
  }

  plugin.statusBar?.setProcessing();

  try {
    // Determine which provider+model route applies.
    // When the full pipeline is wired, each annotation will look up its own
    // tier via TAG_COMPLEXITY.  For now, report routing config alongside counts.
    const s = plugin.settings;
    const route = s.useSameModelForAll ? s.routeStandard : null;
    const routeDesc = route
      ? `${route.provider}/${route.model}`
      : `Light: ${s.routeLight.provider}/${s.routeLight.model}, ` +
        `Standard: ${s.routeStandard.provider}/${s.routeStandard.model}, ` +
        `Heavy: ${s.routeHeavy.provider}/${s.routeHeavy.model}`;

    // TODO: Wire into parser -> context -> drafter -> assembler pipeline
    // For now, report what would be processed and which provider(s) would be used.
    new Notice(
      `PENNY: Found ${counts.actionable} actionable annotation(s) in ${file.basename}. ` +
        `Routing: ${routeDesc}. ` +
        `Processing pipeline not yet wired. (Parser, context, drafter, assembler modules needed.)`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`PENNY: Error processing ${file.basename} -- ${message}`);
  } finally {
    plugin.statusBar?.setReady();
    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile) {
      plugin.statusBar?.update(activeFile, plugin);
    }
  }
}

/**
 * Show annotation counts and what would change without processing.
 */
async function dryRun(plugin: PennyPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const counts = countAnnotations(content);
  const total = counts.actionable + counts.passthrough;

  const lines: string[] = [
    `PENNY Dry Run: ${file.basename}`,
    `---`,
    `Total annotations: ${total}`,
    `  Actionable: ${counts.actionable} (would be processed)`,
    `  NOTE/RESEARCH: ${counts.passthrough} (would be preserved)`,
  ];

  if (counts.actionable === 0) {
    lines.push("", "Nothing to process.");
  } else {
    lines.push("", `Running "Process this chapter" would create a new version.`);
  }

  new Notice(lines.join("\n"), 10000);
}

/**
 * Show status information for the active file.
 */
async function showStatus(plugin: PennyPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.read(file);
  const counts = countAnnotations(content);

  const versionMatch = file.basename.match(/\.v(\d+)$/);
  const version = versionMatch ? versionMatch[1] : "unknown";

  const lines: string[] = [
    `PENNY Status: ${file.basename}`,
    `---`,
    `Version: ${version}`,
    `Actionable annotations: ${counts.actionable}`,
    `Notes/research: ${counts.passthrough}`,
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
  const draftsFolder = plugin.settings.draftsFolder;
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

        // Write .version manifest
        await plugin.app.vault.create(versionFilePath, "1");

        // Remove original flat file
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
    new Notice("PENNY: No chapter files found to migrate.");
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
  const draftsFolder = plugin.settings.draftsFolder;

  // Try to infer the book folder from the active file
  let bookFolderPath: string | null = null;
  if (activeFile && activeFile.path.startsWith(draftsFolder + "/")) {
    const parts = activeFile.path.split("/");
    if (parts.length >= 2) {
      bookFolderPath = parts.slice(0, 2).join("/");
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

    // Open the new file
    await plugin.app.workspace.getLeaf(false).openFile(newFile);
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
    await plugin.app.workspace.getLeaf(false).openFile(newFile);
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
 */
function getVaultBasePath(plugin: PennyPlugin): string {
  // The basePath property exists on FileSystemAdapter at runtime but is
  // not part of the public Obsidian type definitions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (plugin.app.vault.adapter as any).basePath as string;
}

/**
 * Stage and commit changes with an auto-generated message.
 */
async function gitCommit(plugin: PennyPlugin): Promise<void> {
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

    let message = "docs: PENNY writing session";
    if (chapterChanges.length > 0) {
      message = `docs: revise ${chapterChanges.join(", ")}`;
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
  if (existing) return;

  // Create parent folders recursively
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = plugin.app.vault.getAbstractFileByPath(current);
    if (!folder) {
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
