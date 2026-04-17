/**
 * PENNY - Progress Modal State Machine Tests
 *
 * Exercises the pure state machine that drives PennyProgressModal. The state
 * machine owns all non-trivial logic (state transitions, button visibility,
 * cancel-vs-close distinction, timer start/stop). The Obsidian Modal itself
 * is a thin DOM-rendering shell around this state machine.
 *
 * Testing the state machine directly sidesteps the fact that `obsidian` is a
 * .d.ts-only package with no runtime -- instantiating Modal in tests is not
 * practical. These tests cover every bug from the previous modal:
 *   - Cancel and Close are distinct actions, never share a handler
 *   - Clicking Close from a done/cancelled/error state never re-cancels
 *   - Cancel moves directly to "cancelled" (no "Cancelling..." transient)
 *   - onAbort fires exactly once per run, even if Cancel is clicked twice
 *   - Quote panel is visible throughout processing, hidden when done
 */

import { describe, it, expect, vi } from "vitest";
import { ProgressModalStateMachine } from "../src/progress-modal-state";
import type { ProgressEvent } from "../src/pipeline";

function makeMachine(opts?: { onAbort?: () => void }) {
  return new ProgressModalStateMachine({ onAbort: opts?.onAbort });
}

describe("ProgressModalStateMachine — initial state", () => {
  it("starts in 'starting' with timer running, cancel+minimize visible, no close", () => {
    const m = makeMachine();
    expect(m.state).toBe("starting");
    const v = m.view();
    expect(v.timerRunning).toBe(true);
    expect(v.cancelButtonVisible).toBe(true);
    expect(v.minimizeButtonVisible).toBe(true);
    expect(v.closeButtonVisible).toBe(false);
  });
});

describe("ProgressModalStateMachine — event-driven transitions", () => {
  it("start -> processing on annotation-start", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 3, message: "Processing 1/3" });
    expect(m.state).toBe("processing");
    expect(m.view().cancelButtonVisible).toBe(true);
  });

  it("processing -> assembling on assembling event", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 1 });
    m.handleEvent({ type: "assembling", message: "Assembling..." });
    expect(m.state).toBe("assembling");
  });

  it("assembling -> done on complete event, timer stops, Close replaces Cancel", () => {
    const m = makeMachine();
    m.handleEvent({ type: "assembling" });
    m.handleEvent({ type: "complete", message: "Complete" });
    expect(m.state).toBe("done");
    const v = m.view();
    expect(v.timerRunning).toBe(false);
    expect(v.cancelButtonVisible).toBe(false);
    expect(v.closeButtonVisible).toBe(true);
    expect(v.minimizeButtonVisible).toBe(false);
  });

  it("any state -> cancelled on 'cancelled' pipeline event", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 3 });
    m.handleEvent({ type: "cancelled", message: "Cancelled after 0 annotations" });
    expect(m.state).toBe("cancelled");
    const v = m.view();
    expect(v.timerRunning).toBe(false);
    expect(v.cancelButtonVisible).toBe(false);
    expect(v.closeButtonVisible).toBe(true);
  });

  it("emits 'error' state when pipeline surfaces a fatal annotation-error with no recovery", () => {
    // annotation-error alone doesn't mean fatal -- pipelines recover from per-annotation
    // errors. But if the modal receives a top-level error event, it transitions.
    // We model this via a dedicated "error" event for clarity.
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 1 });
    m.setErrorState("Pipeline failed");
    expect(m.state).toBe("error");
    expect(m.view().closeButtonVisible).toBe(true);
    expect(m.view().cancelButtonVisible).toBe(false);
  });
});

