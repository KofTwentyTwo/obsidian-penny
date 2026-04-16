/**
 * PENNY - Prose Engine for Narrative, Notes, and Yarns
 *
 * Main plugin entry point. Extends Obsidian's Plugin class to provide
 * AI-powered prose revision, annotation processing, and project management
 * for novel writing in Obsidian.
 *
 * @module main
 */

import { Plugin, Notice, TFile, requestUrl } from "obsidian";
import { PennySettingTab } from "./settings";
import { PennyStatusBar } from "./statusbar";
import { registerCommands, processChapter, requireProvider } from "./commands";
import { DEFAULT_SETTINGS, migrateSettings } from "./types";
import { createRegistry } from "./providers";
import { globMatch } from "./utils";
import type { ProviderRegistry } from "./providers/registry";
import type { HttpRequestParam } from "./providers/service";
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

  /** LLM provider registry */
  providerRegistry!: ProviderRegistry;

  /** Status bar widget instance */
  statusBar: PennyStatusBar | null = null;

  /** Reference to the file-modify event, for cleanup */
  private saveEventRef: ReturnType<typeof this.app.vault.on> | null = null;

  /** Set of file paths currently being processed (prevents re-entrant processing) */
  processingFiles: Set<string> = new Set();

  /** Pending debounce timers keyed by file path */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  async onload(): Promise<void> {
    await this.loadSettings();

    // Create LLM provider registry with Obsidian's requestUrl as the HTTP layer.
    // The adapter maps requestUrl's response to the HttpResponse shape providers expect.
    this.providerRegistry = createRegistry(async (params: HttpRequestParam) => {
      const resp = await requestUrl({
        url: params.url,
        method: params.method,
        headers: params.headers,
        body: params.body,
        contentType: params.contentType,
      });
      return {
        status: resp.status,
        headers: resp.headers,
        text: resp.text,
        json: resp.json,
      };
    });

    // Register the settings tab (receives the registry for model dropdowns)
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

    // First-run notice if no provider is configured.
    // ollamaEndpoint always has a default value, so only check the API key.
    if (!this.settings.anthropicApiKey) {
      new Notice(
        "PENNY loaded. Configure an LLM provider in Settings > PENNY to get started.",
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
   * Applies migration for legacy `apiKey` / `model` fields.
   */
  async loadSettings(): Promise<void> {
    const raw = await this.loadData();
    const migrated = raw ? migrateSettings(raw as Record<string, unknown>) : {};
    this.settings = { ...DEFAULT_SETTINGS, ...migrated };
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

    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (!this.settings.autoProcessOnSave) return;

    this.saveEventRef = this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;

      // Only trigger for chapter files
      if (!this.isChapterFile(file)) return;

      // Skip files currently being processed
      if (this.processingFiles.has(file.path)) return;

      // Debounce: cancel any pending timer for this file, then set a new one
      const existing = this.debounceTimers.get(file.path);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        this.debounceTimers.delete(file.path);
        // Double-check the file is still not being processed
        if (!this.processingFiles.has(file.path) && requireProvider(this)) {
          processChapter(this, file);
        }
      }, 2000);

      this.debounceTimers.set(file.path, timer);
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
