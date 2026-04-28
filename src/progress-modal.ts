/**
 * PENNY - Progress Modal
 *
 * Thin DOM shell around ProgressModalStateMachine. The state machine owns
 * all non-trivial logic (transitions, button visibility, header text, timer
 * start/stop); this file renders the current view and re-renders on state
 * change.
 *
 * Lifecycle:
 * - Created and opened by commands.ts before calling runPipeline()
 * - Updated by the pipeline's onProgress callback with ProgressEvents
 * - User can minimize (processing continues, status shown via Notices)
 * - User can cancel (onAbort callback triggers the pipeline's AbortController)
 * - Transitions to a terminal state on complete/cancelled/error event
 *
 * Button rule: Cancel and Close are structurally distinct elements. They are
 * (re)created each time `renderButtons()` runs, so a click handler can never
 * be attached to the wrong action. This is enforced by the state machine's
 * view flags -- a terminal state has cancelButtonVisible=false unconditionally.
 */

import { Modal, App, Notice } from "obsidian";
import type { ProgressEvent } from "./pipeline";
import { ProgressModalStateMachine } from "./progress-modal-state";
import { pickRandomQuote, quoteAt } from "./quotes";

const QUOTE_ROTATION_MS = 30_000;

export interface PennyProgressModalOptions {
  /** Invoked exactly once when the user clicks Cancel. Should trigger AbortController.abort(). */
  onAbort?: () => void;
  /** Whether to surface annotation milestones as Notices when minimized. */
  showStatusNotices?: boolean;
}

export class PennyProgressModal extends Modal {
  private stateMachine: ProgressModalStateMachine;
  private minimized = false;
  private showStatusNotices: boolean;
  private onAbortCallback?: () => void;

  // DOM handles
  private logEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private buttonRowEl!: HTMLElement;
  private quotePanelEl!: HTMLElement;
  private quoteTextEl!: HTMLElement;
  private quoteAuthorEl!: HTMLElement;
  private streamEl: HTMLElement | null = null;
  private streamPlaceholderActive = false;

  // Timers
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private quoteInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private quoteIndex = 0;

  constructor(
    app: App,
    title: string,
    showStatusNoticesOrOpts: boolean | PennyProgressModalOptions = true,
  ) {
    super(app);
    this.titleEl.setText(title);

    // Back-compat: old callers passed a boolean for showStatusNotices.
    if (typeof showStatusNoticesOrOpts === "boolean") {
      this.showStatusNotices = showStatusNoticesOrOpts;
    } else {
      this.showStatusNotices = showStatusNoticesOrOpts.showStatusNotices ?? true;
      this.onAbortCallback = showStatusNoticesOrOpts.onAbort;
    }

    this.stateMachine = new ProgressModalStateMachine({
      onAbort: () => this.onAbortCallback?.(),
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-progress-modal");
    // Size the outer modal wrapper, not just the content. `min-width` on
    // contentEl alone doesn't propagate up through Obsidian's `.modal` chain
    // reliably -- the wrapper auto-sizes narrower than we want.
    this.modalEl.addClass("penny-progress-modal-wrapper");

    const headerRow = contentEl.createEl("div", { cls: "penny-progress-header-row" });
    this.headerEl = headerRow.createEl("div", { cls: "penny-progress-header" });
    this.timerEl = headerRow.createEl("div", { cls: "penny-progress-timer" });

    this.logEl = contentEl.createEl("div", { cls: "penny-progress-log" });

    // Quote panel (visible during active processing; hidden in terminal states)
    this.quotePanelEl = contentEl.createEl("div", { cls: "penny-quote-panel" });
    this.quotePanelEl.createEl("div", {
      cls: "penny-quote-panel-label",
      text: "while we wait together...",
    });
    this.quoteTextEl = this.quotePanelEl.createEl("div", { cls: "penny-quote-text" });
    this.quoteAuthorEl = this.quotePanelEl.createEl("div", { cls: "penny-quote-author" });
    this.seedQuote();

    this.buttonRowEl = contentEl.createEl("div", { cls: "penny-progress-buttons" });

    // Start the wall-clock timer and quote rotation
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => this.renderTimer(), 1000);
    this.quoteInterval = setInterval(() => this.rotateQuote(), QUOTE_ROTATION_MS);

    this.render();
  }

  /** Whether the modal was minimized (processing continues in background). */
  isMinimized(): boolean {
    return this.minimized;
  }

  /** Called by processChapter to update the modal with a pipeline event. */
  update(event: ProgressEvent): void {
    // If minimized, forward milestone events to Notices and skip DOM work.
    if (this.minimized) {
      if (this.showStatusNotices && event.message) {
        if (
          event.type === "annotation-done" ||
          event.type === "annotation-error" ||
          event.type === "complete" ||
          event.type === "cancelled"
        ) {
          new Notice(`PENNY: ${event.message}`, event.type === "complete" ? 6000 : 3000);
        }
      }
      this.stateMachine.handleEvent(event);
      return;
    }

    // Handle content-level DOM updates (these don't change state)
    this.renderEventContent(event);

    // Drive state transitions (which may change buttons/header/timer)
    this.stateMachine.handleEvent(event);
    this.render();
  }

  /**
   * Back-compat shim. Old commands.ts reads `modal.isCancelled()` to decide
   * whether the pipeline ended via cancel-vs-no-annotations. New callers
   * should rely on the pipeline's null return + the "cancelled" event type
   * instead, but we preserve the method to avoid churning all call sites.
   */
  isCancelled(): boolean {
    return this.stateMachine.state === "cancelled";
  }

  /** Move the modal into an error terminal state (for fatal pipeline failures). */
  setError(message: string): void {
    this.stateMachine.setErrorState(message);
    this.render();
  }

  onClose(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.quoteInterval) {
      clearInterval(this.quoteInterval);
      this.quoteInterval = null;
    }
    this.contentEl.empty();
  }

