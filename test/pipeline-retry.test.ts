/**
 * PENNY - Pipeline Retry Event Tests
 *
 * Verifies that the pipeline forwards a provider-emitted onRetry callback
 * to a ProgressEvent("retry", ...) for the modal, and threads
 * settings.maxRetries through to the provider.
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
title: Retry Test
pov: protagonist
status: draft
wordcount: 50
focus: protagonist
---

# Book 1, Chapter 5

<!-- Prose begins below -->

The lab was quiet at 3am.
%% REWRITE: Add sensory detail %%
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

describe("runPipeline retry event forwarding", () => {
  it("threads settings.maxRetries into the provider request", async () => {
    let observedMaxRetries: number | undefined;
    const provider = {
      name: "stub",
      requiresApiKey: false,
      tokenMultiplier: 1.0,
      async complete(req: CompletionRequest): Promise<CompletionResponse> {
        observedMaxRetries = req.maxRetries;
        return { text: "revised", usage: {}, model: req.model, provider: "stub" };
      },
    };

    const input: PipelineInput = {
      content: TEST_CHAPTER,
      versionContent: "1",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: { ...TEST_SETTINGS, maxRetries: 5 },
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => provider,
    };

    await runPipeline(input);
    expect(observedMaxRetries).toBe(5);
  });

  it("emits a ProgressEvent('retry', ...) when the provider invokes onRetry", async () => {
    // The provider simulates the inner withRetry: invokes onRetry then returns
    // success on the same call (the mock represents the wrapped result).
    const provider = {
      name: "retrying",
      requiresApiKey: false,
      tokenMultiplier: 1.0,
      async complete(req: CompletionRequest): Promise<CompletionResponse> {
        req.onRetry?.({ attempt: 2, waitMs: 100, reason: "HTTP 429" });
        return { text: "revised", usage: {}, model: req.model, provider: "retrying" };
      },
    };

    const events: ProgressEvent[] = [];
    const input: PipelineInput = {
      content: TEST_CHAPTER,
      versionContent: "1",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: TEST_SETTINGS,
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => provider,
      onProgress: (e) => events.push(e),
    };

    await runPipeline(input);

    const retryEvents = events.filter((e) => e.type === "retry");
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toMatchObject({
      type: "retry",
      attempt: 2,
      waitMs: 100,
      reason: "HTTP 429",
      current: 1,
      total: 1,
    });
  });
});
