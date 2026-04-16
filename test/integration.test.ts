/**
 * PENNY - Integration Test
 *
 * Tests the core processing pipeline (runPipeline) end-to-end
 * with a mock LLM provider. Verifies:
 *   - Annotations are parsed and processed
 *   - Output has REVISED markers and annotations removed
 *   - Version number increments correctly
 *   - State tracks processed annotation hashes
 *   - Review note contains correct data
 *   - Idempotency: second run on same content produces no changes
 */

import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline";
import type { PipelineInput, PipelineResult } from "../src/pipeline";
import type { PennySettings } from "../src/types";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../src/types";
import type { ContextFiles } from "../src/context";
import type { CompletionRequest, CompletionResponse } from "../src/providers/service";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_CHAPTER = `---
type: chapter
book: 1
chapter: 5
title: The Discovery
pov: protagonist
status: draft
wordcount: 100
focus: protagonist + tim
thread: mystery
act: 2
---

# Book 1, Chapter 5

## Scene Summary
> She investigates the anomaly with Tim.

---

<!-- Prose begins below -->

The lab was quiet at 3am. She stared at the screen.
%% REWRITE: More sensory detail - sounds, smells, the hum of equipment %%

"I don't understand what I'm seeing," she said to Rabbit.

%% EXPAND: Add more dialogue here. Show her working through the problem out loud. %%

The data made no sense.

%% NOTE: Come back to this scene after writing chapter 6. %%

%% RESEARCH: Is the technical description accurate? %%

"I think I've found it," she said.
`;

const TEST_STYLE_GUIDE = `# Style Guide
First person. Past tense. Short sentences.`;

const TEST_VOICE_TESTS = `# Voice Tests
## Protagonist Solo (with Rabbit)
"Okay, Rabbit. Here's the thing about garbage collection."
## Protagonist with Tim
"You need to eat something that isn't coffee."
`;

const TEST_SETTINGS: PennySettings = {
  ...DEFAULT_SETTINGS,
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT,
  proseMarker: "<!-- Prose begins below -->",
};

function makeContextFiles(chapter: string): ContextFiles {
  return {
    chapter,
    voiceTests: TEST_VOICE_TESTS,
    styleGuide: TEST_STYLE_GUIDE,
    outline: "",
    characters: [],
    wiki: [],
    seriesBible: "",
    themes: "",
  };
}

/**
 * Create a mock provider that returns predetermined text for each call.
 * Calls are answered in order from the responses array.
 */
