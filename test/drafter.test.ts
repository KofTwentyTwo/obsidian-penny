import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/drafter";
import type { AssembledContext, AnnotatedSection } from "../src/types";
import { DEFAULT_SYSTEM_PROMPT } from "../src/types";

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    chapter: "Full chapter text here.",
    voiceTests: "Voice test examples.",
    styleGuide: "First person, past tense.",
    outline: "Chapter outline content.",
    characters: "Tim: theater kid, dry humor.",
    wiki: "Rabbit: taxidermied rabbit on desk.",
    seriesBible: "Series bible content.",
    themes: "Themes content.",
    voiceRules: "No internal monologue. No self-aware humor.",
    totalTokenEstimate: 5000,
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<AnnotatedSection> = {}): AnnotatedSection {
  return {
    tag: "REWRITE",
    instruction: "add more tension to this scene",
    originalText: "She walked into the room.",
    lineStart: 10,
    lineEnd: 12,
    scope: "paragraph",
    actionable: true,
    hash: "abc123def456",
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("replaces all context placeholders in the template", () => {
    const context = makeContext();
    const annotation = makeAnnotation();

    const { system } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);

    expect(system).toContain("Full chapter text here.");
    expect(system).toContain("Voice test examples.");
    expect(system).toContain("First person, past tense.");
    expect(system).toContain("Chapter outline content.");
    expect(system).toContain("Tim: theater kid, dry humor.");
    expect(system).toContain("Rabbit: taxidermied rabbit on desk.");
    expect(system).toContain("No internal monologue.");
  });

  it("puts annotation-level details in the user prompt, not the system prompt", () => {
    const context = makeContext();
    const annotation = makeAnnotation({
      tag: "EXPAND",
      instruction: "add sensory detail",
      originalText: "The room was dark.",
      lineStart: 15,
      lineEnd: 17,
    });

    const { system, user } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);

    // Task details should be in the user prompt
    expect(user).toContain("Task: EXPAND");
    expect(user).toContain("Lines 15-17");
    expect(user).toContain("The room was dark.");
    expect(user).toContain("add sensory detail");

    // System prompt should NOT duplicate the task/passage/instruction sections
    expect(system).not.toContain("Task: EXPAND");
    expect(system).not.toContain("Passage to Revise");
    expect(system).not.toContain("Author's Instruction");
  });

  it("builds a user prompt with the task details", () => {
    const context = makeContext();
    const annotation = makeAnnotation();

    const { user } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);

    expect(user).toContain("Task: REWRITE");
    expect(user).toContain("She walked into the room.");
    expect(user).toContain("add more tension to this scene");
    expect(user).toContain("Output ONLY the replacement text");
  });

  it("omits sections where context is empty", () => {
    const context = makeContext({
      voiceTests: "",
      outline: "",
      wiki: "",
      seriesBible: "",
      themes: "",
    });
    const annotation = makeAnnotation();

    const { system } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);

    // Should not contain the empty-value headings.
    // The chapter and style guide should still be there.
    expect(system).toContain("Full chapter text here.");
    expect(system).toContain("First person, past tense.");
    // Empty sections should not leave their headings.
    expect(system).not.toContain("{voice_tests}");
    expect(system).not.toContain("{outline}");
    expect(system).not.toContain("{wiki}");
  });

  it("handles a fully minimal context", () => {
    const context = makeContext({
      chapter: "Minimal chapter.",
      voiceTests: "",
      styleGuide: "",
      outline: "",
      characters: "",
      wiki: "",
      seriesBible: "",
      themes: "",
      voiceRules: "",
    });
    const annotation = makeAnnotation();

    const { system, user } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);

    expect(system).toContain("Minimal chapter.");
    expect(user).toContain("REWRITE");
  });

  it("works with a custom template", () => {
    const customTemplate = [
      "Custom PENNY prompt.",
      "Voice: {voice_rules}",
      "Chapter: {chapter}",
      "Do: {tag} on lines {lineStart}-{lineEnd}",
      "Passage: {passage}",
      "Instruction: {instruction}",
    ].join("\n");

    const context = makeContext({
      chapter: "My chapter.",
      voiceRules: "Be vivid.",
    });
    const annotation = makeAnnotation({
      tag: "TONE",
      instruction: "warmer",
      originalText: "Cold text.",
      lineStart: 3,
      lineEnd: 5,
    });

    const { system } = buildPrompt(context, annotation, customTemplate);

    expect(system).toContain("Custom PENNY prompt.");
    expect(system).toContain("Voice: Be vivid.");
    expect(system).toContain("Chapter: My chapter.");
    expect(system).toContain("Do: TONE on lines 3-5");
    expect(system).toContain("Passage: Cold text.");
    expect(system).toContain("Instruction: warmer");
  });

  it("does not leave triple+ blank lines", () => {
    const context = makeContext({
      voiceTests: "",
      outline: "",
      characters: "",
      wiki: "",
    });
    const annotation = makeAnnotation();

    const { system } = buildPrompt(context, annotation, DEFAULT_SYSTEM_PROMPT);
    expect(system).not.toMatch(/\n\n\n/);
  });
});

// NOTE: parseApiResponse tests have been moved to test/providers/anthropic.test.ts
// and test/providers/ollama.test.ts since response parsing is now provider-specific.
