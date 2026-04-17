/**
 * PENNY - Pipeline Cancellation Tests
 *
 * Verifies that the pipeline's cancellation spine works correctly:
 *   - Aborting an AbortController mid-annotation propagates to the provider
 *   - An AbortError thrown by the provider is translated to a "cancelled" event
 *   - The pipeline resolves with null on cancellation (no partial version)
 *   - The AbortSignal passed to the pipeline reaches the provider's complete() call
 *   - Pre-aborted signals short-circuit before any provider call
 *
 * These tests complement integration.test.ts, which exercises the legacy
 * isCancelled callback path. This file exercises the AbortSignal path added
 * in the cancellation-spine refactor.
 */

import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline";
import type { PipelineInput, ProgressEvent } from "../src/pipeline";
import type { PennySettings } from "../src/types";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../src/types";
import type { ContextFiles } from "../src/context";
import type { CompletionRequest, CompletionResponse } from "../src/providers/service";

const TEST_CHAPTER = `---
type: chapter
book: 1
chapter: 5
title: The Discovery
pov: protagonist
status: draft
wordcount: 100
focus: protagonist
---

# Book 1, Chapter 5

<!-- Prose begins below -->

The lab was quiet at 3am.
%% REWRITE: Add sensory detail %%

She stared at the screen.
%% EXPAND: Add dialogue with Rabbit %%

The data made no sense.
%% REWRITE: Clarify the anomaly %%
`;

const TEST_SETTINGS: PennySettings = {
  ...DEFAULT_SETTINGS,
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT,
  proseMarker: "<!-- Prose begins below -->",
};

function makeContextFiles(chapter: string): ContextFiles {
  return {
    chapter,
    voiceTests: "",
    styleGuide: "",
    outline: "",
    characters: [],
    wiki: [],
    seriesBible: "",
    themes: "",
  };
}

/**
 * Create a provider that records the signal it receives on each call, and
 * respects the signal by throwing AbortError if already aborted or when the
 * signal fires mid-call.
 */
function createSignalAwareProvider() {
  const receivedSignals: Array<AbortSignal | undefined> = [];
  const calls: CompletionRequest[] = [];

  return {
    receivedSignals,
    calls,
    provider: {
      name: "signal-aware",
      requiresApiKey: false,
      tokenMultiplier: 1.0,
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        calls.push(request);
        receivedSignals.push(request.signal);

        // If the signal is already aborted, reject immediately (like a real
        // provider using streamRequest would).
        if (request.signal?.aborted) {
          const err = new Error("Request aborted");
          err.name = "AbortError";
          throw err;
        }

        // Otherwise simulate an in-flight call that watches the signal.
        return await new Promise<CompletionResponse>((resolve, reject) => {
          const onAbort = () => {
            const err = new Error("Request aborted");
            err.name = "AbortError";
            reject(err);
          };
          request.signal?.addEventListener("abort", onAbort, { once: true });

          // Resolve on the next tick to give the test a chance to abort.
          setTimeout(() => {
            request.signal?.removeEventListener("abort", onAbort);
            if (request.signal?.aborted) {
              const err = new Error("Request aborted");
              err.name = "AbortError";
              reject(err);
              return;
            }
            resolve({
              text: "Revised passage.",
              model: request.model,
              provider: "signal-aware",
            });
          }, 5);
        });
      },
      estimateTokens: (text: string) => text.split(/\s+/).length,
      async getModels() {
        return [];
      },
      async testConnection() {
        return null;
      },
    },
  };
}

function makeInputWithSignal(
  signal: AbortSignal,
  providerFactory: ReturnType<typeof createSignalAwareProvider>,
  onProgress?: (ev: ProgressEvent) => void,
): PipelineInput {
  return {
    content: TEST_CHAPTER,
    versionContent: "1",
    stateContent: "",
    contextFiles: makeContextFiles(TEST_CHAPTER),
    settings: TEST_SETTINGS,
    chapterId: "ch-05",
    bookId: "book-1",
    getProvider: () => providerFactory.provider,
    signal,
    onProgress,
  };
}

