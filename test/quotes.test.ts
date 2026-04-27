import { describe, it, expect } from "vitest";
import { QUOTES, pickRandomQuote, quoteAt } from "../src/quotes";

describe("quotes", () => {
  it("exposes a non-empty pool", () => {
    expect(QUOTES.length).toBeGreaterThan(0);
    for (const q of QUOTES) {
      expect(typeof q.text).toBe("string");
      expect(q.text.length).toBeGreaterThan(0);
      expect(typeof q.author).toBe("string");
      expect(q.author.length).toBeGreaterThan(0);
    }
  });

  describe("pickRandomQuote", () => {
    it("returns a quote from the pool", () => {
      for (let i = 0; i < 20; i++) {
        const q = pickRandomQuote();
        expect(QUOTES).toContainEqual(q);
      }
    });
  });

  describe("quoteAt", () => {
    it("returns the quote at the given index, modulo pool length", () => {
      expect(quoteAt(0)).toEqual(QUOTES[0]);
      expect(quoteAt(QUOTES.length)).toEqual(QUOTES[0]);
      expect(quoteAt(QUOTES.length + 3)).toEqual(QUOTES[3]);
    });

    it("handles negative indices correctly (wraps positively)", () => {
      expect(quoteAt(-1)).toEqual(QUOTES[QUOTES.length - 1]);
      expect(quoteAt(-QUOTES.length)).toEqual(QUOTES[0]);
      expect(quoteAt(-QUOTES.length - 1)).toEqual(QUOTES[QUOTES.length - 1]);
    });
  });
});
