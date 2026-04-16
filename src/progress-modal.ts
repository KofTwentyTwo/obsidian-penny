/**
 * PENNY - Progress Modal
 *
 * Displays real-time progress during annotation processing.
 * Shows a scrollable log of each annotation as it is processed,
 * with status indicators and a cancel/close button.
 */

import { Modal, App, Notice } from "obsidian";
import type { ProgressEvent } from "./pipeline";

export class PennyProgressModal extends Modal {
  private logEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private cancelled = false;
  private minimized = false;
  private showStatusNotices: boolean;

  constructor(app: App, title: string, showStatusNotices = true) {
    super(app);
    this.titleEl.setText(title);
    this.showStatusNotices = showStatusNotices;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-progress-modal");

    this.headerEl = contentEl.createEl("div", { cls: "penny-progress-header" });
    this.headerEl.setText("Starting...");

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
        line.setText(event.message ?? "");
        this.logEl.scrollTop = this.logEl.scrollHeight;
        break;
      }

      case "annotation-done": {
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
        // Swap Cancel -> Close
        const btn = this.contentEl.querySelector("button");
        if (btn) btn.setText("Close");
        break;
      }
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
