/**
 * PENNY - Status Bar Widget
 *
 * Manages a status bar element in Obsidian's footer that shows
 * contextual information about the active file. Created by main.ts
 * at plugin load and updated on every active-leaf-change event.
 *
 * Three display states:
 * - "ready": default idle state ("PENNY: ready")
 * - "info": showing annotation count + chapter info for the active file
 * - "processing": locked to "PENNY: processing..." during LLM calls
 *
 * Uses globMatch() from utils.ts for chapter file detection to avoid
 * constructing RegExp from user input (ReDoS prevention).
 */

import type { TFile } from "obsidian";
import type PennyPlugin from "./main";
import { globMatch } from "./utils";

/** Status bar display states */
type StatusBarState = "ready" | "processing" | "info";

/**
 * Manages PENNY's status bar element.
 *
 * Displays contextual information about the active file:
 * - When a chapter is open: annotation count, chapter name, version
 * - When no chapter is open: "ready"
 * - During API calls: "processing..."
 */
export class PennyStatusBar {
  private el: HTMLElement;
  private state: StatusBarState = "ready";

  constructor(statusBarEl: HTMLElement) {
    this.el = statusBarEl;
    this.el.addClass("penny-status-bar");
    this.setReady();
  }

  /**
   * Update status bar content based on the active file.
   *
   * Reads the file to count annotations matching the `%% TAG: ... %%` pattern.
   * If the file matches the chapter file pattern, displays annotation count
   * and version info. Otherwise shows the default ready state.
   *
   * @param file - The currently active file, or null if none
   * @param plugin - The plugin instance (for settings and vault access)
   */
  async update(file: TFile | null, plugin: PennyPlugin): Promise<void> {
    if (this.state === "processing") return;

    if (!file) {
      this.setReady();
      return;
    }

    if (!this.isChapterFile(file, plugin)) {
      this.setReady();
      return;
    }

    try {
      const content = await plugin.app.vault.cachedRead(file);
      const annotationCount = this.countAnnotations(content);
      const chapterName = this.extractChapterName(file);
      const version = this.extractVersion(file);

      const versionStr = version ? ` (v${version})` : "";
      this.setText(
        `PENNY: ${annotationCount} annotation${annotationCount === 1 ? "" : "s"} in ${chapterName}${versionStr}`
      );
      this.state = "info";
    } catch {
      this.setReady();
    }
  }

  /**
   * Set the status bar to "processing..." state.
   * This state persists until explicitly cleared.
   */
  setProcessing(): void {
    this.state = "processing";
    this.setText("PENNY: processing...");
  }

  /**
   * Set the status bar to the default ready state.
   */
  setReady(): void {
    this.state = "ready";
    this.setText("PENNY: ready");
  }

  /**
   * Set a custom message on the status bar.
   *
   * @param message - The message to display
   */
  setMessage(message: string): void {
    this.state = "info";
    this.setText(`PENNY: ${message}`);
  }

  /**
   * Check whether a file matches the chapter file pattern.
   * Uses simple glob matching (supports `*` and `?` only) without
   * constructing a RegExp from user input to avoid ReDoS.
   */
  private isChapterFile(file: TFile, plugin: PennyPlugin): boolean {
    return globMatch(plugin.settings.chapterFilePattern, file.name);
  }

  /**
   * Count annotations in file content.
   * Matches the `%% TAG: instruction %%` pattern.
   */
  private countAnnotations(content: string): number {
    const pattern = /%%\s*\w+\s*:.*?%%/g;
    const matches = content.match(pattern);
    return matches ? matches.length : 0;
  }

  /**
   * Extract a human-readable chapter name from the file path.
   * e.g., "ch-05.v2.md" -> "ch-05"
   */
  private extractChapterName(file: TFile): string {
    const name = file.basename;
    // Strip version suffix if present (ch-05.v2 -> ch-05)
    const versionMatch = name.match(/^(.+?)\.v\d+$/);
    return versionMatch ? versionMatch[1] : name;
  }

  /**
   * Extract the version number from the file name.
   * e.g., "ch-05.v3.md" -> 3
   */
  private extractVersion(file: TFile): number | null {
    const match = file.basename.match(/\.v(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Set the raw text content of the status bar element.
   */
  private setText(text: string): void {
    this.el.setText(text);
  }
}
