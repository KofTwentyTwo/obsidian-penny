import { describe, it, expect } from "vitest";
import { HttpError, isRetriable } from "../../src/providers/node-stream";

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

describe("isRetriable", () => {
  it("retries 429", () => {
    expect(isRetriable(new HttpError(429, {}, ""))).toBe(true);
  });

  it("retries 408", () => {
    expect(isRetriable(new HttpError(408, {}, ""))).toBe(true);
  });

  it("retries all 5xx (500, 501, 502, 503, 504)", () => {
    for (const s of [500, 501, 502, 503, 504]) {
      expect(isRetriable(new HttpError(s, {}, ""))).toBe(true);
    }
  });

  it("does not retry 4xx other than 429/408", () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetriable(new HttpError(s, {}, ""))).toBe(false);
    }
  });

  it("does not retry AbortError", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isRetriable(e)).toBe(false);
  });

  it("does not retry TimeoutError", () => {
    const e = new Error("timed out");
    e.name = "TimeoutError";
    expect(isRetriable(e)).toBe(false);
  });

  it("retries plain Error (transport-level failure)", () => {
    expect(isRetriable(new Error("ECONNRESET"))).toBe(true);
  });

  it("retries non-Error throws (treats unknown as retriable transport noise)", () => {
    expect(isRetriable("network down")).toBe(true);
  });
});
