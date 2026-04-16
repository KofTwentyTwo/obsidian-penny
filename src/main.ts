/**
 * PENNY - Prose Engine for Narrative, Notes, and Yarns
 *
 * Main plugin entry point. Extends Obsidian's Plugin class to provide
 * AI-powered prose revision, annotation processing, and project management
 * for novel writing in Obsidian.
 *
 * @module main
 */

import { Plugin, Notice, TFile } from "obsidian";
import { PennySettingTab } from "./settings";
import { PennyStatusBar } from "./statusbar";
import { registerCommands } from "./commands";
import { DEFAULT_SETTINGS } from "./types";
import type { PennySettings } from "./types";

/**
 * Execute a command by ID using Obsidian's internal command API.
 * The `commands` property exists at runtime but is not in the public type defs.
 */
function executeCommand(app: unknown, commandId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appAny = app as any;
  if (appAny?.commands?.executeCommandById) {
    appAny.commands.executeCommandById(commandId);
  }
}

/**
 * The PENNY Obsidian plugin.
 *
 * Manages the plugin lifecycle: loading/saving settings, registering commands,
 * status bar, ribbon icon, settings tab, and the on-save hook for
 * auto-processing.
 */
export default class PennyPlugin extends Plugin {
  /** Current plugin settings */
  settings: PennySettings = { ...DEFAULT_SETTINGS };

  /** Status bar widget instance */
  statusBar: PennyStatusBar | null = null;

  /** Reference to the file-modify event, for cleanup */
  private saveEventRef: ReturnType<typeof this.app.vault.on> | null = null;

  /** Whether auto-processing is currently in progress */
  private autoProcessing = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the settings tab
    this.addSettingTab(new PennySettingTab(this.app, this));

    // Register all commands
    registerCommands(this);

    // Add status bar item
    const statusBarEl = this.addStatusBarItem();
    this.statusBar = new PennyStatusBar(statusBarEl);

    // Add ribbon icon -- click to process the active chapter
    this.addRibbonIcon("pen-tool", "PENNY: Process this chapter", () => {
      executeCommand(this.app, "penny:process-chapter");
    });

    // Update status bar when the active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        this.statusBar?.update(file, this);
      })
    );

    // Set up auto-process on save hook
    this.setupSaveHook();

    // Initial status bar update
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.statusBar.update(activeFile, this);
    }

    // First-run notice if no API key is set
    if (!this.settings.apiKey) {
      new Notice(
        "PENNY loaded. Set your Anthropic API key in Settings > PENNY to get started.",
        8000
      );
    }
  }

  onunload(): void {
    // Event references registered via this.registerEvent are automatically cleaned up.
    // The saveEventRef managed separately needs explicit cleanup.
    if (this.saveEventRef) {
      this.app.vault.offref(this.saveEventRef);
      this.saveEventRef = null;
    }
  }

  /**
   * Load settings from Obsidian's data store, merging with defaults.
   */
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  /**
   * Persist current settings to Obsidian's data store.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Re-configure the save hook in case autoProcessOnSave changed
    this.setupSaveHook();
  }

  /**
   * Set up or tear down the file-save hook based on the
   * autoProcessOnSave setting.
   */
  private setupSaveHook(): void {
    // Remove any existing hook
    if (this.saveEventRef) {
      this.app.vault.offref(this.saveEventRef);
      this.saveEventRef = null;
    }

    if (!this.settings.autoProcessOnSave) return;

    this.saveEventRef = this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;

      // Only trigger for chapter files
      if (!this.isChapterFile(file)) return;

      // Debounce: skip if already auto-processing
      if (this.autoProcessing) return;

      this.autoProcessing = true;
      executeCommand(this.app, "penny:process-chapter");

      // Reset the flag after a short delay to allow the command to complete
      setTimeout(() => {
        this.autoProcessing = false;
      }, 1000);
    });
  }

  /**
   * Check if a file matches the chapter file pattern.
   * Uses simple glob matching to avoid ReDoS.
   */
  private isChapterFile(file: TFile): boolean {
    return globMatch(this.settings.chapterFilePattern, file.name);
  }
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
