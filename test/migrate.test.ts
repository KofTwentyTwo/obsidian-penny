import { describe, it, expect } from "vitest";
import {
  planMigration,
  generateV1Content,
  generateVersionFile,
  generateStateJson,
} from "../src/migrate";
import type { MigrationPlan } from "../src/migrate";

describe("planMigration", () => {
  it("plans migration for a flat chapter file", () => {
    const files = ["04-drafts/book-1/ch-01.md"];
    const plans = planMigration(files);

    expect(plans).toHaveLength(1);
    expect(plans[0].originalPath).toBe("04-drafts/book-1/ch-01.md");
    expect(plans[0].folderPath).toBe("04-drafts/book-1/ch-01");
    expect(plans[0].v1Path).toBe("04-drafts/book-1/ch-01/ch-01.v1.md");
    expect(plans[0].versionPath).toBe("04-drafts/book-1/ch-01/.version");
    expect(plans[0].statePath).toBe("04-drafts/book-1/ch-01/.state.json");
    expect(plans[0].alreadyMigrated).toBe(false);
  });

  it("plans migration for multiple chapters", () => {
    const files = [
      "04-drafts/book-1/ch-01.md",
      "04-drafts/book-1/ch-02.md",
      "04-drafts/book-1/ch-03.md",
    ];
    const plans = planMigration(files);
    expect(plans).toHaveLength(3);

    expect(plans[0].folderPath).toBe("04-drafts/book-1/ch-01");
    expect(plans[1].folderPath).toBe("04-drafts/book-1/ch-02");
    expect(plans[2].folderPath).toBe("04-drafts/book-1/ch-03");
  });

  it("handles multi-digit chapter numbers", () => {
    const files = ["04-drafts/book-1/ch-12.md"];
    const plans = planMigration(files);
    expect(plans).toHaveLength(1);
    expect(plans[0].folderPath).toBe("04-drafts/book-1/ch-12");
    expect(plans[0].v1Path).toBe("04-drafts/book-1/ch-12/ch-12.v1.md");
  });

  it("skips already-versioned files (ch-NN.vN.md)", () => {
    const files = [
      "04-drafts/book-1/ch-01/ch-01.v1.md",
      "04-drafts/book-1/ch-01/ch-01.v2.md",
    ];
    const plans = planMigration(files);
    expect(plans).toHaveLength(0);
  });

  it("skips non-chapter files", () => {
    const files = [
      "04-drafts/book-1/outline.md",
      "04-drafts/book-1/notes.md",
      "02-characters/protagonist.md",
    ];
    const plans = planMigration(files);
    expect(plans).toHaveLength(0);
  });

  it("marks files already in a chapter folder as alreadyMigrated", () => {
    // This is a flat ch-01.md inside a ch-01/ folder (already migrated but
    // with the old filename).
    const files = ["04-drafts/book-1/ch-01/ch-01.md"];
    const plans = planMigration(files);
    expect(plans).toHaveLength(1);
    expect(plans[0].alreadyMigrated).toBe(true);
  });

  it("handles different book folders", () => {
    const files = [
      "04-drafts/book-1/ch-01.md",
      "04-drafts/book-2/ch-01.md",
    ];
    const plans = planMigration(files);
    expect(plans).toHaveLength(2);
    expect(plans[0].folderPath).toBe("04-drafts/book-1/ch-01");
    expect(plans[1].folderPath).toBe("04-drafts/book-2/ch-01");
  });

  it("handles empty file list", () => {
    const plans = planMigration([]);
    expect(plans).toHaveLength(0);
  });

  it("is idempotent -- same input produces same output", () => {
    const files = ["04-drafts/book-1/ch-05.md"];
    const plans1 = planMigration(files);
    const plans2 = planMigration(files);
    expect(plans1).toEqual(plans2);
  });
});

describe("generateV1Content", () => {
  it("returns the original content unchanged", () => {
    const content = [
      "---",
      "type: chapter",
      "book: 1",
      "chapter: 1",
      "---",
      "",
      "# Chapter 1",
      "",
      "She walked in.",
    ].join("\n");

    expect(generateV1Content(content)).toBe(content);
  });

  it("preserves empty content", () => {
    expect(generateV1Content("")).toBe("");
  });

  it("preserves content with annotations", () => {
    const content = "Text.\n%% REWRITE: fix %%\nMore text.";
    expect(generateV1Content(content)).toBe(content);
  });
});

describe("generateVersionFile", () => {
  it("returns '1'", () => {
    expect(generateVersionFile()).toBe("1");
  });
});

describe("generateStateJson", () => {
  it("returns valid JSON", () => {
    const json = generateStateJson();
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
  });

  it("has version 1", () => {
    const parsed = JSON.parse(generateStateJson());
    expect(parsed.version).toBe(1);
  });

  it("has null lastProcessed", () => {
    const parsed = JSON.parse(generateStateJson());
    expect(parsed.lastProcessed).toBeNull();
  });

  it("has empty processedAnnotations array", () => {
    const parsed = JSON.parse(generateStateJson());
    expect(parsed.processedAnnotations).toEqual([]);
  });

  it("is idempotent", () => {
    expect(generateStateJson()).toBe(generateStateJson());
  });
});
