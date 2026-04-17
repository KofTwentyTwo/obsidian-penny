import { describe, it, expect } from "vitest";
import { parseAnnotations } from "../src/parser";

describe("parseAnnotations", () => {
  describe("basic annotation types", () => {
    it("parses a REWRITE annotation", () => {
      const content = [
        "Some paragraph text here.",
        "%% REWRITE: make this more vivid %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("REWRITE");
      expect(result[0].instruction).toBe("make this more vivid");
      expect(result[0].actionable).toBe(true);
      expect(result[0].scope).toBe("paragraph");
    });

    it("parses an EXPAND annotation", () => {
      const content = [
        "She walked into the room.",
        "%% EXPAND: add more sensory detail %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("EXPAND");
      expect(result[0].instruction).toBe("add more sensory detail");
    });

    it("parses a CUT annotation", () => {
      const content = [
        "A very long paragraph that goes on and on.",
        "%% CUT: trim to essentials %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("CUT");
    });

    it("parses TONE, DIALOG, PLOT, PACING, CHARACTER tags", () => {
      const tags = ["TONE", "DIALOG", "PLOT", "PACING", "CHARACTER"];
      for (const tag of tags) {
        const content = `Some text.\n%% ${tag}: fix this %%`;
        const result = parseAnnotations(content);
        expect(result).toHaveLength(1);
        expect(result[0].tag).toBe(tag);
        expect(result[0].actionable).toBe(true);
      }
    });
  });

  describe("passthrough tags", () => {
    it("parses NOTE as non-actionable", () => {
      const content = [
        "Some paragraph.",
        "%% NOTE: remember to check this later %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("NOTE");
      expect(result[0].actionable).toBe(false);
    });

    it("parses RESEARCH as non-actionable", () => {
      const content = [
        "The bridge was built in 1842.",
        "%% RESEARCH: verify this date %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("RESEARCH");
      expect(result[0].actionable).toBe(false);
    });
  });

  describe("scope detection", () => {
    it("detects inline scope when annotation is on the same line as text", () => {
      const content = 'She said "hello" to him. %% TONE: too flat %%';

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("inline");
      expect(result[0].lineStart).toBe(0);
      expect(result[0].lineEnd).toBe(0);
    });

    it("detects paragraph scope when annotation is on its own line after text", () => {
      const content = [
        "First sentence of the paragraph.",
        "Second sentence continues here.",
        "%% REWRITE: needs more tension %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("paragraph");
      expect(result[0].lineStart).toBe(0);
      expect(result[0].lineEnd).toBe(2);
    });

    it("detects section scope when annotation follows a heading", () => {
      const content = [
        "## Scene One",
        "%% REWRITE: this entire scene needs work %%",
        "",
        "She walked into the bar.",
        "The lights were dim.",
        "",
        "## Scene Two",
        "Something else happens.",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("section");
      expect(result[0].lineStart).toBe(0);
      // Should extend to just before "## Scene Two"
      expect(result[0].lineEnd).toBe(5);
    });

    it("section scope extends to end of file if no next heading", () => {
      const content = [
        "## Final Scene",
        "%% EXPAND: add more here %%",
        "",
        "Last paragraph.",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("section");
      expect(result[0].lineEnd).toBe(3);
    });

    it("section scope respects heading hierarchy (stops at equal level)", () => {
      const content = [
        "## Act One",
        "%% PACING: too slow %%",
        "",
        "### Scene 1a",
        "Text here.",
        "",
        "### Scene 1b",
        "More text.",
        "",
        "## Act Two",
        "Different act.",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("section");
      // Should stop before ## Act Two (line 9)
      expect(result[0].lineEnd).toBe(8);
    });
  });

  describe("hash generation", () => {
    it("generates a 12-character hex hash", () => {
      const content = "Some text.\n%% REWRITE: fix this %%";
      const result = parseAnnotations(content);
      expect(result[0].hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("generates consistent hashes for the same input", () => {
      const content = "Some text.\n%% REWRITE: fix this %%";
      const r1 = parseAnnotations(content);
      const r2 = parseAnnotations(content);
      expect(r1[0].hash).toBe(r2[0].hash);
    });

    it("generates different hashes for different annotations", () => {
      const c1 = "Text A.\n%% REWRITE: fix this %%";
      const c2 = "Text B.\n%% REWRITE: fix this %%";
      const r1 = parseAnnotations(c1);
      const r2 = parseAnnotations(c2);
      expect(r1[0].hash).not.toBe(r2[0].hash);
    });
  });

  describe("multiple annotations", () => {
    it("parses multiple annotations in the same file", () => {
      const content = [
        "First paragraph.",
        "%% REWRITE: fix this %%",
        "",
        "Second paragraph.",
        "%% EXPAND: add detail %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(2);
      expect(result[0].tag).toBe("REWRITE");
      expect(result[1].tag).toBe("EXPAND");
    });

    it("parses multiple annotations on the same line", () => {
      const content = "She ran fast. %% TONE: too flat %% %% REWRITE: more vivid %%";

      const result = parseAnnotations(content);
      expect(result).toHaveLength(2);
      expect(result[0].tag).toBe("TONE");
      expect(result[1].tag).toBe("REWRITE");
    });

    it("returns annotations sorted by lineStart", () => {
      const content = [
        "Paragraph one.",
        "%% EXPAND: add stuff %%",
        "",
        "Paragraph two.",
        "%% REWRITE: redo this %%",
        "",
        "Paragraph three.",
        "%% CUT: trim %%",
      ].join("\n");

      const result = parseAnnotations(content);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].lineStart).toBeGreaterThanOrEqual(result[i - 1].lineStart);
      }
    });
  });

  describe("malformed annotations", () => {
    it("skips annotations with unrecognized tags", () => {
      const content = "Some text.\n%% BANANA: not a real tag %%";
      const result = parseAnnotations(content);
      expect(result).toHaveLength(0);
    });

    it("skips annotations with empty instructions", () => {
      const content = "Some text.\n%% REWRITE: %%";
      const result = parseAnnotations(content);
      expect(result).toHaveLength(0);
    });

    it("does not throw on malformed input", () => {
      const badInputs = [
        "%% %%",
        "%% : %%",
        "%%REWRITE: no space%%",
        "%% REWRITE no colon %%",
        "just plain text",
        "",
        "%%",
        "%% REWRITE: incomplete",
      ];
      for (const input of badInputs) {
        expect(() => parseAnnotations(input)).not.toThrow();
      }
    });

    it("handles file with no annotations", () => {
      const content = "Just a normal chapter with no annotations at all.";
      const result = parseAnnotations(content);
      expect(result).toHaveLength(0);
    });

    it("handles empty string input", () => {
      const result = parseAnnotations("");
      expect(result).toHaveLength(0);
    });
  });

  describe("original text extraction", () => {
    it("extracts paragraph text for paragraph scope", () => {
      const content = [
        "She walked into the room and sat down.",
        "%% REWRITE: more atmosphere %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result[0].originalText).toContain("She walked into the room");
    });

    it("extracts inline text minus the annotation", () => {
      const content = "The coffee was good. %% TONE: too bland %%";
      const result = parseAnnotations(content);
      expect(result[0].originalText).toBe("The coffee was good.");
    });

    it("extracts section text including sub-content", () => {
      const content = [
        "## The Bar",
        "%% REWRITE: whole scene %%",
        "",
        "She sat at the bar.",
        "The music was loud.",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result[0].originalText).toContain("The Bar");
      expect(result[0].originalText).toContain("She sat at the bar.");
    });
  });

  describe("whitespace handling", () => {
    it("trims whitespace from instructions", () => {
      const content = "Text.\n%%   REWRITE:   lots of spaces   %%";
      const result = parseAnnotations(content);
      expect(result[0].instruction).toBe("lots of spaces");
    });

    it("handles Windows-style line endings", () => {
      const content = "Some text.\r\n%% REWRITE: fix this %%\r\n";
      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].tag).toBe("REWRITE");
    });
  });

  describe("REVISED markers", () => {
    it("does not parse REVISED markers as annotations", () => {
      const content = [
        'Some revised text.',
        '%% REVISED(v2): [REWRITE] "fix this" -- 10 words -> 12 words %%',
      ].join("\n");

      const result = parseAnnotations(content);
      // REVISED is not a valid tag, so it should be skipped.
      expect(result).toHaveLength(0);
    });
  });

  describe("block scope with {{ }}", () => {
    it("scopes to content inside {{ }} markers", () => {
      const content = [
        "{{",
        "First paragraph of the block.",
        "",
        "Second paragraph of the block.",
        "}}",
        "%% REWRITE: rewrite the whole block %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("block");
      expect(result[0].originalText).toContain("First paragraph");
      expect(result[0].originalText).toContain("Second paragraph");
    });

    it("does not include {{ }} markers in originalText", () => {
      const content = [
        "{{",
        "The target text.",
        "}}",
        "%% TONE: make it darker %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].originalText).toBe("The target text.");
      expect(result[0].originalText).not.toContain("{{");
      expect(result[0].originalText).not.toContain("}}");
    });

    it("handles blank line between }} and annotation", () => {
      const content = [
        "{{",
        "Block content here.",
        "}}",
        "",
        "%% EXPAND: add more detail %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("block");
      expect(result[0].originalText).toBe("Block content here.");
    });

    it("captures multi-paragraph blocks", () => {
      const content = [
        "{{",
        "I grind the beans. Burr grinder, not blade.",
        "",
        "I fill the kettle. 205 degrees.",
        "",
        "The grinder is the loudest thing.",
        "",
        "I pour it black.",
        "}}",
        "%% REWRITE: change to espresso %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("block");
      expect(result[0].originalText).toContain("I grind the beans");
      expect(result[0].originalText).toContain("I pour it black.");
    });

    it("falls back to paragraph scope when no matching {{ found", () => {
      const content = [
        "Some text above.",
        "}}",
        "%% REWRITE: rewrite this %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      // }} without matching {{ -- parser falls through, finds paragraph above
      expect(result[0].scope).toBe("paragraph");
    });

    it("handles multiple block-scoped annotations", () => {
      const content = [
        "{{",
        "First block.",
        "}}",
        "%% REWRITE: fix first block %%",
        "",
        "{{",
        "Second block.",
        "}}",
        "%% TONE: change tone of second block %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(2);
      expect(result[0].scope).toBe("block");
      expect(result[0].originalText).toBe("First block.");
      expect(result[1].scope).toBe("block");
      expect(result[1].originalText).toBe("Second block.");
    });

    it("handles empty block ({{ }} with no content between them)", () => {
      const content = [
        "{{",
        "}}",
        "%% REWRITE: fill this in %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("block");
      // lineStart > lineEnd when block is empty (open+1 > close-1)
      // originalText should be empty since there is nothing between {{ and }}
      expect(result[0].originalText).toBe("");
    });

    it("finds nearest matching {{ for nested-looking markers", () => {
      // When there are two {{ before a }}, the parser walks backwards
      // and finds the first {{ it encounters (nearest to the }}).
      const content = [
        "{{",
        "Outer block start.",
        "{{",
        "Inner block content.",
        "}}",
        "%% REWRITE: rewrite inner %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("block");
      // Should find the nearest {{ (line 2) as the match for }} (line 4)
      expect(result[0].originalText).toContain("Inner block content.");
    });

    it("does NOT treat {{ as block open when mixed with other text on same line", () => {
      // isBlockOpen requires the line to be exactly "{{" (with optional whitespace)
      const content = [
        "She said {{ something }}",
        "%% REWRITE: fix this line %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(1);
      // {{ on a line with other text is not treated as a block opener,
      // so scope resolution falls through to paragraph
      expect(result[0].scope).toBe("paragraph");
    });

    it("second annotation after a block does not get block scope", () => {
      // After a {{ }} block and its annotation, a subsequent annotation
      // separated by other content should NOT resolve to block scope.
      const content = [
        "{{",
        "Block content here.",
        "}}",
        "%% REWRITE: rewrite the block %%",
        "",
        "Some unrelated paragraph.",
        "%% TONE: make it darker %%",
      ].join("\n");

      const result = parseAnnotations(content);
      expect(result).toHaveLength(2);
      // Find each annotation by tag since sort order depends on lineStart
      const rewrite = result.find((a) => a.tag === "REWRITE");
      const tone = result.find((a) => a.tag === "TONE");
      expect(rewrite).toBeDefined();
      expect(tone).toBeDefined();
      // REWRITE sits right after }}, so it gets block scope
      expect(rewrite!.scope).toBe("block");
      expect(rewrite!.originalText).toBe("Block content here.");
      // TONE follows a normal paragraph, so it gets paragraph scope
      expect(tone!.scope).toBe("paragraph");
    });
  });
});
