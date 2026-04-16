import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateAgentFields,
  countProseWords,
  detectCharacters,
} from "../src/frontmatter";

describe("parseFrontmatter", () => {
  it("parses basic key-value frontmatter", () => {
    const content = [
      "---",
      "type: chapter",
      "book: 1",
      "chapter: 5",
      "title: Rabbit",
      "pov: protagonist",
      "status: draft",
      "wordcount: 3200",
      "---",
      "",
      "# Chapter 5",
      "",
      "Some prose here.",
    ].join("\n");

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.type).toBe("chapter");
    expect(frontmatter.book).toBe(1);
    expect(frontmatter.chapter).toBe(5);
    expect(frontmatter.title).toBe("Rabbit");
    expect(frontmatter.pov).toBe("protagonist");
    expect(frontmatter.status).toBe("draft");
    expect(frontmatter.wordcount).toBe(3200);
    expect(body).toContain("# Chapter 5");
    expect(body).toContain("Some prose here.");
  });

  it("parses array fields (block style)", () => {
    const content = [
      "---",
      "characters_in_scene:",
      "  - protagonist",
      "  - tim",
      "  - rabbit",
      "---",
      "Body text.",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.characters_in_scene).toEqual(["protagonist", "tim", "rabbit"]);
  });

  it("parses inline array fields", () => {
    const content = [
      "---",
      "characters_in_scene: [protagonist, tim]",
      "---",
      "Body.",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.characters_in_scene).toEqual(["protagonist", "tim"]);
  });

  it("handles empty frontmatter", () => {
    const content = "---\n\n---\nBody text.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toBe("Body text.");
  });

  it("handles content with no frontmatter", () => {
    const content = "Just body text, no frontmatter.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toBe(content);
  });

  it("parses boolean values", () => {
    const content = "---\nautoProcess: true\ndisabled: false\n---\nBody.";
    const { frontmatter } = parseFrontmatter(content);
    expect((frontmatter as Record<string, unknown>).autoProcess).toBe(true);
    expect((frontmatter as Record<string, unknown>).disabled).toBe(false);
  });

  it("parses quoted string values", () => {
    const content = '---\ntitle: "Chapter One"\n---\nBody.';
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.title).toBe("Chapter One");
  });

  it("parses empty string values", () => {
    const content = '---\ntitle: ""\nfocus: ""\n---\nBody.';
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.title).toBe("");
    expect(frontmatter.focus).toBe("");
  });

  it("handles empty arrays", () => {
    const content = "---\ncharacters_in_scene: []\n---\nBody.";
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.characters_in_scene).toEqual([]);
  });
});

describe("serializeFrontmatter", () => {
  it("serializes basic frontmatter", () => {
    const frontmatter = {
      type: "chapter",
      book: 1,
      chapter: 5,
      title: "Rabbit",
    };

    const result = serializeFrontmatter(frontmatter, "Body text.");
    expect(result).toContain("---");
    expect(result).toContain("type: chapter");
    expect(result).toContain("book: 1");
    expect(result).toContain("chapter: 5");
    expect(result).toContain("title: Rabbit");
    expect(result).toContain("Body text.");
  });

  it("serializes array fields", () => {
    const frontmatter = {
      characters_in_scene: ["protagonist", "tim"],
    };

    const result = serializeFrontmatter(frontmatter, "Body.");
    expect(result).toContain("characters_in_scene:");
    expect(result).toContain("  - protagonist");
    expect(result).toContain("  - tim");
  });

  it("serializes empty string as quoted", () => {
    const frontmatter = { title: "" };
    const result = serializeFrontmatter(frontmatter, "Body.");
    expect(result).toContain('title: ""');
  });

  it("omits undefined and null values", () => {
    const frontmatter = {
      type: "chapter",
      title: undefined,
      focus: null,
    } as Record<string, unknown>;

    const result = serializeFrontmatter(frontmatter, "Body.");
    expect(result).not.toContain("title:");
    expect(result).not.toContain("focus:");
  });

  it("roundtrips parse -> serialize -> parse", () => {
    const original = [
      "---",
      "type: chapter",
      "book: 1",
      "chapter: 3",
      "title: Coffee",
      "wordcount: 1500",
      "characters_in_scene:",
      "  - protagonist",
      "  - tim",
      "---",
      "# Chapter 3",
      "",
      "She walked in.",
    ].join("\n");

    const { frontmatter, body } = parseFrontmatter(original);
    const serialized = serializeFrontmatter(frontmatter, body);
    const { frontmatter: fm2, body: body2 } = parseFrontmatter(serialized);

    expect(fm2.type).toBe(frontmatter.type);
    expect(fm2.book).toBe(frontmatter.book);
    expect(fm2.chapter).toBe(frontmatter.chapter);
    expect(fm2.title).toBe(frontmatter.title);
    expect(fm2.wordcount).toBe(frontmatter.wordcount);
    expect(fm2.characters_in_scene).toEqual(frontmatter.characters_in_scene);
    expect(body2).toContain("She walked in.");
  });
});