function createMockProvider(responses: string[]) {
  let callIndex = 0;
  const calls: CompletionRequest[] = [];

  return {
    provider: {
      name: "mock",
      requiresApiKey: false,
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        calls.push(request);
        const text = responses[callIndex] ?? `[mock response ${callIndex}]`;
        callIndex++;
        return {
          text,
          model: request.model,
          provider: "mock",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
      estimateTokens(text: string): number {
        return text.split(/\s+/).length;
      },
      async getModels() {
        return [];
      },
      async testConnection() {
        return null;
      },
    },
    getCalls: () => calls,
  };
}

function makePipelineInput(
  content: string,
  versionContent: string,
  stateContent: string,
  mockProvider: ReturnType<typeof createMockProvider>,
): PipelineInput {
  return {
    content,
    versionContent,
    stateContent,
    contextFiles: makeContextFiles(content),
    settings: TEST_SETTINGS,
    chapterId: "ch-05",
    bookId: "book-1",
    getProvider: (name: string) => {
      // Return the mock provider for any provider name
      return mockProvider.provider;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPipeline (integration)", () => {
  it("processes multiple annotation types and produces a versioned output", async () => {
    const mock = createMockProvider([
      // Response for REWRITE annotation
      "The lab hummed at 3am. The fluorescent lights buzzed overhead, casting everything in that flat institutional glow. The screen threw blue light across my face. Somewhere a fan clicked. The building smelled like old carpet and ozone.",
      // Response for EXPAND annotation
      '"I don\'t understand what I\'m seeing," I said to Rabbit.\n\n"The numbers keep shifting. Every time I think I\'ve got the pattern, it moves. Like it knows I\'m watching."\n\nI pulled my coffee closer. Chairman Meow stretched across the keyboard.\n\n"That\'s not helping," I told him. He didn\'t care.',
    ]);

    const input = makePipelineInput(TEST_CHAPTER, "1", "", mock);
    const result = await runPipeline(input);

    expect(result).not.toBeNull();
    const r = result as PipelineResult;

    // Version should increment
    expect(r.newVersion).toBe(2);

    // Should have processed 2 actionable annotations (REWRITE + EXPAND)
    expect(r.annotationsProcessed).toBe(2);

    // Passthrough annotations (NOTE + RESEARCH) should be counted as skipped
    expect(r.annotationsSkipped).toBe(2);

    // Tags should be tracked
    expect(r.tags).toContain("REWRITE");
    expect(r.tags).toContain("EXPAND");

    // No errors expected
    expect(r.hadErrors).toBe(false);

    // The new content should contain REVISED markers
    expect(r.newContent).toContain("REVISED(v2)");
    expect(r.newContent).toContain("[REWRITE]");
    expect(r.newContent).toContain("[EXPAND]");

    // The new content should NOT contain the original actionable annotations
    expect(r.newContent).not.toContain("%% REWRITE:");
    expect(r.newContent).not.toContain("%% EXPAND:");

    // The passthrough annotations should be preserved
    expect(r.newContent).toContain("%% NOTE:");
    expect(r.newContent).toContain("%% RESEARCH:");

    // The revised text should be in the output
    expect(r.newContent).toContain("fluorescent lights buzzed");
    expect(r.newContent).toContain("Chairman Meow stretched");

    // The mock provider should have been called twice
    expect(mock.getCalls()).toHaveLength(2);

    // State JSON should track the processed annotations
    const state = JSON.parse(r.stateJson);
    expect(state.version).toBe(2);
    expect(state.processedAnnotations).toHaveLength(2);
    expect(state.processedAnnotations[0].tag).toBeDefined();
    expect(state.processedAnnotations[0].hash).toBeDefined();

    // Review content should be valid markdown
    expect(r.reviewContent).toContain("# ch-05 Review -- v2");
    expect(r.reviewContent).toContain("**Annotations processed:** 2");
    expect(r.reviewContent).toContain("**Annotations skipped (NOTE/RESEARCH):** 2");
    expect(r.reviewContent).toContain("## Changes Made");
    expect(r.reviewContent).toContain("[REWRITE]");
    expect(r.reviewContent).toContain("[EXPAND]");
    expect(r.reviewContent).toContain("## Voice Compliance");
    expect(r.reviewContent).toContain("## Word Count");

    // Log line should be valid JSONL
    const logEntry = JSON.parse(r.logLine.trim());
    expect(logEntry.book).toBe("book-1");
    expect(logEntry.chapter).toBe("ch-05");
    expect(logEntry.versionFrom).toBe(1);
    expect(logEntry.versionTo).toBe(2);
    expect(logEntry.annotationsProcessed).toBe(2);
  });

  it("returns null when there are no actionable annotations", async () => {
    const contentNoAnnotations = `---
type: chapter
book: 1
chapter: 3
---

# Chapter 3

Some prose without any annotations.

%% NOTE: Just a note %%
%% RESEARCH: Something to look up %%
`;

    const mock = createMockProvider([]);
    const input = makePipelineInput(contentNoAnnotations, "1", "", mock);
    const result = await runPipeline(input);

    expect(result).toBeNull();
    // Provider should never be called
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("is idempotent: second run with same state skips already-processed annotations", async () => {
    const mock1 = createMockProvider([
      "Revised lab scene.",
      "Revised dialogue scene.",
    ]);

    // First run
    const input1 = makePipelineInput(TEST_CHAPTER, "1", "", mock1);
    const result1 = await runPipeline(input1);
    expect(result1).not.toBeNull();
    expect(result1!.annotationsProcessed).toBe(2);

    // Second run with the state from the first run
    const mock2 = createMockProvider([]);
    const input2 = makePipelineInput(TEST_CHAPTER, "2", result1!.stateJson, mock2);
    const result2 = await runPipeline(input2);

    // Should return null -- nothing new to process
    expect(result2).toBeNull();
    // Provider should not have been called
    expect(mock2.getCalls()).toHaveLength(0);
  });

  it("handles provider errors gracefully with AGENT-ERROR markers", async () => {
    // First call succeeds, second call throws
    let callCount = 0;
    const failingProvider = {
      name: "failing",
      requiresApiKey: false,
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        callCount++;
        if (callCount === 2) {
          throw new Error("Rate limit exceeded");
        }
        return {
          text: "Revised text for first annotation.",
          model: request.model,
          provider: "failing",
        };
      },
      estimateTokens(text: string) {
        return text.split(/\s+/).length;
      },
      async getModels() {
        return [];
      },
      async testConnection() {
        return null;
      },
    };

    const input: PipelineInput = {
      content: TEST_CHAPTER,
      versionContent: "1",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: TEST_SETTINGS,
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => failingProvider,
    };

    const result = await runPipeline(input);

    expect(result).not.toBeNull();
    const r = result as PipelineResult;

    // Should still produce output (not throw)
    expect(r.newVersion).toBe(2);
    expect(r.hadErrors).toBe(true);

    // The output should contain the AGENT-ERROR marker for the failed annotation
    expect(r.newContent).toContain("AGENT-ERROR");
    expect(r.newContent).toContain("Rate limit exceeded");

    // The review should flag the error
    expect(r.reviewContent).toContain("error");

    // Only 1 annotation should be counted as successfully processed
    expect(r.annotationsProcessed).toBe(1);
  });

  it("handles missing provider gracefully", async () => {
    const input: PipelineInput = {
      content: TEST_CHAPTER,
      versionContent: "0",
      stateContent: "",
      contextFiles: makeContextFiles(TEST_CHAPTER),
      settings: TEST_SETTINGS,
      chapterId: "ch-05",
      bookId: "book-1",
      getProvider: () => undefined, // No provider available
    };

    const result = await runPipeline(input);

    expect(result).not.toBeNull();
    const r = result as PipelineResult;

    expect(r.hadErrors).toBe(true);
    expect(r.newContent).toContain("AGENT-ERROR");
    expect(r.newContent).toContain("not available");
    // No annotations should be counted as successfully processed
    expect(r.annotationsProcessed).toBe(0);
  });

  it("updates frontmatter with agent fields", async () => {
    const mock = createMockProvider([
      "Revised first passage.",
      "Revised second passage.",
    ]);

    const input = makePipelineInput(TEST_CHAPTER, "1", "", mock);
    const result = await runPipeline(input);

    expect(result).not.toBeNull();
    const r = result as PipelineResult;

    // Check frontmatter fields in the output
    expect(r.newContent).toContain("agent_version: 2");
    expect(r.newContent).toContain("agent_last_revised:");
    expect(r.newContent).toContain("wordcount:");
  });

  it("builds prompts with context from provided files", async () => {
    const mock = createMockProvider(["Revised passage."]);

    // Use a chapter with a single annotation for simpler verification
    const simpleChapter = `---
type: chapter
book: 1
chapter: 1
focus: tim
---

# Chapter 1

<!-- Prose begins below -->

She walked in.
%% REWRITE: Add sensory detail %%
`;

    const input: PipelineInput = {
      content: simpleChapter,
      versionContent: "0",
      stateContent: "",
      contextFiles: {
        chapter: simpleChapter,
        voiceTests: TEST_VOICE_TESTS,
        styleGuide: TEST_STYLE_GUIDE,
        outline: "Plot outline here.",
        characters: ["Tim character sheet."],
        wiki: [],
      },
      settings: TEST_SETTINGS,
      chapterId: "ch-01",
      bookId: "book-1",
      getProvider: () => mock.provider,
    };

    const result = await runPipeline(input);
    expect(result).not.toBeNull();

    // Verify the prompt sent to the provider contained context
    const calls = mock.getCalls();
    expect(calls).toHaveLength(1);

    const call = calls[0];
    // System prompt should contain context from files
    expect(call.systemPrompt).toContain("Style Guide");
    expect(call.systemPrompt).toContain("First person. Past tense.");

    // User prompt should contain the task details
    expect(call.userPrompt).toContain("REWRITE");
    expect(call.userPrompt).toContain("Add sensory detail");
    expect(call.userPrompt).toContain("She walked in.");

    // System prompt should NOT have the task/passage/instruction
    // (those were removed from the template -- LOW-2 fix)
    expect(call.systemPrompt).not.toContain("Passage to Revise");
    expect(call.systemPrompt).not.toContain("Author's Instruction");
  });

  it("starts from version 0 when no .version file exists", async () => {
    const mock = createMockProvider(["Revised."]);

    const simpleChapter = `---
type: chapter
book: 1
chapter: 1
---

She walked in.
%% REWRITE: Fix this %%
`;

    const input = makePipelineInput(simpleChapter, "", "", mock);
    const result = await runPipeline(input);

    expect(result).not.toBeNull();
    // readVersion("") returns 0, so nextVersion should be 1
    expect(result!.newVersion).toBe(1);
  });
});
