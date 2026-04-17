/**
 * PENNY - Progress Modal
 *
 * Obsidian Modal subclass that displays real-time progress during
 * annotation processing. Shows a scrollable log of each annotation
 * as it is processed, with status indicators (spinner -> done/error),
 * a live elapsed timer, and Cancel/Minimize/Close buttons.
 *
 * Lifecycle:
 * - Created and opened by commands.ts before calling runPipeline()
 * - Updated by the pipeline's onProgress callback with ProgressEvents
 * - User can minimize (processing continues, status shown via Notices)
 * - User can cancel (pipeline checks isCancelled() before each annotation)
 * - Automatically transitions to "complete" state when pipeline finishes
 *
 * Uses Obsidian's Modal API for rendering. CSS classes are prefixed
 * with `penny-` (styles defined in styles.css).
 */

import { Modal, App, Notice } from "obsidian";
import type { ProgressEvent } from "./pipeline";

export class PennyProgressModal extends Modal {
  private logEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private streamEl: HTMLElement | null = null;
  private cancelled = false;
  private minimized = false;
  private showStatusNotices: boolean;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  constructor(app: App, title: string, showStatusNotices = true) {
    super(app);
    this.titleEl.setText(title);
    this.showStatusNotices = showStatusNotices;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-progress-modal");

    const headerRow = contentEl.createEl("div", { cls: "penny-progress-header-row" });
    this.headerEl = headerRow.createEl("div", { cls: "penny-progress-header" });
    this.headerEl.setText("Starting...");
    this.timerEl = headerRow.createEl("div", { cls: "penny-progress-timer" });
    this.timerEl.setText("0s");

    // Live elapsed timer -- updates every second so user knows it's alive
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      this.timerEl.setText(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }, 1000);

    this.logEl = contentEl.createEl("div", { cls: "penny-progress-log" });

    // Button row: Minimize | Cancel/Close
    const buttonRow = contentEl.createEl("div", { cls: "penny-progress-buttons" });

    const minimizeBtn = buttonRow.createEl("button", { text: "Minimize" });
    minimizeBtn.addEventListener("click", () => {
      this.minimized = true;
      this.close();
      new Notice("PENNY: Processing continues in background. Status updates in notices.", 4000);
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      if (this.cancelled) {
        this.close();
        return;
      }
      this.cancelled = true;
      this.headerEl.setText("Cancelling...");
    });
  }

  /** Whether the modal was minimized (processing continues in background). */
  isMinimized(): boolean {
    return this.minimized;
  }

  /** Called by processChapter to update the modal with a pipeline event. */
  update(event: ProgressEvent): void {
    // If minimized, show status via Notices instead of modal
    if (this.minimized) {
      if (this.showStatusNotices && event.message) {
        if (event.type === "annotation-done" || event.type === "annotation-error" || event.type === "complete") {
          new Notice(`PENNY: ${event.message}`, event.type === "complete" ? 6000 : 3000);
        }
      }
      return;
    }
    if (!this.logEl) return;

    switch (event.type) {
      case "start":
        this.headerEl.setText(event.message ?? "Processing...");
        break;

      case "annotation-start": {
        const line = this.logEl.createEl("div", {
          cls: "penny-progress-line penny-progress-active",
        });
        line.dataset.index = String(event.current);
        const spinner = line.createEl("span", { cls: "penny-inline-spinner" });
        spinner.setText("");
        line.createEl("span", { text: ` ${event.message ?? ""}` });

        // Create streaming preview area for live LLM output
        this.streamEl = this.logEl.createEl("div", { cls: "penny-stream-preview" });

        this.logEl.scrollTop = this.logEl.scrollHeight;
        break;
      }

      case "token": {
        // Append streaming text to the preview area
        if (this.streamEl && event.text) {
          this.streamEl.appendText(event.text);
          this.logEl.scrollTop = this.logEl.scrollHeight;
        }
        break;
      }

      case "annotation-done": {
        // Remove the streaming preview
        if (this.streamEl) {
          this.streamEl.remove();
          this.streamEl = null;
        }
        const line = this.logEl.querySelector(
          `[data-index="${event.current}"]`,
        ) as HTMLElement | null;
        if (line) {
          line.setText(event.message ?? "");
          line.removeClass("penny-progress-active");
          line.addClass("penny-progress-done");
        }
        break;
      }

      case "annotation-error": {
        const line = this.logEl.querySelector(
          `[data-index="${event.current}"]`,
        ) as HTMLElement | null;
        if (line) {
          line.setText(event.message ?? "");
          line.removeClass("penny-progress-active");
          line.addClass("penny-progress-error");
        }
        break;
      }

      case "assembling":
        this.headerEl.setText(event.message ?? "Assembling...");
        break;

      case "complete": {
        this.headerEl.setText(event.message ?? "Complete");
        // Stop the timer
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        // Show final elapsed time
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        this.timerEl.setText(mins > 0 ? `Done in ${mins}m ${secs}s` : `Done in ${secs}s`);
        // Swap Cancel -> Close
        const btns = this.contentEl.querySelectorAll("button");
        btns.forEach((btn) => { if (btn.textContent === "Cancel") btn.setText("Close"); });
        // Hide Minimize button
        btns.forEach((btn) => { if (btn.textContent === "Minimize") btn.style.display = "none"; });
        break;
      }
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onClose(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.contentEl.empty();
  }
}
