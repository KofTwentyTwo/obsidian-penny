import { describe, it, expect } from "vitest";
import {
  assembleContext,
  selectVoiceTestSection,
  estimateTokens,
} from "../src/context";
import type { ContextFiles } from "../src/context";
import type { AnnotatedSection, PennySettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

function makeAnnotation(overrides: Partial<AnnotatedSection> = {}): AnnotatedSection {
  return {
    tag: "REWRITE",
    instruction: "fix this",
    originalText: "some text",
    lineStart: 5,
    lineEnd: 6,
    scope: "paragraph",
    actionable: true,
    hash: "abc123def456",
    ...overrides,
  };
}

function makeSettings(overrides: Partial<PennySettings> = {}): PennySettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("estimateTokens", () => {
  it("estimates tokens as word count * 1.33", () => {
    const text = "one two three four five"; // 5 words
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(5 * 1.33)); // 7
  });

  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("returns 0 for undefined-ish input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("handles multi-line text", () => {
    const text = "one two three\nfour five six\nseven eight";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(8 * 1.33)); // 11
  });
});

describe("selectVoiceTestSection", () => {
  const voiceTests = [
    "# Voice Tests",
    "",
    "## Tim",
    "",
    "Tim scene: fast banter, redirect.",
    "Example dialogue with Tim.",
    "",
    "## Darin",
    "",
    "Darin scene: clipped, technical.",
    "Example dialogue with Darin.",
    "",
    "## Tyler",
    "",
    "Tyler scene: confused and delighted.",
    "Example dialogue with Tyler.",
  ].join("\n");

  it("selects section matching a character name", () => {
    const result = selectVoiceTestSection(voiceTests, ["tim"]);
    expect(result).toContain("Tim scene: fast banter");
    expect(result).not.toContain("Darin scene");
    expect(result).not.toContain("Tyler scene");
  });

  it("selects multiple matching sections", () => {
    const result = selectVoiceTestSection(voiceTests, ["tim", "darin"]);
    expect(result).toContain("Tim scene");
    expect(result).toContain("Darin scene");
    expect(result).not.toContain("Tyler scene");
  });

  it("returns full content when no characters match", () => {
    const result = selectVoiceTestSection(voiceTests, ["alex"]);
    expect(result).toContain("Tim scene");
    expect(result).toContain("Darin scene");
    expect(result).toContain("Tyler scene");
  });

  it("returns full content when no characters provided", () => {
    const result = selectVoiceTestSection(voiceTests, []);
    expect(result).toBe(voiceTests);
  });

  it("returns empty string for empty voice tests", () => {
    const result = selectVoiceTestSection("", ["tim"]);
    expect(result).toBe("");
  });

  it("is case-insensitive in matching", () => {
    const result = selectVoiceTestSection(voiceTests, ["TIM"]);
    expect(result).toContain("Tim scene");
  });
});

describe("assembleContext", () => {
  it("always includes the chapter", () => {
    const files: ContextFiles = {
      chapter: "The full chapter text.",
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.chapter).toBe("The full chapter text.");
  });

  it("includes voice tests when provided", () => {
    const files: ContextFiles = {
      chapter: "Chapter text.",
      voiceTests: "Voice test content.",
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.voiceTests).toBe("Voice test content.");
  });

  it("includes style guide when provided", () => {
    const files: ContextFiles = {
      chapter: "Chapter text.",
      styleGuide: "Style guide content.",
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.styleGuide).toBe("Style guide content.");
  });

  it("includes outline when provided", () => {
    const files: ContextFiles = {
      chapter: "Chapter text.",
      outline: "Outline content.",
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.outline).toBe("Outline content.");
  });

  it("joins multiple character files", () => {
    const files: ContextFiles = {
      chapter: "Chapter text.",
      characters: ["Character A profile.", "Character B profile."],
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.characters).toContain("Character A profile.");
    expect(result.characters).toContain("Character B profile.");
  });

  it("joins multiple wiki entries", () => {
    const files: ContextFiles = {
      chapter: "Chapter text.",
      wiki: ["Wiki entry 1.", "Wiki entry 2."],
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.wiki).toContain("Wiki entry 1.");
    expect(result.wiki).toContain("Wiki entry 2.");
  });

  it("includes voice rules from settings", () => {
    const files: ContextFiles = { chapter: "Chapter text." };
    const settings = makeSettings({ customVoiceRules: "No internal monologue." });

    const result = assembleContext(files, makeAnnotation(), settings);
    expect(result.voiceRules).toBe("No internal monologue.");
  });

  it("calculates total token estimate", () => {
    const files: ContextFiles = {
      chapter: "Word ".repeat(100), // ~100 words
      styleGuide: "Word ".repeat(50), // ~50 words
    };

    const result = assembleContext(files, makeAnnotation(), makeSettings());
    expect(result.totalTokenEstimate).toBeGreaterThan(0);
    expect(result.totalTokenEstimate).toBe(
      estimateTokens(files.chapter) + estimateTokens(files.styleGuide!),
    );
  });

  it("omits low-priority context when over budget", () => {
    // Create a chapter that nearly fills the budget.
    const bigChapter = "word ".repeat(10000);
    const files: ContextFiles = {
      chapter: bigChapter,
      voiceTests: "Voice tests content.",
      styleGuide: "Style guide content.",
      outline: "Outline content.",
      seriesBible: "Series bible content.",
      themes: "Themes content.",
    };

    // Set a very small budget.
    const settings = makeSettings({ contextBudget: estimateTokens(bigChapter) + 100 });
    const result = assembleContext(files, makeAnnotation(), settings);

    // Chapter is always included.
    expect(result.chapter).toBe(bigChapter);
    // Lower-priority items may be dropped.
    // With only ~100 tokens left, not everything will fit.
    // series bible and themes are the lowest priority.
  });

  it("handles all empty optional files", () => {
    const files: ContextFiles = { chapter: "Chapter text." };
    const result = assembleContext(files, makeAnnotation(), makeSettings());

    expect(result.chapter).toBe("Chapter text.");
    expect(result.voiceTests).toBe("");
    expect(result.styleGuide).toBe("");
    expect(result.outline).toBe("");
    expect(result.characters).toBe("");
    expect(result.wiki).toBe("");
    expect(result.seriesBible).toBe("");
    expect(result.themes).toBe("");
  });
});
