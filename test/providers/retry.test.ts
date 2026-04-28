import { describe, it, expect } from "vitest";
import { HttpError } from "../../src/providers/node-stream";

describe("HttpError", () => {
  it("captures status, headers, and body", () => {
    const err = new HttpError(429, { "retry-after": "30" }, '{"error":"rate"}');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HttpError");
    expect(err.status).toBe(429);
    expect(err.headers["retry-after"]).toBe("30");
    expect(err.body).toBe('{"error":"rate"}');
    expect(err.message).toContain("429");
  });

  it("accepts a custom message", () => {
    const err = new HttpError(500, {}, "boom", "Anthropic API error (500): boom");
    expect(err.message).toBe("Anthropic API error (500): boom");
  });
});
