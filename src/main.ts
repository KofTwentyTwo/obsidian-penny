/**
 * PENNY - Prose Engine for Narrative, Notes, and Yarns
 *
 * Main plugin entry point. Extends Obsidian's Plugin class to bootstrap
 * the entire plugin: loading/saving settings, creating the LLM provider
 * registry, registering commands, setting up the status bar and ribbon
 * icon, and wiring the auto-process-on-save hook.
 *
 * Architecture:
 * - Settings are loaded from Obsidian's data.json with migration for
 *   legacy fields (see migrateSettings in types.ts).
 * - The provider registry is created with Obsidian's requestUrl as the
 *   HTTP transport layer, keeping providers decoupled from Obsidian.
 * - Commands, status bar, and ribbon icon are registered in onload().
 * - The save hook uses a per-file debounce (2s) and a re-entrancy guard
 *   (processingFiles set) to prevent cascading triggers.
 *
 * @module main
 */

import { Menu, Plugin, Notice, TFile, requestUrl } from "obsidian";
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

  /** Status bar container element, for show/hide */
  private statusBarEl: HTMLElement | null = null;

  /** Ribbon icon element, for removal on toggle */
  private ribbonIconEl: HTMLElement | null = null;

  /** Context menu event reference, for removal on toggle */
  private contextMenuRef: ReturnType<typeof this.app.workspace.on> | null = null;

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

    // Set up togglable UI elements
    this.setupUI();

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
      this.statusBar?.update(activeFile, this);
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

    // Re-configure UI elements in case toggles changed
    this.setupUI();
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
   * Set up or tear down UI elements (ribbon, context menu, status bar)
   * based on the current settings. Safe to call repeatedly.
   */
  private setupUI(): void {
    // --- Ribbon icon ---
    if (this.settings.showRibbonIcon) {
      if (!this.ribbonIconEl) {
        this.ribbonIconEl = this.addRibbonIcon("pen-tool", "PENNY", (evt) => {
          this.showRibbonMenu(evt);
        });
      }
    } else {
      if (this.ribbonIconEl) {
        this.ribbonIconEl.remove();
        this.ribbonIconEl = null;
      }
    }

    // --- Context menu ---
    if (this.settings.showContextMenu) {
      if (!this.contextMenuRef) {
        this.contextMenuRef = this.app.workspace.on("editor-menu", (menu) => {
          menu.addSeparator();
          menu.addItem((item) => {
            item.setTitle("PENNY: Process this chapter").setIcon("pen-tool")
              .onClick(() => executeCommand(this.app, "penny:process-chapter"));
          });
          menu.addItem((item) => {
            item.setTitle("PENNY: Dry run").setIcon("eye")
              .onClick(() => executeCommand(this.app, "penny:dry-run"));
          });
          menu.addItem((item) => {
            item.setTitle("PENNY: Show status").setIcon("info")
              .onClick(() => executeCommand(this.app, "penny:status"));
          });
          menu.addItem((item) => {
            item.setTitle("PENNY: Do research").setIcon("search")
              .onClick(() => executeCommand(this.app, "penny:research"));
          });
        });
        this.registerEvent(this.contextMenuRef);
      }
    } else {
      if (this.contextMenuRef) {
        this.app.workspace.offref(this.contextMenuRef);
        this.contextMenuRef = null;
      }
    }

    // --- Status bar ---
    if (this.settings.showStatusBar) {
      if (!this.statusBarEl) {
        this.statusBarEl = this.addStatusBarItem();
        this.statusBar = new PennyStatusBar(this.statusBarEl);
      }
    } else {
      if (this.statusBarEl) {
        this.statusBarEl.remove();
        this.statusBarEl = null;
        this.statusBar = null;
      }
    }
  }

  /**
   * Show the ribbon dropdown menu with all PENNY commands.
   */
  private showRibbonMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Process this chapter").setIcon("zap")
      .onClick(() => executeCommand(this.app, "penny:process-chapter")));
    menu.addItem((item) => item.setTitle("Process all chapters").setIcon("layers")
      .onClick(() => executeCommand(this.app, "penny:process-all")));
    menu.addItem((item) => item.setTitle("Dry run").setIcon("eye")
      .onClick(() => executeCommand(this.app, "penny:dry-run")));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Do research").setIcon("search")
      .onClick(() => executeCommand(this.app, "penny:research")));
    menu.addItem((item) => item.setTitle("Show status").setIcon("info")
      .onClick(() => executeCommand(this.app, "penny:status")));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("New chapter").setIcon("file-plus")
      .onClick(() => executeCommand(this.app, "penny:new-chapter")));
    menu.addItem((item) => item.setTitle("New character").setIcon("user-plus")
      .onClick(() => executeCommand(this.app, "penny:new-character")));
    menu.addItem((item) => item.setTitle("Initialize project").setIcon("folder-plus")
      .onClick(() => executeCommand(this.app, "penny:init")));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Migrate chapters").setIcon("folder-input")
      .onClick(() => executeCommand(this.app, "penny:migrate")));
    menu.addItem((item) => item.setTitle("Git commit").setIcon("git-commit-horizontal")
      .onClick(() => executeCommand(this.app, "penny:git-commit")));
    menu.addItem((item) => item.setTitle("Git push").setIcon("upload")
      .onClick(() => executeCommand(this.app, "penny:git-push")));
    menu.showAtMouseEvent(evt);
  }

  /**
   * Check if a file matches the chapter file pattern.
   * Uses simple glob matching to avoid ReDoS.
   */
  private isChapterFile(file: TFile): boolean {
    return globMatch(this.settings.chapterFilePattern, file.name);
  }
}
