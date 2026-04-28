/**
 * PENNY - Node HTTP(S) Streaming Client
 *
 * Obsidian's Electron renderer blocks native `fetch()` to external APIs via CSP,
 * but Electron provides full Node integration -- Node's `http` / `https` modules
 * bypass the browser security layer entirely. This is the standard pattern for
 * streaming HTTP in Obsidian community plugins.
 *
 * This module exposes a single `streamRequest()` function that:
 *   - Selects `http` vs `https` based on the URL scheme
 *   - Emits raw response chunks via `onChunk(string)` as they arrive
 *   - Supports cancellation via AbortSignal (wired to req.destroy())
 *   - Returns `{ status, fullText }` once the response ends
 *
 * SSE parsing is intentionally left to the caller, because each LLM provider
 * has its own event shape (Anthropic's `message_delta`, OpenAI's `choices[].delta`,
 * Google's `candidates[].content.parts[]`, etc.).
 */

import type { IncomingMessage } from "http";

export interface StreamOptions {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /**
   * Optional inactivity timeout in milliseconds. When the request goes this
   * long without sending or receiving bytes, the request is destroyed and the
   * promise rejects with `name === "TimeoutError"` (distinct from AbortError
   * so callers can distinguish user-cancellation from server-hang).
   */
  timeoutMs?: number;
  /** Called for each raw chunk of response text as it arrives. */
  onChunk: (text: string) => void;
}

export interface StreamResult {
  status: number;
  fullText: string;
  /** Lowercased response headers; multi-value headers joined with ", ". */
  headers: Record<string, string>;
}

/**
 * Issue an HTTP(S) request and stream the response body chunk-by-chunk.
 *
 * Throws an Error with `name === "AbortError"` if the signal aborts.
 * Throws an Error with `name === "TimeoutError"` if `timeoutMs` is set and
 * elapses without server activity.
 * Rejects on network/DNS errors. A non-2xx status is NOT an error here --
 * the caller inspects `result.status` and `result.fullText` to decide.
 */
export function streamRequest(opts: StreamOptions): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    // Guard: already aborted before we started
    if (opts.signal?.aborted) {
      const err = new Error("Request aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }

    const parsed = new URL(opts.url);
    const isHttps = parsed.protocol === "https:";

    // Require the transport module lazily -- keeps this module importable in
    // test environments that may stub it and avoids eager resolution at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const transport = isHttps ? require("https") : require("http");

    const requestOptions = {
      method: opts.method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        ...opts.headers,
        ...(opts.body ? { "Content-Length": Buffer.byteLength(opts.body).toString() } : {}),
      },
    };

    const chunks: string[] = [];
    let settled = false;
    // Marker set by the timeout callback before destroying the request.
    // Read in the error handler to disambiguate timeout from abort/transport errors,
    // since req.destroy() emits the same ECONNRESET-shaped error in all three cases.
    let timedOut = false;

    const req = transport.request(requestOptions, (res: IncomingMessage) => {
      res.setEncoding("utf8");

      res.on("data", (chunk: string) => {
        chunks.push(chunk);
        try {
          opts.onChunk(chunk);
        } catch {
          // Don't let a consumer throw bring down the whole stream
        }
      });

      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          fullText: chunks.join(""),
          headers: normalizeIncomingHeaders(res.headers),
        });
      });

      res.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

    req.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      // Order matters: timeout must be checked before abort, since a timeout
      // that fires while a signal is also pending could be misclassified.
      if (timedOut) {
        const timeoutErr = new Error(`Request timed out after ${opts.timeoutMs}ms`);
        timeoutErr.name = "TimeoutError";
        reject(timeoutErr);
        return;
      }
      // When we call req.destroy() due to abort, Node emits ECONNRESET / socket
      // hang up here. Translate to a clean AbortError so callers can detect it.
      if (opts.signal?.aborted) {
        const aborted = new Error("Request aborted");
        aborted.name = "AbortError";
        reject(aborted);
        return;
      }
      reject(err);
    });

    // Wire signal -> req.destroy(). If signal aborts mid-request, the req emits
    // "error" which we convert to AbortError above.
    const onAbort = () => {
      if (settled) return;
      req.destroy(new Error("aborted"));
    };
    opts.signal?.addEventListener("abort", onAbort);

    // Wire the inactivity timeout. Node's req.setTimeout(ms, cb) fires cb after
    // ms of no socket activity. We mark `timedOut` so the error handler can
    // produce a TimeoutError instead of a generic transport error or AbortError.
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      req.setTimeout(opts.timeoutMs, () => {
        if (settled) return;
        timedOut = true;
        req.destroy(new Error("timeout"));
      });
    }

    // Clean up the listener once we've resolved or rejected
    const cleanup = () => {
      opts.signal?.removeEventListener("abort", onAbort);
    };
    req.on("close", cleanup);

    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

/**
 * Wrap an arbitrary Promise with a TimeoutError fallback.
 *
 * Used for the non-streaming provider path, which goes through Obsidian's
 * `requestUrl` (no native AbortSignal support). The underlying request keeps
 * running in the background after the timeout fires -- there is no way to
 * cancel it -- but the promise the caller awaits rejects on time, freeing
 * the UI. Node/Electron eventually GCs the orphaned request.
 *
 * For the streaming path, prefer `streamRequest({ timeoutMs })` which can
 * actually destroy the in-flight request via `req.destroy()`.
 *
 * @param promise   The promise to race against the timeout.
 * @param timeoutMs Inactivity ceiling in milliseconds. If undefined or <=0,
 *                  the original promise is returned unchanged (no timeout).
 * @returns         A promise that resolves with the original value, or rejects
 *                  with `name === "TimeoutError"` after `timeoutMs` elapses.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

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

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return null;
  }

  // Require at least one alphabetic character before trying Date.parse so that
  // bare-number/sign inputs like "-5" don't sneak through as year-style dates.
  if (!/[A-Za-z]/.test(trimmed)) return null;
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
    const onAbort = (): void => {
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

/**
 * Flatten Node's IncomingHttpHeaders shape (string | string[] | undefined)
 * into a lowercased Record<string,string> for downstream consumers (the
 * retry helper, providers reading Retry-After, etc.).
 */
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