  // ---------- internal rendering ----------

  private render(): void {
    const view = this.stateMachine.view();

    this.headerEl.setText(view.header);

    // Timer rendering
    if (!view.timerRunning && this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      this.renderTimer(true);
    }

    // Quote panel visibility
    this.quotePanelEl.style.display = view.quotePanelVisible ? "" : "none";
    if (!view.quotePanelVisible && this.quoteInterval) {
      clearInterval(this.quoteInterval);
      this.quoteInterval = null;
    }

    this.renderButtons(view);
  }

  private renderEventContent(event: ProgressEvent): void {
    switch (event.type) {
      case "annotation-start": {
        const line = this.logEl.createEl("div", {
          cls: "penny-progress-line penny-progress-active",
        });
        line.dataset.index = String(event.current);
        const spinner = line.createEl("span", { cls: "penny-inline-spinner" });
        spinner.setText("");
        line.createEl("span", { text: ` ${event.message ?? ""}` });

        this.streamEl = this.logEl.createEl("div", { cls: "penny-stream-preview" });
        this.streamEl.createEl("span", {
          cls: "penny-waiting-text",
          text: "Waiting for the model to start streaming...",
        });
        this.streamPlaceholderActive = true;
        break;
      }
      case "token": {
        if (this.streamEl && event.text) {
          if (this.streamPlaceholderActive) {
            this.streamEl.empty();
            this.streamPlaceholderActive = false;
          }
          this.streamEl.appendText(event.text);
          // Pin the preview to its own bottom so new tokens stay visible.
          // The outer log does not scroll -- only this inner element does.
          this.streamEl.scrollTop = this.streamEl.scrollHeight;
        }
        break;
      }
      case "retry": {
        const line = this.logEl.querySelector(
          `[data-index="${event.current}"]`,
        ) as HTMLElement | null;
        if (line) {
          const attempt = event.attempt ?? 0;
          const waitSec = Math.round((event.waitMs ?? 0) / 1000);
          const reason = event.reason ?? "transient error";
          // Replace the line content. Spinner is dropped for now; it returns
          // on the next annotation-start cycle. Acceptable trade-off for a
          // transient state.
          line.setText(
            ` Retrying after ${reason} (attempt ${attempt}, waiting ${waitSec}s)...`,
          );
        }
        break;
      }
      case "annotation-done": {
        if (this.streamEl) {
          this.streamEl.remove();
          this.streamEl = null;
          this.streamPlaceholderActive = false;
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
      // start / assembling / complete / cancelled handled entirely via render()
      case "start":
      case "assembling":
      case "complete":
      case "cancelled":
        break;
    }
  }

  private renderButtons(view: { cancelButtonVisible: boolean; closeButtonVisible: boolean; minimizeButtonVisible: boolean }): void {
    // Re-create the button row from scratch every time the view changes. This
    // is the core of the fix: listeners are attached per render, so a button
    // element only ever carries the handler that matches its current label.
    this.buttonRowEl.empty();

    if (view.minimizeButtonVisible) {
      const btn = this.buttonRowEl.createEl("button", { text: "Minimize" });
      btn.addEventListener("click", () => {
        this.minimized = true;
        this.close();
        new Notice("PENNY: Processing continues in background. Status updates in notices.", 4000);
      });
    }

    if (view.cancelButtonVisible) {
      const btn = this.buttonRowEl.createEl("button", { text: "Cancel" });
      btn.addEventListener("click", () => {
        this.stateMachine.requestCancel();
        this.render();
      });
    }

    if (view.closeButtonVisible) {
      const btn = this.buttonRowEl.createEl("button", { text: "Close" });
      btn.addEventListener("click", () => this.close());
    }
  }

  private renderTimer(final = false): void {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const pretty = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    this.timerEl.setText(final ? `Done in ${pretty}` : pretty);
  }

  private seedQuote(): void {
    const q = pickRandomQuote();
    this.quoteIndex = Math.floor(Math.random() * 1_000_000);
    this.quoteTextEl.setText(`"${q.text}"`);
    this.quoteAuthorEl.setText(`— ${q.author}`);
  }

  private rotateQuote(): void {
    this.quoteIndex += 1;
    const q = quoteAt(this.quoteIndex);
    this.quoteTextEl.setText(`"${q.text}"`);
    this.quoteAuthorEl.setText(`— ${q.author}`);
  }
}
