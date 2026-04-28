# Issue #15: Retry on 429 / transient 5xx with backoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every PENNY LLM call survive transient failures (429, 408, 5xx, network blips) by introducing a `withRetry` helper applied inside each provider's `complete()`, with `Retry-After` honoring, full-jitter exponential backoff, abort-aware sleeps, and progress-modal visibility.

**Architecture:** Add a small set of pure helpers to `src/providers/node-stream.ts` (`HttpError`, `isRetriable`, `parseRetryAfter`, `backoffDelay`, `withRetry`). Refactor each provider's `complete()` to extract its current body into a private `doOneAttempt()` method and wrap the call with `withRetry`. Surface `Retry-After` by extending `StreamResult` with `headers` and changing each provider's `buildHttpError` to return a typed `HttpError`. Thread `maxRetries` and `onRetry` through `CompletionRequest`; `pipeline.ts` reads `settings.maxRetries` and emits a new `ProgressEvent("retry", ...)` so the progress modal can show retry status.

**Tech Stack:** TypeScript (strict, ES2018), Vitest, Node `https`/`http` (already in use via `streamRequest`), Obsidian plugin API (only at the shell boundary).

**Spec:** `docs/superpowers/specs/2026-04-27-issue-15-retry-backoff-design.md` (commit `0fe495b`).

**Branch:** `feature/issue-15-retry-backoff` (already created from `develop`).

**Working assumption:** PR #65 (issue #17 SSE error events) merges to `develop` before implementation begins on this branch. After merge, rebase this branch on `develop` so the SSE-error code is present. The plan below assumes the post-rebase state.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/providers/node-stream.ts` | modify | Add `HttpError`, `isRetriable`, `parseRetryAfter`, `backoffDelay`, `withRetry`. Extend `StreamResult` with `headers`. |
| `src/providers/service.ts` | modify | Add `maxRetries?` and `onRetry?` fields to `CompletionRequest`. |
| `src/providers/anthropic.ts` | modify | Refactor `complete()` to `doOneAttempt + withRetry`. Update `buildHttpError` to return `HttpError` with headers. |
| `src/providers/openai.ts` | modify | Same refactor pattern as anthropic. |
| `src/providers/google.ts` | modify | Same refactor pattern. |
| `src/providers/ollama.ts` | modify | Same refactor pattern. |
| `src/types.ts` | modify | Add `maxRetries: number` to `PennySettings`, default 3 in `DEFAULT_SETTINGS`. |
| `src/pipeline.ts` | modify | Add `"retry"` to `ProgressEvent.type` union, thread `maxRetries`/`onRetry` into `callProvider`. |
| `src/settings.ts` | modify | Add max-retries text input in Settings → Behavior. |
| `src/progress-modal.ts` | modify | Render retry status when `ProgressEvent("retry", ...)` arrives. |
| `test/providers/retry.test.ts` | create | Unit tests for `HttpError`, `isRetriable`, `parseRetryAfter`, `backoffDelay`, `withRetry`. |
| `test/providers/anthropic-retry.test.ts` | create | Provider-level smoke test: 429 → 200 round-trip via mock `httpFn`. |
| `test/providers/openai-retry.test.ts` | create | Same per provider. |
| `test/providers/google-retry.test.ts` | create | Same per provider. |
| `test/providers/ollama-retry.test.ts` | create | Same per provider. |
| `vitest.config.ts` | modify | Ratchet line/statement/function/branch thresholds at the end. |
| `.munitor.yml` | modify | Ratchet `min_instruction` at the end. |

---

## Task 1: `HttpError` class

**Files:**
- Modify: `src/providers/node-stream.ts`
- Create: `test/providers/retry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/providers/retry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/retry.test.ts
```
Expected: FAIL — `HttpError` is not exported.

- [ ] **Step 3: Implement `HttpError`**

Append to `src/providers/node-stream.ts` (after `withTimeout`, end of file):

```ts
/**
 * Typed HTTP error carrying the response status, headers, and body.
 *
 * Thrown by each provider's `buildHttpError` so the retry helper can
 * read `Retry-After` and decide whether the failure is retriable.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly headers: Record<string, string>,
    public readonly body: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/providers/retry.test.ts
```
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/providers/node-stream.ts test/providers/retry.test.ts
git commit -m "feat(providers): add HttpError class for typed retry classification (#15)"
```

---

## Task 2: `isRetriable` helper

**Files:**
- Modify: `src/providers/node-stream.ts`
- Modify: `test/providers/retry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/providers/retry.test.ts`:

```ts
import { isRetriable } from "../../src/providers/node-stream";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/providers/retry.test.ts -t "isRetriable"
```
Expected: FAIL — `isRetriable` is not exported.

- [ ] **Step 3: Implement `isRetriable`**

Append to `src/providers/node-stream.ts` (after `HttpError`):

```ts
/**
 * Classify a thrown error as retriable or not for `withRetry`.
 *
 * Retriable: HttpError with status 429/408/5xx, OR transport errors
 * (anything that is not HttpError, AbortError, or TimeoutError).
 * Non-retriable: AbortError (user cancellation), TimeoutError (the
 * user-set inactivity ceiling fired -- retrying would double the wait),
 * and HttpError with non-retriable status (other 4xx).
 */
