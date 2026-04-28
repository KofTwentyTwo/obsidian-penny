# Design: Retry on 429 / transient 5xx with backoff (#15)

**Status:** Draft, awaiting approval
**Issue:** [#15](https://github.com/KofTwentyTwo/obsidian-penny/issues/15)
**Date:** 2026-04-27
**Branch (planned):** `feature/issue-15-retry-backoff` from `develop`

## Goal

Make PENNY's LLM calls survive transient failures. Today, a single 429 or 5xx aborts the entire annotation pass and pollutes the new chapter version with `AGENT-ERROR` markers (`src/pipeline.ts:342-373`) for revisions that would have succeeded on retry. This is a daily-use blocker the moment #9 (parallel annotations) lands, because concurrent Anthropic calls will routinely hit the tier-1 50 RPM / 40K TPM ceiling.

## Architecture

A new `withRetry<T>(fn, opts)` helper lives in `src/providers/node-stream.ts` (same module as `TimeoutError`, `AbortError`, `withTimeout`). Each provider's `complete()` extracts its current request body into a private `doOneAttempt()` method and wraps the call:

```ts
const maxRetries = request.maxRetries ?? 3;
return withRetry(() => this.doOneAttempt(request), {
  maxAttempts: maxRetries + 1,
  canStillRetry: () => !started,
  signal: request.signal,
  onRetry: request.onRetry,
});
```

A new `HttpError` class (also in `node-stream.ts`) carries `status`, `headers`, and `body` so the retry helper can read `Retry-After`. `streamRequest`'s return shape is extended with `headers: Record<string, string>` so the streaming path can populate `HttpError.headers` the same way the non-streaming path does. Both paths route HTTP errors through the same `buildHttpError(status, text, headers)` helper.

Retry placement is **inside each provider's `complete()`**, around the entire request path (streaming and non-streaming). This keeps the retry decision close to the code that knows what kind of error was thrown, mirrors the surface change made for `withTimeout` in #18, and avoids a new abstraction layer.

## Components

1. **`HttpError extends Error`** — `{ status: number; headers: Record<string,string>; body: string }`. Replaces the plain `Error` returned by every provider's `buildHttpError`.
2. **`withRetry<T>(fn, opts)`** — runs `fn`, classifies thrown errors, computes delay, sleeps cancellation-aware, retries up to `maxAttempts`. Options: `{ maxAttempts: number; canStillRetry?: () => boolean; signal?: AbortSignal; onRetry?: (info: RetryInfo) => void }`.
3. **`isRetriable(err): boolean`** — true when `err instanceof HttpError && (err.status === 429 || err.status === 408 || err.status >= 500)`, OR when `err` is a transport error (none of `HttpError | TimeoutError | AbortError`). False for `TimeoutError`, `AbortError`, other 4xx.
4. **`backoffDelay(err, attempt): number`** — `attempt` is 0-indexed across retries (0 = wait before retry #1, 1 = wait before retry #2, ...). If `HttpError` and `Retry-After` parses cleanly (seconds or HTTP-date), return that delay. Else `random(0, 1000 * 2^attempt)` (full jitter): max 1s before retry #1, max 2s before retry #2, max 4s before retry #3. Both branches capped at 60000ms.
5. **`CompletionRequest` additions** — `maxRetries?: number` and `onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void`.
6. **`PennySettings.maxRetries`** — default 3, range 0–5 (0 disables). Exposed in Settings → Behavior next to `requestTimeoutMs`. Threaded into `complete()` calls from `pipeline.ts`.
7. **Pipeline integration** — `pipeline.ts` passes `maxRetries` from settings, supplies an `onRetry` callback that emits `ProgressEvent("retry", { attempt, waitMs, reason })`. Providers stay free of Obsidian dependencies.

## Data flow (one annotation, 429 → 200)

1. `pipeline.ts` calls `service.complete(request)` with `maxRetries` from settings and an `onRetry` that emits a `ProgressEvent("retry", ...)`.
2. Provider's `complete()` initializes `started = false`, wraps `onToken` so the first call flips `started = true`.
3. Calls `withRetry(() => doOneAttempt(...), { maxAttempts: 4 /* maxRetries:3 + 1 initial */, canStillRetry: () => !started, signal, onRetry })`.
4. **Attempt 1 (429 with `Retry-After: 30`):** non-2xx response → `buildHttpError` constructs `HttpError(429, { "retry-after": "30" }, body)` and throws. `withRetry` catches; `isRetriable(err)` is true; `canStillRetry()` is true; `backoffDelay(err, 0)` returns 30000ms. Emits `onRetry({ attempt: 2, waitMs: 30000, reason: "429" })`, `LOG.info("retrying after 429", { provider, attempt, waitMs })`, sleeps 30s with abort-signal listener.
5. **Attempt 2 (200):** returns `CompletionResponse` normally.

Cancellation during the sleep wakes immediately and throws `AbortError`. If any token reached the user before the error (mid-stream failure), `started === true`, `canStillRetry()` returns false, and the error propagates without retry.

## Error handling

| Error kind | Retriable? |
|---|---|
| `HttpError` with status 429 | yes |
| `HttpError` with status 408 | yes |
| `HttpError` with status 5xx | yes |
| `HttpError` with other 4xx (401, 403, 400, 404, ...) | no |
| Transport error (no recognized class) | yes |
| `TimeoutError` (from #18) | no — user chose the timeout; retrying doubles the wait |
| `AbortError` (user cancellation) | no |
| Any error after first `onToken` callback fired | no — retrying would re-emit tokens |

After all attempts exhausted, throw the last error unchanged.

**Naming convention.** The setting is `maxRetries` — the number of retries on top of the initial call. Default `maxRetries: 3` means up to 4 total calls (1 initial + 3 retries). `maxRetries: 0` disables retry entirely (single attempt, surface the first error). The internal helper signature uses `maxAttempts = maxRetries + 1` so its loop bound is unambiguous.

## Testing

New `test/providers/retry.test.ts`:

- 429 → 429 → 200 succeeds with mock `httpFn`.
- `Retry-After: 5` honored; malformed `Retry-After: ABCD` falls back to exponential.
- Honors HTTP-date `Retry-After` (e.g. `Wed, 21 Oct 2026 07:28:00 GMT`) within the 60s cap.
- 401 propagates immediately, no retry.
- All 5xx retriable (501, 502, 503, 504 covered by representative tests).
- `TimeoutError` propagates, no retry.
- `AbortSignal` aborted mid-sleep → prompt `AbortError`.
- `canStillRetry` returns false (tokens emitted) → no retry on 503.
- `maxRetries: 0` makes a single attempt and throws the first error.
- Per-provider smoke tests proving wiring (one minimal test each for anthropic/openai/google/ollama).

Existing tests remain green; retry is transparent on the success path. Coverage expected to lift from 91% to ~93%; the same PR ratchets `vitest.config.ts` line/statement/function/branch thresholds and `.munitor.yml` `min_instruction` per the standing sprint pattern.

## Files affected

| Path | Change |
|---|---|
| `src/providers/node-stream.ts` | Add `HttpError`, `withRetry`, `isRetriable`, `backoffDelay`. Extend `streamRequest` return shape with `headers`. |
| `src/providers/anthropic.ts` | Refactor `complete()` body into `doOneAttempt`, wrap with `withRetry`. Update `buildHttpError(status, text, headers)` to populate `HttpError`. |
| `src/providers/openai.ts` | Same refactor as anthropic. |
| `src/providers/google.ts` | Same refactor. |
| `src/providers/ollama.ts` | Same refactor. |
| `src/providers/service.ts` | Add `maxRetries?: number` and `onRetry?: (info) => void` to `CompletionRequest`. |
| `src/types.ts` | Add `maxRetries: number` to `PennySettings`, default 3 in `migrateSettings`. |
| `src/settings.ts` | Settings → Behavior UI for max retries (slider 0–5, default 3). |
| `src/pipeline.ts` | Pass `maxRetries` from settings, wire `onRetry` to a `ProgressEvent("retry", ...)`. |
| `src/progress-modal.ts` | Render "Retrying after rate limit (attempt N/M, waiting Xs)…" when retry events arrive. |
| `test/providers/retry.test.ts` | New file covering the cases above. |
| `test/providers/{anthropic,openai,google,ollama}.test.ts` | Targeted updates for the new error shape and `doOneAttempt` refactor. |
| `vitest.config.ts`, `.munitor.yml` | Coverage threshold ratchet at PR-finalization time. |

## Open questions

None at design time. The retriable-set decision (5xx range, 408, transport errors; 4xx-other / `TimeoutError` / `AbortError` / post-onToken excluded) follows industry default behavior and the existing repo idioms.

## Out of scope

- Concurrency-aware retry coordination (single global token bucket across parallel calls). #9 will likely want this, but it can layer on top of `withRetry` later.
- Per-provider retry policy customization (e.g., "retry Ollama 5 times because it's local"). Single global setting is fine for now.
- Persistence of retry stats. Activity log captures success/failure; not adding a per-attempt audit.
