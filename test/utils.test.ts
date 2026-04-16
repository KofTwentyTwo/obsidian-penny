import { describe, it, expect } from "vitest";
import { globMatch } from "../src/utils";

describe("globMatch", () => {
  describe("exact match", () => {
    it("matches an exact string", () => {
      expect(globMatch("hello.md", "hello.md")).toBe(true);
    });

    it("rejects a non-matching string", () => {
      expect(globMatch("hello.md", "goodbye.md")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(globMatch("Hello.md", "hello.md")).toBe(false);
    });
  });

  describe("* wildcard", () => {
    it("matches any sequence of characters", () => {
      expect(globMatch("ch-*.md", "ch-01.md")).toBe(true);
      expect(globMatch("ch-*.md", "ch-99.md")).toBe(true);
      expect(globMatch("ch-*.md", "ch-abc.md")).toBe(true);
    });

    it("matches empty sequence", () => {
      expect(globMatch("ch-*.md", "ch-.md")).toBe(true);
    });

    it("matches multiple * wildcards", () => {
      expect(globMatch("*-*-*.md", "a-b-c.md")).toBe(true);
      expect(globMatch("*.*.*", "a.b.c")).toBe(true);
    });

    it("matches * at the beginning", () => {
      expect(globMatch("*.md", "anything.md")).toBe(true);
    });

    it("matches * at the end", () => {
      expect(globMatch("ch-01.*", "ch-01.md")).toBe(true);
      expect(globMatch("ch-01.*", "ch-01.txt")).toBe(true);
    });

    it("matches * for entire string", () => {
      expect(globMatch("*", "anything")).toBe(true);
      expect(globMatch("*", "")).toBe(true);
    });

    it("rejects when non-wildcard parts do not match", () => {
      expect(globMatch("ch-*.md", "ch-01.txt")).toBe(false);
      expect(globMatch("ch-*.md", "xx-01.md")).toBe(false);
    });
  });

  describe("? wildcard", () => {
    it("matches a single character", () => {
      expect(globMatch("ch-0?.md", "ch-01.md")).toBe(true);
      expect(globMatch("ch-0?.md", "ch-09.md")).toBe(true);
    });

    it("does not match zero characters", () => {
      expect(globMatch("ch-0?.md", "ch-0.md")).toBe(false);
    });

    it("does not match multiple characters", () => {
      expect(globMatch("ch-?.md", "ch-01.md")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty pattern and text", () => {
      expect(globMatch("", "")).toBe(true);
    });

    it("handles empty pattern with non-empty text", () => {
      expect(globMatch("", "hello")).toBe(false);
    });

    it("handles pattern of only wildcards", () => {
      expect(globMatch("***", "hello")).toBe(true);
      expect(globMatch("???", "abc")).toBe(true);
      expect(globMatch("???", "ab")).toBe(false);
    });

    it("matches the default chapter file pattern", () => {
      expect(globMatch("ch-*.md", "ch-01.md")).toBe(true);
      expect(globMatch("ch-*.md", "ch-01.v2.md")).toBe(true);
      expect(globMatch("ch-*.md", "outline.md")).toBe(false);
    });
  });
});
