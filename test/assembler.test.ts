import { describe, it, expect } from "vitest";
import { assembleNewVersion } from "../src/assembler";
import type { AnnotatedSection } from "../src/types";

function makeAnnotation(overrides: Partial<AnnotatedSection> = {}): AnnotatedSection {
  return {
    tag: "REWRITE",
    instruction: "fix this passage",
    originalText: "Original text here.",
    lineStart: 0,
    lineEnd: 0,
    scope: "paragraph",
    actionable: true,
    hash: "abc123def456",
    ...overrides,
  };
}

describe("assembleNewVersion", () => {
  describe("basic replacement", () => {
    it("replaces annotated lines with revised text", () => {
      const original = [
        "First paragraph.",
        "%% REWRITE: fix this %%",
        "",
        "Third paragraph.",
      ].join("\n");

      const annotation = makeAnnotation({
        lineStart: 0,
        lineEnd: 1,
        scope: "paragraph",
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Better first paragraph." },
      ], 2);

      expect(result).toContain("Better first paragraph.");
      expect(result).not.toContain("First paragraph.");
    });

    it("inserts REVISED markers", () => {
      const original = [
        "Some text.",
        "%% REWRITE: improve %%",
      ].join("\n");

      const annotation = makeAnnotation({
        lineStart: 0,
        lineEnd: 1,
        instruction: "improve",
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Improved text." },
      ], 3);

      expect(result).toContain("%% REVISED(v3):");
      expect(result).toContain("[REWRITE]");
      expect(result).toContain('"improve"');
      expect(result).toMatch(/\d+ words -> \d+ words/);
    });
  });

  describe("bottom-up processing", () => {
    it("processes multiple revisions without corrupting line numbers", () => {
      const original = [
        "Para one.",          // 0
        "%% REWRITE: fix %%", // 1
        "",                   // 2
        "Para two.",          // 3
        "%% EXPAND: more %%", // 4
      ].join("\n");

      const anno1 = makeAnnotation({
        tag: "REWRITE",
        instruction: "fix",
        lineStart: 0,
        lineEnd: 1,
      });

      const anno2 = makeAnnotation({
        tag: "EXPAND",
        instruction: "more",
        lineStart: 3,
        lineEnd: 4,
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation: anno1, revisedText: "Fixed para one." },
        { annotation: anno2, revisedText: "Expanded para two with more detail." },
      ], 2);

      expect(result).toContain("Fixed para one.");
      expect(result).toContain("Expanded para two with more detail.");
      expect(result).not.toContain("Para one.");
      expect(result).not.toContain("Para two.");
    });
  });

  describe("annotation removal", () => {
    it("removes processed actionable annotations", () => {
      const original = [
        "Text here.",
        "%% REWRITE: fix this %%",
      ].join("\n");

      const annotation = makeAnnotation({ lineStart: 0, lineEnd: 1 });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Better text." },
      ], 2);

      expect(result).not.toContain("%% REWRITE:");
    });

    it("keeps NOTE annotations", () => {
      const original = [
        "Text here.",
        "%% NOTE: remember this for later %%",
        "",
        "More text.",
        "%% REWRITE: fix this %%",
      ].join("\n");

      const annotation = makeAnnotation({
        lineStart: 3,
        lineEnd: 4,
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Fixed text." },
      ], 2);

      expect(result).toContain("%% NOTE: remember this for later %%");
    });

    it("keeps RESEARCH annotations", () => {
      const original = [
        "The battle happened in 1863.",
        "%% RESEARCH: verify this date %%",
        "",
        "Another paragraph.",
        "%% REWRITE: redo %%",
      ].join("\n");

      const annotation = makeAnnotation({
        lineStart: 3,
        lineEnd: 4,
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Revised paragraph." },
      ], 2);

      expect(result).toContain("%% RESEARCH: verify this date %%");
    });
  });

  describe("edge cases", () => {
    it("handles empty revisions array", () => {
      const original = "Some text.\n%% NOTE: keep this %%";
      const { content: result } = assembleNewVersion(original, [], 2);
      expect(result).toContain("Some text.");
      expect(result).toContain("%% NOTE: keep this %%");
    });

    it("handles revision that produces multi-line text", () => {
      const original = [
        "Short paragraph.",
        "%% EXPAND: add detail %%",
      ].join("\n");

      const annotation = makeAnnotation({ lineStart: 0, lineEnd: 1 });
      const revisedText = "First expanded line.\n\nSecond expanded line.\n\nThird expanded line.";

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText },
      ], 2);

      expect(result).toContain("First expanded line.");
      expect(result).toContain("Second expanded line.");
      expect(result).toContain("Third expanded line.");
    });

    it("skips passthrough tags in revisions (defensive)", () => {
      const original = "Text.\n%% NOTE: a note %%";
      const annotation = makeAnnotation({
        tag: "NOTE",
        lineStart: 0,
        lineEnd: 1,
        actionable: false,
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Should not replace." },
      ], 2);

      // NOTE should not be replaced.
      expect(result).toContain("Text.");
      expect(result).toContain("%% NOTE: a note %%");
    });

    it("truncates long instructions in the REVISED marker", () => {
      const longInstruction = "a".repeat(100);
      const original = "Text.\n%% REWRITE: " + longInstruction + " %%";
      const annotation = makeAnnotation({
        lineStart: 0,
        lineEnd: 1,
        instruction: longInstruction,
      });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "New text." },
      ], 2);

      // Should be truncated to 60 chars with "..."
      const revisedLine = result.split("\n").find((l) => l.includes("REVISED"));
      expect(revisedLine).toBeDefined();
      expect(revisedLine!.length).toBeLessThan(200);
      expect(revisedLine).toContain("...");
    });
  });

  describe("version numbering in markers", () => {
    it("uses the provided version number", () => {
      const original = "Text.\n%% REWRITE: fix %%";
      const annotation = makeAnnotation({ lineStart: 0, lineEnd: 1 });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Fixed." },
      ], 7);

      expect(result).toContain("REVISED(v7)");
    });

    it("defaults to v1 when version is not provided", () => {
      const original = "Text.\n%% REWRITE: fix %%";
      const annotation = makeAnnotation({ lineStart: 0, lineEnd: 1 });

      const { content: result } = assembleNewVersion(original, [
        { annotation, revisedText: "Fixed." },
      ]);

      expect(result).toContain("REVISED(v1)");
    });
  });
});
