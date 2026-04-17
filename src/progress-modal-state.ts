/**
 * PENNY - Progress Modal State Machine
 *
 * Pure state machine that drives PennyProgressModal. Contains no DOM code
 * and no dependency on obsidian, so it's directly unit-testable.
 *
 * Why a state machine:
 * The previous modal tracked state via a `cancelled` boolean AND by inspecting
 * button text (`if (btn.textContent === "Cancel") ...`). The two representations
 * drifted: clicking the button labelled "Close" after completion ran the Cancel
 * handler because the handler was still bound -- the text had changed, the
 * wiring hadn't. Explicit states + per-state button visibility rules make
 * "Cancel" and "Close" structurally distinct actions that can never collide.
 *
 * State model:
 *   starting   -- modal opened, no events yet
 *   processing -- pipeline is working through annotations
 *   assembling -- pipeline is assembling the final version
 *   done       -- complete event received
 *   cancelled  -- user clicked Cancel OR pipeline emitted "cancelled"
 *   error      -- a fatal error occurred
 *
 * Terminal states (done/cancelled/error) show only a Close button.
 * Active states (starting/processing/assembling) show Cancel and Minimize.
 * Cancel is never shown in terminal states; Close is never shown in active states.
 * This is enforced by `view()` and cannot be bypassed by button-text mutation.
 */

import type { ProgressEvent } from "./pipeline";

export type ModalState =
  | "starting"
  | "processing"
  | "assembling"
  | "done"
  | "cancelled"
  | "error";

export interface ModalView {
  /** Text to display in the header. Never "Cancelling..." -- cancellation is instantaneous. */
  header: string;
  /** Whether the elapsed-time timer should be ticking. False in terminal states. */
  timerRunning: boolean;
  /** Cancel button is shown only in active states. */
  cancelButtonVisible: boolean;
  /** Close button is shown only in terminal states. */
  closeButtonVisible: boolean;
  /** Minimize is available during active processing, hidden in terminal states and during assembling. */
  minimizeButtonVisible: boolean;
  /** Streaming preview (the live-token element) is visible during active annotation processing. */
  streamPreviewVisible: boolean;
  /** Quote panel is visible throughout active processing and hidden in terminal states. */
  quotePanelVisible: boolean;
}

export interface StateMachineCallbacks {
  /** Called exactly once when the user first requests cancellation. */
  onAbort?: () => void;
}

const TERMINAL_STATES: ReadonlySet<ModalState> = new Set(["done", "cancelled", "error"]);

export class ProgressModalStateMachine {
  private _state: ModalState = "starting";
  private _abortFired = false;
  private _latestMessage: string | null = null;
  private _errorMessage: string | null = null;

  constructor(private callbacks: StateMachineCallbacks = {}) {}

  get state(): ModalState {
    return this._state;
  }

  /**
   * Drive state transitions from pipeline events. Events that don't require
   * a state change (token, annotation-done, annotation-error) are absorbed
   * silently -- the DOM shell handles their rendering.
   */
  handleEvent(event: ProgressEvent): void {
    if (event.message) {
      this._latestMessage = event.message;
    }

    switch (event.type) {
      case "start":
        // Stay in starting; the first annotation-start moves us to processing.
        break;
      case "annotation-start":
        if (!TERMINAL_STATES.has(this._state)) this._state = "processing";
        break;
      case "assembling":
        if (!TERMINAL_STATES.has(this._state)) this._state = "assembling";
        break;
      case "complete":
        // complete overrides any non-cancelled state. We honour prior cancel/error.
        if (this._state !== "cancelled" && this._state !== "error") {
          this._state = "done";
        }
        break;
      case "cancelled":
        this._state = "cancelled";
        break;
      // token / annotation-done / annotation-error don't transition state
      case "token":
      case "annotation-done":
      case "annotation-error":
        break;
    }
  }

  /**
   * User clicked Cancel. Fires onAbort exactly once across the run (even if
   * Cancel is clicked multiple times in quick succession), and transitions
   * to "cancelled". No-op in terminal states.
   */
  requestCancel(): void {
    if (TERMINAL_STATES.has(this._state)) return;
    if (!this._abortFired) {
      this._abortFired = true;
      try {
        this.callbacks.onAbort?.();
      } catch {
        // onAbort throwing must not leave the state machine in a weird spot.
      }
    }
    this._state = "cancelled";
  }

  /** Returns true iff closing the modal is currently allowed (terminal states only). */
  canClose(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  /** Explicitly set the modal into the error terminal state with a message. */
  setErrorState(message: string): void {
    this._state = "error";
    this._errorMessage = message;
  }

  /** Derive the UI view from the current state. Pure -- no side effects. */
  view(): ModalView {
    const state = this._state;
    const timerRunning = !TERMINAL_STATES.has(state);
    const inTerminal = TERMINAL_STATES.has(state);

    return {
      header: this.headerFor(state),
      timerRunning,
      cancelButtonVisible: !inTerminal,
      closeButtonVisible: inTerminal,
      // Minimize is only meaningful while actively processing annotations.
      // During assembling it's confusing (we're not doing the slow part anymore).
      minimizeButtonVisible: state === "starting" || state === "processing",
      streamPreviewVisible: state === "processing",
      quotePanelVisible: !inTerminal,
    };
  }

  private headerFor(state: ModalState): string {
    switch (state) {
      case "starting":
        return this._latestMessage ?? "Starting...";
      case "processing":
        return this._latestMessage ?? "Processing...";
      case "assembling":
        return this._latestMessage ?? "Assembling...";
      case "done":
        return this._latestMessage ?? "Complete";
      case "cancelled":
        return this._latestMessage
          ? `Cancelled. ${this._latestMessage}`
          : "Cancelled.";
      case "error":
        return this._errorMessage
          ? `Error: ${this._errorMessage}`
          : "Error.";
    }
  }
}