describe("updateAgentFields", () => {
  it("adds new agent fields", () => {
    const fm = { type: "chapter", book: 1 };
    const updated = updateAgentFields(fm, {
      agent_version: 2,
      agent_last_revised: "2026-04-16T00:00:00Z",
      agent_annotations_pending: 3,
    });

    expect(updated.agent_version).toBe(2);
    expect(updated.agent_last_revised).toBe("2026-04-16T00:00:00Z");
    expect(updated.agent_annotations_pending).toBe(3);
    expect(updated.type).toBe("chapter");
    expect(updated.book).toBe(1);
  });

  it("overwrites existing agent fields", () => {
    const fm = { agent_version: 1, agent_annotations_pending: 5 };
    const updated = updateAgentFields(fm, {
      agent_version: 2,
      agent_annotations_pending: 0,
    });

    expect(updated.agent_version).toBe(2);
    expect(updated.agent_annotations_pending).toBe(0);
  });

  it("does not mutate the original", () => {
    const fm = { type: "chapter" };
    updateAgentFields(fm, { agent_version: 1 });
    expect(fm).not.toHaveProperty("agent_version");
  });
});

describe("countProseWords", () => {
  it("counts words after the prose marker", () => {
    const content = [
      "# Chapter 1",
      "",
      "## Key Beats",
      "",
      "1. First beat",
      "2. Second beat",
      "",
      "---",
      "",
      "<!-- Prose begins below -->",
      "",
      "She walked into the room and sat down.",
    ].join("\n");

    const count = countProseWords(content, "<!-- Prose begins below -->");
    expect(count).toBe(8); // "She walked into the room and sat down."
  });

  it("counts all words when prose marker is not found", () => {
    const content = "Three word sentence.";
    const count = countProseWords(content, "<!-- Prose begins below -->");
    expect(count).toBe(3);
  });

  it("counts all words when prose marker is empty", () => {
    const content = "One two three four five.";
    const count = countProseWords(content, "");
    expect(count).toBe(5);
  });

  it("excludes annotation comments from word count", () => {
    const content = [
      "<!-- Prose begins below -->",
      "She walked in.",
      "%% REWRITE: fix this %%",
      "She sat down.",
    ].join("\n");

    const count = countProseWords(content, "<!-- Prose begins below -->");
    // "She walked in." (3) + "She sat down." (3) = 6
    expect(count).toBe(6);
  });

  it("excludes HTML comments from word count", () => {
    const content = [
      "<!-- Prose begins below -->",
      "<!-- This is a comment with words -->",
      "Three actual words.",
    ].join("\n");

    const count = countProseWords(content, "<!-- Prose begins below -->");
    expect(count).toBe(3);
  });

  it("returns 0 for empty content after marker", () => {
    const content = "<!-- Prose begins below -->\n";
    const count = countProseWords(content, "<!-- Prose begins below -->");
    expect(count).toBe(0);
  });
});

describe("detectCharacters", () => {
  it("detects characters from focus field", () => {
    const chars = detectCharacters("", "Her + Rabbit");
    expect(chars).toContain("her");
    expect(chars).toContain("rabbit");
  });

  it("detects characters from dialogue attribution", () => {
    const content = [
      '"Hey," Tim said.',
      '"What?" she asked.',
      '"Nothing," Tim replied.',
    ].join("\n");

    const chars = detectCharacters(content, "");
    expect(chars).toContain("tim");
  });

  it("detects characters from reverse attribution", () => {
    const content = 'said Tyler, finishing his sandwich.';
    const chars = detectCharacters(content, "");
    expect(chars).toContain("tyler");
  });

  it("combines focus field and dialogue detection", () => {
    const content = '"Run it again," Darin said.';
    const chars = detectCharacters(content, "Her + Rabbit");
    expect(chars).toContain("her");
    expect(chars).toContain("rabbit");
    expect(chars).toContain("darin");
  });

  it("deduplicates results", () => {
    const content = '"One," Tim said. "Two," Tim said.';
    const chars = detectCharacters(content, "Tim");
    const timCount = chars.filter((c) => c === "tim").length;
    expect(timCount).toBe(1);
  });

  it("handles empty focus and no dialogue", () => {
    const chars = detectCharacters("Just narration, no quotes.", "");
    expect(chars).toHaveLength(0);
  });

  it("handles comma-separated focus field", () => {
    const chars = detectCharacters("", "protagonist, tim, rabbit");
    expect(chars).toContain("protagonist");
    expect(chars).toContain("tim");
    expect(chars).toContain("rabbit");
  });

  it("handles ampersand in focus field", () => {
    const chars = detectCharacters("", "Her & Tim");
    expect(chars).toContain("her");
    expect(chars).toContain("tim");
  });
});
