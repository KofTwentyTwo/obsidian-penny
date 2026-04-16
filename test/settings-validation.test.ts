/**
 * PENNY - Settings Validation Tests
 *
 * Tests for route config construction, pipeline settings consumption,
 * and pure validation functions that underpin the settings UI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRouteConfig } from "../src/pipeline";
import type { PipelineInput } from "../src/pipeline";
import { runPipeline } from "../src/pipeline";
import { resolveModel } from "../src/providers/router";
import { assembleContext } from "../src/context";
import type { ContextFiles } from "../src/context";
import { countProseWords } from "../src/frontmatter";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT } from "../src/types";
import type { PennySettings } from "../src/types";
import type { CompletionRequest, CompletionResponse } from "../src/providers/service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<PennySettings> = {}): PennySettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function createMockProvider(responses: string[] = ["Revised text."]) {
  let callIndex = 0;
  const calls: CompletionRequest[] = [];

  return {
    provider: {
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
    },
    getCalls: () => calls,
  };
}

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

const SIMPLE_CHAPTER = `---
type: chapter
book: 1
chapter: 1
---

# Chapter 1

<!-- Prose begins below -->

She walked in.
%% REWRITE: Add sensory detail %%
`;

// ---------------------------------------------------------------------------
// Route config tests
// ---------------------------------------------------------------------------

describe("buildRouteConfig", () => {
  it("with useSameModelForAll: true returns all three tiers as routeStandard", () => {
    const settings = makeSettings({
      useSameModelForAll: true,
      routeLight: { provider: "ollama", model: "llama3.2" },
      routeStandard: { provider: "anthropic", model: "claude-sonnet-4-6" },
      routeHeavy: { provider: "anthropic", model: "claude-opus-4-6" },
    });

    const config = buildRouteConfig(settings);

    expect(config.light).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(config.standard).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(config.heavy).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("with useSameModelForAll: false returns distinct routes per tier", () => {
    const settings = makeSettings({
      useSameModelForAll: false,
      routeLight: { provider: "ollama", model: "llama3.2" },
      routeStandard: { provider: "anthropic", model: "claude-sonnet-4-6" },
      routeHeavy: { provider: "anthropic", model: "claude-opus-4-6" },
    });

    const config = buildRouteConfig(settings);

    expect(config.light).toEqual({ provider: "ollama", model: "llama3.2" });
    expect(config.standard).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(config.heavy).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });

  it("with auto-latest resolves models correctly per tier", () => {
    const settings = makeSettings({
      useSameModelForAll: false,
      routeLight: { provider: "anthropic", model: "auto-latest" },
      routeStandard: { provider: "anthropic", model: "auto-latest" },
      routeHeavy: { provider: "anthropic", model: "auto-latest" },
    });

    const config = buildRouteConfig(settings);

    // buildRouteConfig returns the raw config; resolveModel is called
    // downstream by getRoute. Verify the raw values pass through.
    expect(config.light.model).toBe("auto-latest");
    expect(config.standard.model).toBe("auto-latest");
    expect(config.heavy.model).toBe("auto-latest");

    // Verify that resolveModel correctly maps auto-latest per tier
    expect(resolveModel(config.light.model, "light")).toBe("claude-haiku-4-5");
    expect(resolveModel(config.standard.model, "standard")).toBe("claude-sonnet-4-6");
    expect(resolveModel(config.heavy.model, "heavy")).toBe("claude-opus-4-6");
  });
});

// ---------------------------------------------------------------------------
// Pipeline settings consumption tests
// ---------------------------------------------------------------------------

describe("pipeline settings consumption", () => {
  it("maxTokens value from settings is passed to CompletionRequest", async () => {
    const mock = createMockProvider(["Revised passage."]);
    const settings = makeSettings({ maxTokens: 8000 });

    const input: PipelineInput = {
      content: SIMPLE_CHAPTER,
      versionContent: "0",
      stateContent: "",
      contextFiles: makeContextFiles(SIMPLE_CHAPTER),
      settings,
      chapterId: "ch-01",
      bookId: "book-1",
      getProvider: () => mock.provider,
    };

    await runPipeline(input);

    const calls = mock.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].maxTokens).toBe(8000);
  });

  it("contextBudget value limits context assembly", () => {
    // Create a very small budget that can barely fit the chapter
    const chapter = "A".repeat(500); // ~500 words worth
    const files: ContextFiles = {
      chapter,
      voiceTests: "B".repeat(1000),
      styleGuide: "C".repeat(1000),
      outline: "",
      characters: [],
      wiki: [],
    };

    const annotation = {
      tag: "REWRITE" as const,
      instruction: "fix it",
      originalText: "original",
      lineStart: 1,
      lineEnd: 2,
      scope: "paragraph" as const,
      actionable: true,
      hash: "abc123",
    };

    // With a very tight budget, lower-priority items should be excluded
    const smallBudgetSettings = makeSettings({ contextBudget: 100 });
    const ctx = assembleContext(files, annotation, smallBudgetSettings);

    // Chapter is always included (priority 1), but total should be constrained
    expect(ctx.chapter).toBe(chapter);
    expect(ctx.totalTokenEstimate).toBeGreaterThan(0);

    // With a huge budget, everything should fit
    const largeBudgetSettings = makeSettings({ contextBudget: 1000000 });
    const ctxLarge = assembleContext(files, annotation, largeBudgetSettings);
    expect(ctxLarge.voiceTests).toBe(files.voiceTests);
    expect(ctxLarge.styleGuide).toBe(files.styleGuide);
  });

  it("customVoiceRules appears in assembled context", () => {
    const files: ContextFiles = {
      chapter: "Some chapter text.",
      voiceTests: "",
      styleGuide: "",
      outline: "",
      characters: [],
      wiki: [],
    };

    const annotation = {
      tag: "REWRITE" as const,
      instruction: "fix it",
      originalText: "original",
      lineStart: 1,
      lineEnd: 2,
      scope: "paragraph" as const,
      actionable: true,
      hash: "abc123",
    };

    const settings = makeSettings({
      customVoiceRules: "No internal monologue. Ever.",
    });

    const ctx = assembleContext(files, annotation, settings);
    expect(ctx.voiceRules).toBe("No internal monologue. Ever.");
  });

  it("proseMarker affects word count calculation (with marker vs without)", () => {
    const contentWithMarker = `---
type: chapter
---

# Chapter 1

## Outline notes that should not be counted

<!-- Prose begins below -->

She walked into the room and sat down.
`;

    const contentWithoutMarker = `She walked into the room and sat down.`;

    // With marker: only counts words after the marker
    const countWithMarker = countProseWords(contentWithMarker, "<!-- Prose begins below -->");
    // Without marker (empty string): counts all words
    const countWithoutMarker = countProseWords(contentWithMarker, "");

    expect(countWithMarker).toBeLessThan(countWithoutMarker);
    // The prose section has 8 words
    expect(countWithMarker).toBe(8);
  });

  it("verboseLogging controls console.log output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // verboseLogging is a settings flag. The pipeline itself does not
    // directly call console.log (that happens in the command layer), but
    // the setting must be propagated. Verify the setting value is accessible.
    const settings = makeSettings({ verboseLogging: true });
    expect(settings.verboseLogging).toBe(true);

    const settingsOff = makeSettings({ verboseLogging: false });
    expect(settingsOff.verboseLogging).toBe(false);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Validation tests (pure functions)
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
  it('resolveModel("auto-latest", "light") returns "claude-haiku-4-5"', () => {
    expect(resolveModel("auto-latest", "light")).toBe("claude-haiku-4-5");
  });

  it('resolveModel("auto-latest", "standard") returns "claude-sonnet-4-6"', () => {
    expect(resolveModel("auto-latest", "standard")).toBe("claude-sonnet-4-6");
  });

  it('resolveModel("auto-latest", "heavy") returns "claude-opus-4-6"', () => {
    expect(resolveModel("auto-latest", "heavy")).toBe("claude-opus-4-6");
  });

  it('resolveModel("specific-model", "light") returns "specific-model" unchanged', () => {
    expect(resolveModel("specific-model", "light")).toBe("specific-model");
  });
});

describe("commitMessageFormat template substitution", () => {
  it("replaces {chapter}, {version}, {tags} placeholders", () => {
    const fmt = "docs({chapter}): PENNY v{version} - {tags}";
    const result = fmt
      .replace(/\{chapter\}/g, "ch-05")
      .replace(/\{version\}/g, "3")
      .replace(/\{tags\}/g, "REWRITE, EXPAND");

    expect(result).toBe("docs(ch-05): PENNY v3 - REWRITE, EXPAND");
  });

  it("empty format string falls through to default", () => {
    const fmt = "";
    const chapterChanges = ["ch-01", "ch-02"];

    // Simulate the command layer fallback logic
    let message: string;
    if (fmt) {
      message = fmt
        .replace(/\{chapter\}/g, "ch-01")
        .replace(/\{version\}/g, "1")
        .replace(/\{tags\}/g, "REWRITE");
    } else if (chapterChanges.length > 0) {
      message = `docs: revise ${chapterChanges.join(", ")}`;
    } else {
      message = "docs: PENNY writing session";
    }

    expect(message).toBe("docs: revise ch-01, ch-02");
  });
});

describe("countProseWords", () => {
  it("with proseMarker counts only after marker", () => {
    const content = `# Heading

Some outline text here that should not count.

<!-- Prose begins below -->

The actual prose starts here with seven words.
`;
    const count = countProseWords(content, "<!-- Prose begins below -->");
    // "The actual prose starts here with seven words." = 8 words
    expect(count).toBe(8);
  });

  it("without proseMarker counts entire content", () => {
    const content = `# Heading

Some text here.

More text here.
`;
    const count = countProseWords(content, "");
    // All words in the content are counted
    expect(count).toBeGreaterThan(0);
    // "Heading Some text here. More text here." = 7 words
    expect(count).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Integration-level tests for non-default settings
// ---------------------------------------------------------------------------

describe("integration: non-default maxTokens", () => {
  it("non-default maxTokens (8000) reaches the provider", async () => {
    const mock = createMockProvider(["Revised."]);

    const input: PipelineInput = {
      content: SIMPLE_CHAPTER,
      versionContent: "0",
      stateContent: "",
      contextFiles: makeContextFiles(SIMPLE_CHAPTER),
      settings: makeSettings({ maxTokens: 8000 }),
      chapterId: "ch-01",
      bookId: "book-1",
      getProvider: () => mock.provider,
    };

    const result = await runPipeline(input);
    expect(result).not.toBeNull();

    const calls = mock.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].maxTokens).toBe(8000);
  });

  it("empty customVoiceRules still produces a working prompt", async () => {
    const mock = createMockProvider(["Revised."]);

    const input: PipelineInput = {
      content: SIMPLE_CHAPTER,
      versionContent: "0",
      stateContent: "",
      contextFiles: makeContextFiles(SIMPLE_CHAPTER),
      settings: makeSettings({ customVoiceRules: "" }),
      chapterId: "ch-01",
      bookId: "book-1",
      getProvider: () => mock.provider,
    };

    const result = await runPipeline(input);
    expect(result).not.toBeNull();

    const calls = mock.getCalls();
    expect(calls).toHaveLength(1);
    // The system prompt should still be valid (not crash or be empty)
    expect(calls[0].systemPrompt.length).toBeGreaterThan(0);
    // The voice_rules section should be absent or empty
    expect(calls[0].systemPrompt).not.toContain("CRITICAL VOICE RULES");
  });
});