describe("runPipeline cancellation (AbortSignal)", () => {
  it("passes the AbortSignal through to the provider's complete() call", async () => {
    const controller = new AbortController();
    const pf = createSignalAwareProvider();

    const result = await runPipeline(makeInputWithSignal(controller.signal, pf));

    // Should succeed normally (never aborted)
    expect(result).not.toBeNull();
    expect(pf.receivedSignals.length).toBeGreaterThan(0);

    // The provider received the same signal instance that the pipeline was given
    for (const sig of pf.receivedSignals) {
      expect(sig).toBe(controller.signal);
    }
  });

  it("resolves with null and emits 'cancelled' when the signal aborts mid-annotation", async () => {
    const controller = new AbortController();
    const pf = createSignalAwareProvider();
    const events: ProgressEvent[] = [];

    // Abort on the first annotation-start event, which fires before the first
    // provider call resolves. The in-flight call should then reject with AbortError.
    const input = makeInputWithSignal(controller.signal, pf, (ev) => {
      events.push(ev);
      if (ev.type === "annotation-start" && ev.current === 1) {
        controller.abort();
      }
    });

    const result = await runPipeline(input);

    // Cancelled mid-run must NOT produce a version
    expect(result).toBeNull();

    // A "cancelled" event must have been emitted
    const cancelled = events.filter((e) => e.type === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    expect(cancelled[0].message).toMatch(/Cancelled/i);

    // And no "complete" event -- cancelled is not completion
    const complete = events.filter((e) => e.type === "complete");
    expect(complete.length).toBe(0);
  });

  it("short-circuits before any provider call when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-aborted
    const pf = createSignalAwareProvider();
    const events: ProgressEvent[] = [];

    const result = await runPipeline(
      makeInputWithSignal(controller.signal, pf, (ev) => events.push(ev)),
    );

    expect(result).toBeNull();

    // Provider should never have been invoked -- the loop-top check catches it
    expect(pf.calls.length).toBe(0);

    // A cancelled event is emitted from the loop-top cancellation check
    const cancelled = events.filter((e) => e.type === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  it("does not create a version or write state when cancelled", async () => {
    const controller = new AbortController();
    const pf = createSignalAwareProvider();

    const input = makeInputWithSignal(controller.signal, pf, (ev) => {
      if (ev.type === "annotation-start") controller.abort();
    });

    const result = await runPipeline(input);

    // The null result is the contract: commands.ts uses this to decide whether
    // to write the .version / .state.json files. If result is null, nothing is written.
    expect(result).toBeNull();
  });

  it("treats AbortError from the provider as cancellation (not as an API error)", async () => {
    // Provider that always throws AbortError -- simulates streamRequest reacting
    // to req.destroy() when the signal aborts mid-stream.
    const abortingProvider = {
      name: "aborting",
      requiresApiKey: false,
      async complete(_req: CompletionRequest): Promise<CompletionResponse> {
        const err = new Error("Request aborted");
        err.name = "AbortError";
        throw err;
      },
      estimateTokens: (t: string) => t.split(/\s+/).length,
      async getModels() {
        return [];
      },
      async testConnection() {
        return null;
      },
    };

    const controller = new AbortController();
    const events: ProgressEvent[] = [];

    const input: PipelineInput = {
      content: TEST_CHAPTER,
      versionContent: "1",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: TEST_SETTINGS,
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => abortingProvider,
      signal: controller.signal,
      onProgress: (ev) => events.push(ev),
    };

    const result = await runPipeline(input);

    // AbortError from the provider must translate to a null result (no version)
    expect(result).toBeNull();

    // It must NOT be surfaced as an AGENT-ERROR annotation-error event
    const annotationErrors = events.filter((e) => e.type === "annotation-error");
    expect(annotationErrors.length).toBe(0);

    // It must emit a cancelled event instead
    const cancelled = events.filter((e) => e.type === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts either isCancelled callback or AbortSignal as a cancellation source", async () => {
    // Exercises the unified isCancelled() helper: signal aborted but no callback.
    const controller = new AbortController();
    controller.abort();
    const pf = createSignalAwareProvider();

    const result = await runPipeline({
      content: TEST_CHAPTER,
      versionContent: "1",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: TEST_SETTINGS,
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => pf.provider,
      signal: controller.signal,
      // no isCancelled callback -- signal alone should cancel
    });

    expect(result).toBeNull();
    expect(pf.calls.length).toBe(0);
  });
});
