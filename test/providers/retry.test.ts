import { describe, it, expect } from "vitest";
import { HttpError, isRetriable, parseRetryAfter, backoffDelay } from "../../src/providers/node-stream";

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

describe("parseRetryAfter", () => {
  it("parses delta-seconds (number)", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses HTTP-date and returns ms-from-now (clamped to >= 0)", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeGreaterThan(5_000);
    expect(parsed!).toBeLessThanOrEqual(10_000);

    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it("returns null for malformed values", () => {
    expect(parseRetryAfter("abc")).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("honors Retry-After header (seconds), capped at 60s", () => {
    const err = new HttpError(429, { "retry-after": "30" }, "");
    expect(backoffDelay(err, 0)).toBe(30_000);
  });

  it("caps Retry-After at 60s for a misformatted long delay", () => {
    const err = new HttpError(429, { "retry-after": "86400" }, "");
    expect(backoffDelay(err, 0)).toBe(60_000);
  });

  it("falls back to exponential with full jitter on malformed Retry-After", () => {
    const err = new HttpError(429, { "retry-after": "ABCD" }, "");
    const samples = Array.from({ length: 50 }, () => backoffDelay(err, 0));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1_000);
    }
  });

  it("exponential base scales 1s/2s/4s with full jitter, capped at 60s", () => {
    const err = new HttpError(500, {}, "");
    for (let attempt = 0; attempt < 4; attempt++) {
      const cap = Math.min(60_000, 1_000 * Math.pow(2, attempt));
      const samples = Array.from({ length: 30 }, () => backoffDelay(err, attempt));
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(cap || 1);
      }
    }
  });

  it("non-HttpError uses exponential", () => {
    const samples = Array.from({ length: 30 }, () => backoffDelay(new Error("oops"), 1));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2_000);
    }
  });
});
