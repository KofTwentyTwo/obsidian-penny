/**
 * PENNY - Error Modal
 *
 * Obsidian Modal subclass for displaying persistent error information.
 * Unlike Obsidian's Notice (which auto-dismisses), this modal stays open
 * until the user explicitly closes it, giving them time to read and
 * copy error details.
 *
 * Shows: error message, optional expandable stack trace / API response,
 * and an optional path to the activity log for further investigation.
 *
 * Used by commands.ts when processChapter() catches an unexpected error.
 */

import { Modal, App } from "obsidian";

export class PennyErrorModal extends Modal {
  private title: string;
  private errorMessage: string;
  private details: string;
  private logPath: string;

  constructor(app: App, opts: {
    title?: string;
    error: string;
    details?: string;
    logPath?: string;
  }) {
    super(app);
    this.title = opts.title ?? "PENNY Error";
    this.errorMessage = opts.error;
    this.details = opts.details ?? "";
    this.logPath = opts.logPath ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-error-modal");

    contentEl.createEl("h3", { text: this.title });

    // Error message
    const errorBox = contentEl.createEl("div", { cls: "penny-error-box" });
    errorBox.createEl("p", { text: this.errorMessage, cls: "penny-error-message" });

    // Details (stack trace, API response, etc.)
    if (this.details) {
      const detailsEl = contentEl.createEl("details", { cls: "penny-error-details" });
      detailsEl.createEl("summary", { text: "Full Details" });
      const pre = detailsEl.createEl("pre");
      pre.createEl("code", { text: this.details });
    }

    // Log path link
    if (this.logPath) {
      contentEl.createEl("p", {
        text: `Activity log: ${this.logPath}`,
        cls: "penny-error-log-path",
      });
    }

    // Close button
    const buttonRow = contentEl.createEl("div", { cls: "penny-progress-buttons" });
    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Show a PENNY error in a persistent modal.
 * Use this instead of `new Notice()` for errors that need user attention.
 *
 * @param app     - The Obsidian App instance
 * @param error   - Primary error message
 * @param details - Optional stack trace or additional detail (shown in expandable section)
 * @param logPath - Optional path to the activity log file for reference
 */
export function showPennyError(app: App, error: string, details?: string, logPath?: string): void {
  new PennyErrorModal(app, { error, details, logPath }).open();
}
