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
  /** Called for each raw chunk of response text as it arrives. */
  onChunk: (text: string) => void;
}

export interface StreamResult {
  status: number;
  fullText: string;
}

/**
 * Issue an HTTP(S) request and stream the response body chunk-by-chunk.
 *
 * Throws an Error with `name === "AbortError"` if the signal aborts.
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