export function isRetriable(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return false;
    if (err instanceof HttpError) {
      return err.status === 429 || err.status === 408 || err.status >= 500;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/providers/retry.test.ts
```
Expected: PASS (all `HttpError` + `isRetriable` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/providers/node-stream.ts test/providers/retry.test.ts
git commit -m "feat(providers): classify retriable errors via isRetriable (#15)"
```

---

## Task 3: `parseRetryAfter` + `backoffDelay`

**Files:**
- Modify: `src/providers/node-stream.ts`
- Modify: `test/providers/retry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/providers/retry.test.ts`:

```ts
import { parseRetryAfter, backoffDelay } from "../../src/providers/node-stream";

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
      expect(s).toBeLessThan(1_000); // attempt 0 base = 1s
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/providers/retry.test.ts -t "parseRetryAfter|backoffDelay"
```
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement `parseRetryAfter` and `backoffDelay`**

Append to `src/providers/node-stream.ts`:

```ts
const MAX_BACKOFF_MS = 60_000;

/**
 * Parse an RFC 7231 `Retry-After` header value into milliseconds.
 * Accepts delta-seconds ("30") or HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns null when the value is missing or unparseable.
 * HTTP-dates in the past are clamped to 0 ms (retry immediately).
 */
export function parseRetryAfter(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const trimmed = value.trim();

  // delta-seconds: positive integer
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return null;
  }

  // HTTP-date
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    return Math.max(0, ts - Date.now());
  }
  return null;
}

/**
 * Compute the wait between retry attempts.
 *
 * If `err` is an `HttpError` with a parseable `Retry-After` header, use
 * that (capped at 60s). Otherwise, full-jitter exponential backoff:
 *   delay = random(0, min(60_000, 1000 * 2^attempt))
 *
 * `attempt` is 0-indexed across retries:
 *   attempt 0 -> base 1s   (wait before retry #1)
 *   attempt 1 -> base 2s   (wait before retry #2)
 *   attempt 2 -> base 4s   (wait before retry #3)
 *   attempt N -> base min(60s, 2^N s)
 */
export function backoffDelay(err: unknown, attempt: number): number {
  if (err instanceof HttpError) {
    const parsed = parseRetryAfter(err.headers["retry-after"]);
    if (parsed !== null) return Math.min(parsed, MAX_BACKOFF_MS);
  }
  const base = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt));
  return Math.floor(Math.random() * base);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/providers/retry.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/node-stream.ts test/providers/retry.test.ts
git commit -m "feat(providers): add parseRetryAfter and backoffDelay helpers (#15)"
```

---

## Task 4: `withRetry` core

**Files:**
- Modify: `src/providers/node-stream.ts`
- Modify: `test/providers/retry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/providers/retry.test.ts`:

```ts
import { withRetry } from "../../src/providers/node-stream";

describe("withRetry", () => {
  it("returns the result on first success without retry", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retriable error and succeeds (429 -> 429 -> 200)", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new HttpError(429, { "retry-after": "0" }, "");
      return "ok";
    });
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("propagates non-retriable error immediately (no further attempts)", async () => {
    const fn = vi.fn(async () => { throw new HttpError(401, {}, ""); });
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates the last error after maxAttempts", async () => {
    const fn = vi.fn(async () => { throw new HttpError(503, {}, ""); });
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("invokes onRetry with attempt number, waitMs, and reason before each retry", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts += 1;
      if (attempts < 3) throw new HttpError(429, { "retry-after": "0" }, "");
      return "ok";
    };
    const onRetry = vi.fn();
    await withRetry(fn, { maxAttempts: 3, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 2, reason: "HTTP 429" });
    expect(onRetry.mock.calls[1][0]).toMatchObject({ attempt: 3, reason: "HTTP 429" });
  });

  it("respects canStillRetry returning false (skips retry)", async () => {
    let started = false;
    const fn = vi.fn(async () => {
      started = true;
      throw new HttpError(503, {}, "");
    });
    await expect(
      withRetry(fn, { maxAttempts: 3, canStillRetry: () => !started }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1); // started flipped after the only attempt -> no retry
  });

  it("respects an already-aborted signal and throws AbortError immediately", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fn = vi.fn(async () => "ok");
    await expect(
      withRetry(fn, { maxAttempts: 3, signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("aborts mid-sleep promptly and throws AbortError", async () => {
    const ctrl = new AbortController();
    const fn = vi.fn(async () => { throw new HttpError(503, { "retry-after": "60" }, ""); });
    setTimeout(() => ctrl.abort(), 10);
    const start = Date.now();
    await expect(
      withRetry(fn, { maxAttempts: 3, signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("maxAttempts: 1 makes a single attempt and surfaces the error (no retry)", async () => {
    const fn = vi.fn(async () => { throw new HttpError(503, {}, ""); });
    await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

(The file already imports `describe`, `it`, `expect` from `vitest`. Add `vi` to the existing import: `import { describe, it, expect, vi } from "vitest";`.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run test/providers/retry.test.ts -t "withRetry"
```
Expected: FAIL — `withRetry` is not exported.

- [ ] **Step 3: Implement `withRetry` (and supporting `sleepCancellable`)**

Append to `src/providers/node-stream.ts`:

```ts
/** Information passed to `onRetry` before the helper sleeps and re-attempts. */
export interface RetryInfo {
  /** 1-based count of the upcoming attempt. First retry is `attempt: 2`. */
  attempt: number;
  /** Milliseconds the helper will sleep before the upcoming attempt. */
  waitMs: number;
  /** Short label describing the cause (e.g. "HTTP 429", "TimeoutError", "transport"). */
  reason: string;
}

export interface RetryOpts {
  /** Total attempts, including the initial call. `maxAttempts: 3` allows up to 2 retries. */
  maxAttempts: number;
  /** Optional gate. If returns false, retries are skipped (used to stop after tokens stream). */
  canStillRetry?: () => boolean;
  /** Optional cancellation signal. Aborts both in-flight attempts and inter-attempt sleeps. */
  signal?: AbortSignal;
  /** Optional callback invoked before each retry sleep (for logging / progress UI). */
  onRetry?: (info: RetryInfo) => void;
}

/**
 * Retry an async function up to `maxAttempts` times when the thrown error
 * is classified retriable by `isRetriable`. Sleeps between attempts using
 * `backoffDelay` (Retry-After honored when present; otherwise full-jitter
 * exponential). Cancellation-aware: an aborted signal interrupts both
 * in-flight attempts and inter-attempt sleeps.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  if (opts.signal?.aborted) throw makeAbortError();

  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isFinalAttempt = attempt === opts.maxAttempts - 1;
      if (isFinalAttempt) throw err;
      if (!isRetriable(err)) throw err;
      if (opts.canStillRetry && !opts.canStillRetry()) throw err;

      const waitMs = backoffDelay(err, attempt);
      const reason = describeRetryReason(err);
      opts.onRetry?.({ attempt: attempt + 2, waitMs, reason });
      await sleepCancellable(waitMs, opts.signal);
    }
  }
  // Unreachable in practice (loop either returns or throws), but keeps TS happy.
  throw lastErr;
}

function makeAbortError(): Error {
  const err = new Error("Request aborted");
  err.name = "AbortError";
  return err;
}

function describeRetryReason(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) return err.name === "Error" ? "transport" : err.name;
  return "transport";
}

async function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/providers/retry.test.ts
```
Expected: PASS (every case in `retry.test.ts` green).

- [ ] **Step 5: Commit**

```bash
git add src/providers/node-stream.ts test/providers/retry.test.ts
git commit -m "feat(providers): add withRetry helper with abort-aware backoff (#15)"
```

---

## Task 5: Extend `StreamResult` with `headers`

**Files:**
- Modify: `src/providers/node-stream.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/providers/retry.test.ts`:

```ts
describe("streamRequest result includes headers", () => {
  // Prove the public type. A full streaming integration test is provider-level.
  it("StreamResult exposes a headers Record<string,string>", () => {
    const r: import("../../src/providers/node-stream").StreamResult = {
      status: 200,
      fullText: "",
      headers: { "content-type": "application/json" },
    };
    expect(r.headers["content-type"]).toBe("application/json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/retry.test.ts -t "StreamResult"
```
Expected: FAIL — `headers` is not in the type.

- [ ] **Step 3: Update `StreamResult` and populate `headers` in `streamRequest`**

Edit `src/providers/node-stream.ts`. Change the interface:

```ts
export interface StreamResult {
  status: number;
  fullText: string;
  /** Lowercased response headers; multi-value headers joined with ", ". */
  headers: Record<string, string>;
}
```

In `streamRequest`, on the response handler (`res.on("end", ...)`), populate headers from `res.headers`:

```ts
res.on("end", () => {
  if (settled) return;
  settled = true;
  resolve({
    status: res.statusCode ?? 0,
    fullText: chunks.join(""),
    headers: normalizeIncomingHeaders(res.headers),
  });
});
```

Add a helper at the bottom of the file:

```ts
function normalizeIncomingHeaders(
  raw: NodeJS.Dict<string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
```

- [ ] **Step 4: Run the full test suite to verify nothing else broke**

```bash
npm test
```
Expected: PASS — every existing provider/stream test still green; no test reads `headers` on `StreamResult` yet so no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/providers/node-stream.ts test/providers/retry.test.ts
git commit -m "feat(providers): expose response headers on StreamResult (#15)"
```

---

## Task 6: `CompletionRequest` gains `maxRetries` and `onRetry`

**Files:**
- Modify: `src/providers/service.ts`

- [ ] **Step 1: Add the new fields**

Edit `src/providers/service.ts`. Inside the `CompletionRequest` interface, after `timeoutMs`:

```ts
/**
 * Optional cap on retries beyond the initial call. `maxRetries: 3` means up
 * to 4 total HTTP attempts (1 initial + 3 retries). Defaults to 3 when
 * undefined. Set to 0 to disable retry entirely.
 */
maxRetries?: number;

/**
 * Optional callback invoked before each retry sleep. The pipeline forwards
 * this to a `ProgressEvent("retry", ...)` so the modal can render status.
 * Providers themselves never construct ProgressEvents (Obsidian-free).
 */
onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: PASS — purely additive type change.

- [ ] **Step 3: Commit**

```bash
git add src/providers/service.ts
git commit -m "feat(providers): add maxRetries and onRetry to CompletionRequest (#15)"
```

---

## Task 7: `ProgressEvent` gains `"retry"` variant

**Files:**
- Modify: `src/pipeline.ts`

- [ ] **Step 1: Extend the union and add fields**

Edit `src/pipeline.ts`. Update the `ProgressEvent` interface (around `pipeline.ts:52`):

```ts
export interface ProgressEvent {
  type:
    | "start"
    | "annotation-start"
    | "annotation-done"
    | "annotation-error"
    | "assembling"
    | "complete"
    | "cancelled"
    | "token"
    | "retry";
  total?: number;
  current?: number;
  tag?: string;
  line?: number;
  provider?: string;
  model?: string;
  wordCount?: number;
  error?: string;
  message?: string;
  /** Streaming token text (for type: "token"). */
  text?: string;
  /** Upcoming attempt number (1-based) for type: "retry". */
  attempt?: number;
  /** Milliseconds the pipeline will sleep before the upcoming attempt. */
  waitMs?: number;
  /** Short cause label (e.g. "HTTP 429", "TimeoutError"). */
  reason?: string;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline.ts
git commit -m "feat(pipeline): add retry variant to ProgressEvent (#15)"
```

---

## Task 8: `PennySettings.maxRetries`

**Files:**
- Modify: `src/types.ts`
- Modify: `test/settings.test.ts` (or whichever test exercises `DEFAULT_SETTINGS`)

- [ ] **Step 1: Write the failing test**

Find the existing test that asserts on `DEFAULT_SETTINGS` (search: `rg -n DEFAULT_SETTINGS test`). If one exists, add a case there. If not, add to `test/types.test.ts` (create if missing):

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";

describe("DEFAULT_SETTINGS", () => {
  it("includes maxRetries default of 3", () => {
    expect(DEFAULT_SETTINGS.maxRetries).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run -t "maxRetries default"
```
Expected: FAIL — `maxRetries` is undefined on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Add the field**

Edit `src/types.ts`. In the `PennySettings` interface, after `requestTimeoutMs`:

```ts
/**
 * Maximum retries on top of the initial LLM call. `maxRetries: 3` means up
 * to 4 total attempts. Set to 0 to disable retry. Applies to 429, 408, 5xx,
 * and transport errors. Default 3.
 */
maxRetries: number;
```

In `DEFAULT_SETTINGS` (around `types.ts:261`), after `requestTimeoutMs: 300000,`:

```ts
maxRetries: 3,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run -t "maxRetries default"
```
Expected: PASS. Then run `npm run typecheck` — expected PASS (existing settings literals are spread from `DEFAULT_SETTINGS` so no other site needs updating, but if typecheck flags anywhere, fix at the call site).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts test/types.test.ts
git commit -m "feat(settings): add maxRetries to PennySettings (default 3) (#15)"
```

---

## Task 9: Anthropic provider — wrap `complete()` with `withRetry`

**Files:**
- Modify: `src/providers/anthropic.ts`
- Create: `test/providers/anthropic-retry.test.ts`

- [ ] **Step 1: Write the failing provider-level test**

Create `test/providers/anthropic-retry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status,
    headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  content: [{ type: "text", text: "revised" }],
  usage: { input_tokens: 5, output_tokens: 3 },
};

describe("AnthropicProvider retry", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(429, { "retry-after": "0" }, { error: { message: "rate" } });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new AnthropicProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
      maxTokens: 100, apiKey: "k", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401", async () => {
    const httpFn = vi.fn(async () => jsonResponse(401, {}, { error: { message: "auth" } }));
    const provider = new AnthropicProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
        maxTokens: 100, apiKey: "k", maxRetries: 3,
      }),
    ).rejects.toThrow(/401/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry between attempts", async () => {
    let n = 0;
    const httpFn = async () => {
      n += 1;
      if (n < 2) return jsonResponse(503, {}, { error: { message: "svc" } });
      return jsonResponse(200, {}, successBody);
    };
    const onRetry = vi.fn();
    const provider = new AnthropicProvider(httpFn);
    await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
      maxTokens: 100, apiKey: "k", maxRetries: 3, onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 2, reason: "HTTP 503" });
  });

  it("maxRetries: 0 disables retry (single attempt only)", async () => {
    const httpFn = vi.fn(async () => jsonResponse(503, {}, { error: { message: "svc" } }));
    const provider = new AnthropicProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
        maxTokens: 100, apiKey: "k", maxRetries: 0,
      }),
    ).rejects.toThrow(/503/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/anthropic-retry.test.ts
```
Expected: FAIL — current provider does not retry.

- [ ] **Step 3: Refactor the provider**

Edit `src/providers/anthropic.ts`:

1. Import `withRetry` and `HttpError` from `./node-stream`:
   ```ts
   import { streamRequest, withTimeout, withRetry, HttpError } from "./node-stream";
   ```

2. Replace the body of `complete(request)` with the wrapped form, extracting the existing logic into `doOneAttempt(request)`:

   ```ts
   async complete(request: CompletionRequest): Promise<CompletionResponse> {
     const apiKey = request.apiKey;
     if (!apiKey) {
       throw new Error("Anthropic API key is required");
     }
     const maxRetries = request.maxRetries ?? 3;

     // Streaming path emits via onToken; once any token reaches the user we
     // cannot retry without re-emitting. Track that here.
     let started = false;
     const wrappedRequest: CompletionRequest = request.onToken
       ? {
           ...request,
           onToken: (text: string) => {
             started = true;
             request.onToken!(text);
           },
         }
       : request;

     return withRetry(() => this.doOneAttempt(wrappedRequest, apiKey), {
       maxAttempts: maxRetries + 1,
       canStillRetry: () => !started,
       signal: request.signal,
       onRetry: request.onRetry,
     });
   }

   private async doOneAttempt(
     request: CompletionRequest,
     apiKey: string,
   ): Promise<CompletionResponse> {
     // -- Body of the previous complete() goes here, unchanged --
   }
   ```

3. Update `buildHttpError` to populate an `HttpError`. Replace its body so it returns `HttpError`. Existing call sites already pass status and text; extend the signature to take `headers`:

   ```ts
   private buildHttpError(
     status: number,
     responseText: string,
     headers: Record<string, string> = {},
   ): HttpError {
     let detail: string;
     try {
       const data = JSON.parse(responseText);
       detail = data?.error?.message ?? responseText;
     } catch {
       detail = responseText;
     }
     const baseMsg =
       status === 401 ? `Anthropic API error (401): Invalid API key. ${detail}`
       : status === 429 ? `Anthropic API error (429): Rate limited. ${detail}`
       : `Anthropic API error (${status}): ${detail}`;
     return new HttpError(status, headers, responseText, baseMsg);
   }
   ```

4. Pass headers at every call site of `buildHttpError`:
   - Non-streaming path: `throw this.buildHttpError(response.status, response.text, response.headers);`
   - Streaming path (after `streamRequest` resolves): `throw this.buildHttpError(result.status, result.fullText, result.headers);`
   - `testConnection`: same pattern with `response.headers`.

5. Inside `completeStreaming`, wrap `request.onToken` invocations the same way they already are — no change needed there beyond the outer `complete()` already setting `started = true` via the wrapped onToken.

- [ ] **Step 4: Run all anthropic tests**

```bash
npx vitest run test/providers/anthropic
```
Expected: PASS — both pre-existing tests and the new retry test.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic.ts test/providers/anthropic-retry.test.ts
git commit -m "feat(providers): apply withRetry to Anthropic complete() (#15)"
```

---

## Task 10: OpenAI provider — same refactor pattern

**Files:**
- Modify: `src/providers/openai.ts`
- Create: `test/providers/openai-retry.test.ts`

- [ ] **Step 1: Write the failing provider-level test**

Create `test/providers/openai-retry.test.ts` mirroring `anthropic-retry.test.ts` but using `OpenAIProvider` and an OpenAI success body:

```ts
import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status, headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  choices: [{ message: { content: "revised" } }],
  usage: { prompt_tokens: 5, completion_tokens: 3 },
};

describe("OpenAIProvider retry", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(429, { "retry-after": "0" }, { error: { message: "rate" } });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new OpenAIProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini",
      maxTokens: 100, apiKey: "k", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401", async () => {
    const httpFn = vi.fn(async () => jsonResponse(401, {}, { error: { message: "auth" } }));
    const provider = new OpenAIProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini",
        maxTokens: 100, apiKey: "k", maxRetries: 3,
      }),
    ).rejects.toThrow(/401/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/openai-retry.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Refactor `OpenAIProvider`**

Apply the same five sub-changes as Task 9 to `src/providers/openai.ts`:

1. Import `withRetry, HttpError` from `./node-stream`.
2. Wrap `complete()` with `withRetry`, extract body into `doOneAttempt`.
3. Update `buildHttpError(status, responseText, headers = {})` to return `HttpError`.
4. Pass `response.headers` / `result.headers` at every call site of `buildHttpError`.
5. Wrap `onToken` once at the outer level so `started` is tracked.

- [ ] **Step 4: Run all openai tests**

```bash
npx vitest run test/providers/openai
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai.ts test/providers/openai-retry.test.ts
git commit -m "feat(providers): apply withRetry to OpenAI complete() (#15)"
```

---

## Task 11: Google provider — same refactor pattern

**Files:**
- Modify: `src/providers/google.ts`
- Create: `test/providers/google-retry.test.ts`

- [ ] **Step 1: Write the failing provider-level test**

Create `test/providers/google-retry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { GoogleProvider } from "../../src/providers/google";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status, headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  candidates: [{ content: { parts: [{ text: "revised" }] } }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
};

describe("GoogleProvider retry", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(429, { "retry-after": "0" }, { error: { message: "rate" } });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new GoogleProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "gemini-1.5-flash",
      maxTokens: 100, apiKey: "k", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401", async () => {
    const httpFn = vi.fn(async () => jsonResponse(401, {}, { error: { message: "auth" } }));
    const provider = new GoogleProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "gemini-1.5-flash",
        maxTokens: 100, apiKey: "k", maxRetries: 3,
      }),
    ).rejects.toThrow(/401/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry between attempts", async () => {
    let n = 0;
    const httpFn = async () => {
      n += 1;
      if (n < 2) return jsonResponse(503, {}, { error: { message: "svc" } });
      return jsonResponse(200, {}, successBody);
    };
    const onRetry = vi.fn();
    const provider = new GoogleProvider(httpFn);
    await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "gemini-1.5-flash",
      maxTokens: 100, apiKey: "k", maxRetries: 3, onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 2, reason: "HTTP 503" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/google-retry.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Refactor `GoogleProvider`**

Apply the same five sub-changes from Task 9 to `src/providers/google.ts`.

- [ ] **Step 4: Run all google tests**

```bash
npx vitest run test/providers/google
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/google.ts test/providers/google-retry.test.ts
git commit -m "feat(providers): apply withRetry to Google complete() (#15)"
```

---

## Task 12: Ollama provider — same refactor pattern

**Files:**
- Modify: `src/providers/ollama.ts`
- Create: `test/providers/ollama-retry.test.ts`

- [ ] **Step 1: Write the failing provider-level test**

Create `test/providers/ollama-retry.test.ts`. Ollama is local — 429s are unlikely but transient 5xx happens, so the success path is exercised against 503:

```ts
import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status, headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  message: { content: "revised" },
  prompt_eval_count: 5,
  eval_count: 3,
  done: true,
};

describe("OllamaProvider retry", () => {
  it("retries 503 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(503, {}, { error: "loading model" });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new OllamaProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "llama3.2",
      maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 404 (model not found)", async () => {
    const httpFn = vi.fn(async () => jsonResponse(404, {}, { error: "model not found" }));
    const provider = new OllamaProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "missing-model",
        maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 3,
      }),
    ).rejects.toThrow(/404/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });

  it("maxRetries: 0 disables retry on 503", async () => {
    const httpFn = vi.fn(async () => jsonResponse(503, {}, { error: "busy" }));
    const provider = new OllamaProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "llama3.2",
        maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 0,
      }),
    ).rejects.toThrow(/503/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/providers/ollama-retry.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Refactor `OllamaProvider`**

Apply the same five sub-changes from Task 9 to `src/providers/ollama.ts`. Note: Ollama's `buildHttpError` already takes a third arg (`endpoint`); add a fourth `headers` parameter rather than reordering, to keep the diff minimal:

```ts
private buildHttpError(
  status: number,
  responseText: string,
  _endpoint: string,
  headers: Record<string, string> = {},
): HttpError {
  // ...existing detail extraction...
  return new HttpError(status, headers, responseText, message);
}
```

- [ ] **Step 4: Run all ollama tests**

```bash
npx vitest run test/providers/ollama
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama.ts test/providers/ollama-retry.test.ts
git commit -m "feat(providers): apply withRetry to Ollama complete() (#15)"
```

---

## Task 13: Pipeline wires `maxRetries` and `onRetry`

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `test/pipeline.test.ts` (or create a new focused test if separation is cleaner)

- [ ] **Step 1: Write the failing test**

Add to an appropriate pipeline test file (consult `rg -l "callProvider|runPipeline" test/`). The test sets up a mock `getProvider` whose first call throws a retriable error and second call succeeds, with `settings.maxRetries: 1`, and asserts that:
- The pipeline emits a `ProgressEvent({ type: "retry", ... })` between attempts.
- The pipeline ultimately succeeds and emits `annotation-done`.

```ts
it("emits a retry ProgressEvent when the provider retries", async () => {
  let attempts = 0;
  const mockProvider = {
    async complete(req: { onRetry?: (info: any) => void }): Promise<{ text: string }> {
      attempts += 1;
      if (attempts === 1) {
        // Simulate the inner withRetry calling onRetry before retry.
        req.onRetry?.({ attempt: 2, waitMs: 10, reason: "HTTP 429" });
        // Then succeed on the same call (the mock represents the wrapped result).
      }
      return { text: "revised" };
    },
    tokenMultiplier: 1,
  };
  const events: ProgressEvent[] = [];
  // ... build PipelineInput with onProgress: (e) => events.push(e),
  //     settings.maxRetries: 1, and a single annotation
  await runPipeline(input);
  expect(events.find((e) => e.type === "retry")).toMatchObject({
    type: "retry",
    attempt: 2,
    waitMs: 10,
    reason: "HTTP 429",
  });
});
```

(The exact pipeline-input construction follows whatever helper the existing pipeline tests use. Keep the assertion shape stable.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/pipeline -t "retry ProgressEvent"
```
Expected: FAIL — pipeline doesn't pass `onRetry` yet.

- [ ] **Step 3: Wire pipeline to thread maxRetries and onRetry (and log each retry)**

Edit `src/pipeline.ts`. First, add the `pennyLog` import alongside the existing logger imports near the top:

```ts
import { createLogEntry, formatLogEntry, pennyLog } from "./logger";
```

Then in the `callProvider(provider, {...})` block (around `pipeline.ts:289`), add two fields and the dual-output `onRetry` handler. The `onRetry` callback satisfies the spec's "both logging and progress event" requirement: a `pennyLog("info", ...)` call for the activity log / dev console, plus a `ProgressEvent("retry", ...)` for the modal:

```ts
const response = await callProvider(provider, {
  systemPrompt: system,
  userPrompt: user,
  model: route.model,
  maxTokens: settings.maxTokens ?? 16000,
  apiKey: /* ...as today... */,
  endpoint: /* ...as today... */,
  useThinking,
  signal: input.signal,
  timeoutMs: settings.requestTimeoutMs,
  maxRetries: settings.maxRetries ?? 3,
  onRetry: (info) => {
    pennyLog("info", settings.logLevel, "LLM retry", {
      provider: route.provider,
      model: route.model,
      attempt: info.attempt,
      waitMs: info.waitMs,
      reason: info.reason,
    });
    onProgress?.({
      type: "retry",
      attempt: info.attempt,
      waitMs: info.waitMs,
      reason: info.reason,
      provider: route.provider,
      model: route.model,
      current: i + 1,
      total: annotations.length,
    });
  },
  onToken: onProgress ? (text: string) => {
    onProgress({ type: "token", text, current: i + 1 });
  } : undefined,
});
```

- [ ] **Step 4: Run pipeline tests to verify the new and existing tests pass**

```bash
npx vitest run test/pipeline
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts test/pipeline.test.ts
git commit -m "feat(pipeline): forward maxRetries and surface retry events (#15)"
```

---

## Task 14: Settings UI — max retries input

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Add the UI control**

Edit `src/settings.ts`. Find the existing `Request timeout (seconds)` Setting block (around `settings.ts:867`) and add a new Setting immediately below it:

```ts
new Setting(details)
  .setName("Max retries on transient errors")
  .setDesc(
    "Number of retries on top of the initial LLM call when the API returns 429, 408, 5xx, or a transport error. " +
      "Default: 3. Set to 0 to disable retry entirely. Honors Retry-After when present, otherwise full-jitter exponential backoff capped at 60 seconds per attempt."
  )
  .addText((text) =>
    text
      .setPlaceholder("3")
      .setValue(String(this.plugin.settings.maxRetries))
      .onChange(async (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < 0 || parsed > 10) {
          new Notice("PENNY: Max retries must be an integer between 0 and 10.");
          text.setValue(String(this.plugin.settings.maxRetries));
          return;
        }
        this.plugin.settings.maxRetries = parsed;
        await this.plugin.saveSettings();
      })
  );
```

- [ ] **Step 2: Verify build + typecheck**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional in CI, expected at dev time)**

Open Settings → PENNY → Behavior. Verify the new field renders, accepts `0`, `3`, `10`; rejects `-1`, `11`, `abc` with a Notice.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): expose maxRetries in Behavior tab (#15)"
```

---

## Task 15: Progress modal renders retry events

**Files:**
- Modify: `src/progress-modal.ts`

- [ ] **Step 1: Add a `case "retry":` branch to `renderEventContent`**

Edit `src/progress-modal.ts`. Inside `renderEventContent(event)` at the existing `switch (event.type)` block (around `progress-modal.ts:199`), add a new `case "retry":` between `case "token":` and `case "annotation-done":`:

```ts
case "retry": {
  const line = this.logEl.querySelector(
    `[data-index="${event.current}"]`,
  ) as HTMLElement | null;
  if (line) {
    const attempt = event.attempt ?? 0;
    const waitSec = Math.round((event.waitMs ?? 0) / 1000);
    const reason = event.reason ?? "transient error";
    // Replace the line content. Spinner is dropped for now; it returns on
    // the next annotation-start cycle. Acceptable trade-off for a
    // transient state.
    line.setText(
      ` Retrying after ${reason} (attempt ${attempt}, waiting ${waitSec}s)…`,
    );
  }
  // Keep streamEl visible if present; tokens haven't started yet on this attempt.
  break;
}
```

- [ ] **Step 2: Verify build + typecheck**

```bash
npm run build
```
Expected: PASS.

- [ ] **Step 3: Manual smoke**

With Anthropic key set and `maxRetries: 3`, run a chapter that triggers a 429 (hammer it with rapid consecutive PENNY runs, or temporarily reduce the configured tier-1 quota in a test). Confirm the modal updates the active annotation line to "Retrying after HTTP 429 (attempt 2, waiting Xs)…" then resumes normal progress and finishes.

- [ ] **Step 4: Commit**

```bash
git add src/progress-modal.ts
git commit -m "feat(progress-modal): render retry status events (#15)"
```

---

## Task 16: Coverage threshold ratchet + final smoke

**Files:**
- Modify: `vitest.config.ts`
- Modify: `.munitor.yml`

- [ ] **Step 1: Run the full test suite with coverage**

```bash
npm run test:coverage
```
Expected: PASS. Capture the new line/statement/function/branch percentages from the summary table.

- [ ] **Step 2: Bump the vitest thresholds**

Edit `vitest.config.ts`. Update the `thresholds` block to the new floors. Round each metric DOWN to the nearest whole percent so we don't cause false failures on jitter-sensitive runs:

```ts
thresholds: {
  lines: 92,        // was 90 — adjust to actual measured floor
  statements: 91,   // was 89
  functions: 96,    // was 96 — likely unchanged
  branches: 80,     // was 77 — adjust to measured
},
```

(Replace placeholder numbers with the actuals measured in Step 1.)

- [ ] **Step 3: Bump the orb-side `min_instruction`**

Edit `.munitor.yml`. Find `min_instruction: 90` and bump to the nearest whole percent at or below the measured `lines` percentage. E.g. `min_instruction: 92`.

- [ ] **Step 4: Re-run `npm run check`**

```bash
npm run check
```
Expected: PASS — full pipeline green at the new thresholds.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts .munitor.yml
git commit -m "chore(ci): ratchet coverage thresholds for retry/backoff (#15)"
```

---

## Final integration

- [ ] **Push the branch and open a PR**

```bash
git push -u origin feature/issue-15-retry-backoff
gh pr create --base develop \
  --title "fix: retry on 429 / transient 5xx with backoff (#15)" \
  --body "$(cat <<'EOF'
Closes #15.

Adds a `withRetry` wrapper inside each provider's `complete()` that retries on
429/408/5xx and transport errors with `Retry-After`-aware, full-jitter
exponential backoff (60s cap, max 3 retries by default). Skips retry once
streaming tokens have begun reaching the user. New `PennySettings.maxRetries`
exposed in Settings → Behavior. Pipeline emits `ProgressEvent("retry", ...)`
so the modal can show retry status.

See spec: `docs/superpowers/specs/2026-04-27-issue-15-retry-backoff-design.md`.
EOF
)"
```

- [ ] **Verify CI green**

Watch the CircleCI run. Both `pr-checks` workflow gates (vitest + munitor coverage gate) should pass at the bumped thresholds.

---

## Manual verification (post-merge)

- Start `npm run dev`. In Books vault, edit a chapter, drop a `%% TONE: lighter %%` annotation, save.
- Inspect the request flow with the developer console: `LOG.info("retrying after ...")` should appear when Anthropic returns 429 (test by hammering parallel runs).
- Confirm the progress modal flips to "Retrying after HTTP 429 (attempt 2, waiting 30s)…" then resumes.
- Confirm cancelling mid-retry-sleep aborts immediately without an additional HTTP call.

---

## Out of scope (intentionally excluded; track separately if needed)

- Concurrency-aware retry coordination (single token bucket across parallel calls). Defer to #9 if the simple per-call retry proves insufficient.
- Per-provider retry policy customization. Single global setting suffices.
- Persisted retry stats (telemetry). Activity log already captures success/failure; per-attempt audit not added.