describe("ProgressModalStateMachine — cancel action", () => {
  it("requestCancel() from processing moves to 'cancelled' and fires onAbort once", () => {
    const onAbort = vi.fn();
    const m = makeMachine({ onAbort });
    m.handleEvent({ type: "annotation-start", current: 1, total: 3 });
    m.requestCancel();
    expect(m.state).toBe("cancelled");
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("requestCancel() called twice fires onAbort exactly once (idempotent)", () => {
    const onAbort = vi.fn();
    const m = makeMachine({ onAbort });
    m.handleEvent({ type: "annotation-start", current: 1, total: 3 });
    m.requestCancel();
    m.requestCancel();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(m.state).toBe("cancelled");
  });

  it("requestCancel() from 'done' is a no-op and does NOT call onAbort", () => {
    // This is the classic bug from the old modal: clicking "Close" after complete
    // triggered the Cancel handler and set "Cancelling...". Never again.
    const onAbort = vi.fn();
    const m = makeMachine({ onAbort });
    m.handleEvent({ type: "complete", message: "Done" });
    m.requestCancel();
    expect(onAbort).not.toHaveBeenCalled();
    expect(m.state).toBe("done");
  });

  it("requestCancel() from 'error' is a no-op", () => {
    const onAbort = vi.fn();
    const m = makeMachine({ onAbort });
    m.setErrorState("Boom");
    m.requestCancel();
    expect(onAbort).not.toHaveBeenCalled();
    expect(m.state).toBe("error");
  });

  it("requestCancel() sets header to 'Cancelled' directly (no 'Cancelling...' transient)", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 3 });
    m.requestCancel();
    expect(m.view().header).toMatch(/^Cancelled/);
  });

  it("requestCancel() works even when onAbort is not provided", () => {
    const m = makeMachine(); // no onAbort
    m.handleEvent({ type: "annotation-start", current: 1, total: 3 });
    expect(() => m.requestCancel()).not.toThrow();
    expect(m.state).toBe("cancelled");
  });
});

describe("ProgressModalStateMachine — close action", () => {
  it("canClose() returns true from terminal states", () => {
    const m1 = makeMachine();
    m1.handleEvent({ type: "complete" });
    expect(m1.canClose()).toBe(true);

    const m2 = makeMachine();
    m2.requestCancel();
    expect(m2.canClose()).toBe(true);

    const m3 = makeMachine();
    m3.setErrorState("x");
    expect(m3.canClose()).toBe(true);
  });

  it("canClose() returns false from active states", () => {
    const m = makeMachine();
    expect(m.canClose()).toBe(false);
    m.handleEvent({ type: "annotation-start", current: 1, total: 1 });
    expect(m.canClose()).toBe(false);
    m.handleEvent({ type: "assembling" });
    expect(m.canClose()).toBe(false);
  });
});

describe("ProgressModalStateMachine — header text", () => {
  it("reflects the most recent event's message when provided", () => {
    const m = makeMachine();
    m.handleEvent({ type: "start", message: "Processing chapter 5" });
    expect(m.view().header).toBe("Processing chapter 5");
  });

  it("falls back to a default header when no message is provided", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 2, total: 5 });
    // Processing state should produce a reasonable default header
    expect(m.view().header.length).toBeGreaterThan(0);
  });

  it("complete state reads 'Complete' by default", () => {
    const m = makeMachine();
    m.handleEvent({ type: "complete" });
    expect(m.view().header).toMatch(/complete/i);
  });
});

describe("ProgressModalStateMachine — stream preview and quote panel visibility", () => {
  it("quote panel is visible during active processing", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 1 });
    expect(m.view().quotePanelVisible).toBe(true);
  });

  it("quote panel is hidden in terminal states", () => {
    const m1 = makeMachine();
    m1.handleEvent({ type: "complete" });
    expect(m1.view().quotePanelVisible).toBe(false);

    const m2 = makeMachine();
    m2.requestCancel();
    expect(m2.view().quotePanelVisible).toBe(false);
  });
});

describe("ProgressModalStateMachine — timer", () => {
  it("timer keeps running during assembling state", () => {
    const m = makeMachine();
    m.handleEvent({ type: "assembling" });
    expect(m.view().timerRunning).toBe(true);
  });

  it("timer stops in every terminal state", () => {
    const finalStates: Array<() => ProgressModalStateMachine> = [
      () => { const m = makeMachine(); m.handleEvent({ type: "complete" }); return m; },
      () => { const m = makeMachine(); m.requestCancel(); return m; },
      () => { const m = makeMachine(); m.setErrorState("x"); return m; },
    ];
    for (const setup of finalStates) {
      expect(setup().view().timerRunning).toBe(false);
    }
  });
});

describe("ProgressModalStateMachine — ProgressEvent passthrough", () => {
  it("does not crash on token/annotation-done events (they don't change state)", () => {
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 2 });
    expect(() => {
      m.handleEvent({ type: "token", text: "hello" });
      m.handleEvent({ type: "annotation-done", current: 1, total: 2 });
    }).not.toThrow();
    expect(m.state).toBe("processing");
  });

  it("annotation-error alone does NOT transition to error state", () => {
    // annotation-error is recoverable -- the pipeline continues to the next annotation.
    // Only a top-level fatal error moves the modal to "error" state.
    const m = makeMachine();
    m.handleEvent({ type: "annotation-start", current: 1, total: 2 });
    m.handleEvent({ type: "annotation-error", current: 1, total: 2, message: "One failed" });
    expect(m.state).toBe("processing");
  });
});
