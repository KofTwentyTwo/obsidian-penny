/**
 * PENNY - Error Modal
 *
 * Shows detailed error information in a persistent modal instead of
 * a flashing notice that disappears. Includes error message, stack trace,
 * and a link to the activity log.
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
 * Use this instead of `new Notice()` for errors.
 */
export function showPennyError(app: App, error: string, details?: string, logPath?: string): void {
  new PennyErrorModal(app, { error, details, logPath }).open();
}
