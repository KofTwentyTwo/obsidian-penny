import { describe, it, expect } from "vitest";
import { parseProjectConfig } from "../src/project-config";

describe("parseProjectConfig", () => {
  describe("key-value parsing", () => {
    it("parses simple key-value pairs from the Project section", () => {
      const content = [
        "# PENNY.md",
        "",
        "## Project",
        "",
        "drafts: my-drafts",
        "style-guide: reference/style.md",
        "wiki: 05-wiki",
        "",
        "## Other Section",
        "",
        "This is not parsed.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.draftsFolder).toBe("my-drafts");
      expect(result.styleGuide).toBe("reference/style.md");
      expect(result.wikiFolder).toBe("05-wiki");
    });

    it("parses numeric values for contextBudget and maxTokens", () => {
      const content = [
        "## Project",
        "",
        "context-budget: 500000",
        "max-tokens: 8000",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.contextBudget).toBe(500000);
      expect(result.maxTokens).toBe(8000);
    });

    it("ignores invalid numeric values", () => {
      const content = [
        "## Project",
        "",
        "context-budget: not-a-number",
        "max-tokens: -5",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.contextBudget).toBeUndefined();
      expect(result.maxTokens).toBeUndefined();
    });

    it("ignores unknown keys", () => {
      const content = [
        "## Project",
        "",
        "drafts: my-drafts",
        "unknown-key: some-value",
        "another: thing",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.draftsFolder).toBe("my-drafts");
      expect(Object.keys(result)).not.toContain("unknown-key");
    });

    it("stops parsing at the next heading", () => {
      const content = [
        "## Project",
        "",
        "drafts: correct-folder",
        "",
        "## Something Else",
        "",
        "drafts: wrong-folder",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.draftsFolder).toBe("correct-folder");
    });
  });

  describe("voice rules extraction", () => {
    it("extracts voice rules from the Voice Rules section", () => {
      const content = [
        "## Project",
        "",
        "drafts: 04-drafts",
        "",
        "## Voice Rules",
        "",
        "- No internal monologue.",
        "- She is never named.",
        "- Humor is structural.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.customVoiceRules).toBeDefined();
      expect(result.customVoiceRules).toContain("No internal monologue.");
      expect(result.customVoiceRules).toContain("She is never named.");
      expect(result.customVoiceRules).toContain("Humor is structural.");
    });

    it("returns no customVoiceRules when section is empty", () => {
      const content = [
        "## Project",
        "",
        "drafts: 04-drafts",
        "",
        "## Voice Rules",
        "",
        "## Other Section",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.customVoiceRules).toBeUndefined();
    });
  });

  describe("HTML comment skipping", () => {
    it("skips single-line HTML comments in voice rules", () => {
      const content = [
        "## Voice Rules",
        "",
        "- Rule one.",
        "<!-- This is a comment -->",
        "- Rule two.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.customVoiceRules).toContain("Rule one.");
      expect(result.customVoiceRules).toContain("Rule two.");
      expect(result.customVoiceRules).not.toContain("This is a comment");
    });

    it("skips multi-line HTML comments in voice rules", () => {
      const content = [
        "## Voice Rules",
        "",
        "- Rule one.",
        "<!-- This is a",
        "multi-line comment",
        "that spans several lines -->",
        "- Rule two.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.customVoiceRules).toContain("Rule one.");
      expect(result.customVoiceRules).toContain("Rule two.");
      expect(result.customVoiceRules).not.toContain("multi-line comment");
    });

    it("handles adjacent HTML comments", () => {
      const content = [
        "## Voice Rules",
        "",
        "<!-- comment one -->",
        "<!-- comment two -->",
        "- Actual rule.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.customVoiceRules).toContain("Actual rule.");
      expect(result.customVoiceRules).not.toContain("comment one");
      expect(result.customVoiceRules).not.toContain("comment two");
    });
  });

  describe("missing sections", () => {
    it("returns empty overrides when no Project section exists", () => {
      const content = [
        "# PENNY.md",
        "",
        "This file has no Project section.",
        "",
        "## Other",
        "",
        "stuff: things",
      ].join("\n");

      const result = parseProjectConfig(content);

      // Should have no keys (or only customVoiceRules if empty)
      expect(result.draftsFolder).toBeUndefined();
      expect(result.styleGuide).toBeUndefined();
    });

    it("returns empty overrides for completely empty content", () => {
      const result = parseProjectConfig("");

      expect(Object.keys(result).length).toBe(0);
    });

    it("handles content with only a Project heading and no values", () => {
      const content = [
        "## Project",
        "",
        "Some prose but no key: value pairs with recognized keys.",
      ].join("\n");

      const result = parseProjectConfig(content);

      expect(result.draftsFolder).toBeUndefined();
    });
  });
});
