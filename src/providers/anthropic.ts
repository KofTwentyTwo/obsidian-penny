/**
 * PENNY - Anthropic Claude Provider
 *
 * Implements the LLMService interface for the Anthropic Messages API.
 * Supports Claude Opus, Sonnet, and Haiku model families.
 *
 * Key features:
 * - Adaptive thinking (extended thinking) for heavy-tier annotations
 *   on supported models (Opus 4.6, Sonnet 4.6)
 * - Static model catalog (ANTHROPIC_MODELS) for offline settings display
 * - Structured error handling with Anthropic-specific status codes
 * - Response parsing that extracts text blocks from the content array
 *   (skipping thinking blocks when extended thinking is enabled)
 *
 * Uses an injected HTTP function (Obsidian's requestUrl) so this module
 * has no direct Obsidian API dependency and can be tested with a mock.
 */

import type {
  LLMService,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  ProviderSettings,
  HttpFn,
} from "./service";
import { streamRequest, withTimeout, withRetry, HttpError } from "./node-stream";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Models that support the adaptive / extended thinking feature (Claude 4.6+). */
const THINKING_CAPABLE = new Set(["claude-opus-4-6", "claude-sonnet-4-6"]);

/**
 * Static model catalog for Anthropic.
 *
 * Intentionally hardcoded for offline/static use. The settings dropdown also
 * supports free-text input (via Ollama rows), so users are not locked to
 * this list. Update manually when Anthropic ships new model aliases.
 *
 * Context windows current as of April 2026. Opus 4.6 and Sonnet 4.6 support
 * 1M context in beta; Haiku 4.5 remains at 200k.
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    contextWindow: 1000000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    contextWindow: 1000000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    contextWindow: 200000,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
];

/** Token estimation multiplier: ~1.33 tokens per word for Claude's tokenizer. */
const TOKEN_MULTIPLIER = 1.33;

export class AnthropicProvider implements LLMService {
  readonly name = "anthropic";
  readonly requiresApiKey = true;
  readonly tokenMultiplier = 1.33;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }

    const maxRetries = request.maxRetries ?? 3;

    // Track whether streaming has begun emitting tokens. Once any token has
    // reached the user, a retry would re-emit them, so the retry helper
    // skips further attempts via canStillRetry.
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
    // Try streaming when onToken is provided. Uses Node's https module under
    // the hood (streamRequest) which bypasses Obsidian's Electron CSP entirely.
    // The globalThis.fetch guard is kept as a "is this a web-capable env"
    // signal and to let tests opt out of the streaming path.
    //
    // AbortError from a cancelled stream MUST propagate -- it's not a
    // transport failure, it's the user clicking Cancel. Genuine API errors
    // (401/429/etc) also propagate. Only true transport-unavailable errors
    // fall through to the non-streaming httpFn path as a safety net.
    if (request.onToken && typeof globalThis.fetch === "function") {
      try {
        return await this.completeStreaming(request, apiKey);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "TimeoutError") throw e;
        if (e instanceof HttpError) throw e;
        if (e instanceof Error && e.message.startsWith("Anthropic streaming error")) throw e;
        // Transport-level failure (rare with Node https) -- fall through.
      }
    }

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [
        { role: "user", content: request.userPrompt },
      ],
    };

    const useThinking = request.useThinking === true && THINKING_CAPABLE.has(request.model);
    if (useThinking) {
      body.thinking = { type: "adaptive" };
    }

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    };

    if (useThinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }

    const response = await withTimeout(
      this.httpFn({
        url: ANTHROPIC_API_URL,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      request.timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text, response.headers);
    }

    return this.parseResponse(response.text, request.model);
  }

  /**
   * Streaming completion using Node's https module (via streamRequest) + SSE parsing.
   * Calls request.onToken with each text delta as it arrives. Supports
   * cancellation via request.signal.
   */
  private async completeStreaming(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const useThinking = request.useThinking === true && THINKING_CAPABLE.has(request.model);

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      stream: true,
    };

    if (useThinking) {
      body.thinking = { type: "adaptive" };
    }

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    };

    if (useThinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }

    let buffer = "";
    const textParts: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    // Captured by the SSE parser when an upstream `error` event arrives.
    // Thrown after streamRequest resolves so the partial textParts cannot
    // be returned as a "successful" CompletionResponse.
    let streamError: Error | null = null;

    const result = await streamRequest({
      url: ANTHROPIC_API_URL,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      onChunk: (chunk: string) => {
        buffer += chunk;
        // Parse SSE lines from buffer; keep incomplete last line for next chunk
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);

            // Upstream error event -- captured for throw after the stream ends.
            // Anthropic shape: { type: "error", error: { type, message } }
            if (event.type === "error") {
              const errType = event.error?.type ?? "error";
              const errMsg = event.error?.message ?? "unknown error";
              streamError = new Error(`Anthropic streaming error [${errType}]: ${errMsg}`);
              continue;
            }

            // Text delta -- the main output
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              const text = event.delta.text;
              textParts.push(text);
              request.onToken?.(text);
            }

            // Usage from message_delta (final event)
            if (event.type === "message_delta" && event.usage) {
              outputTokens = event.usage.output_tokens ?? 0;
            }

            // Usage from message_start
            if (event.type === "message_start" && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? 0;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      },
    });

    // Upstream emitted an `error` SSE event mid-stream; surface it instead
    // of returning the partial pre-error tokens as a successful result.
    if (streamError) throw streamError;

    // streamRequest returns non-2xx as data (not an error); inspect status here.
    if (result.status < 200 || result.status >= 300) {
      throw this.buildHttpError(result.status, result.fullText, result.headers);
    }

    return {
      text: textParts.join(""),
      usage: { inputTokens, outputTokens },
      model: request.model,
      provider: "anthropic",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    if (!settings.apiKey) {
      return "Anthropic API key is required";
    }

    try {
      const body = {
        model: "claude-haiku-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      };

      const response = await this.httpFn({
        url: ANTHROPIC_API_URL,
        method: "POST",
        headers: {
          "x-api-key": settings.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        return null; // success
      }
      return this.buildHttpError(response.status, response.text, response.headers).message;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Anthropic connection failed: ${message}`;
    }
  }

  /**
   * Build a typed HttpError from an Anthropic HTTP error response. Attaches
   * status + headers so the retry helper can read Retry-After. Attempts to
   * parse the Anthropic error JSON format; falls back to raw text.
   */
  private buildHttpError(
    status: number,
    responseText: string,
    headers: Record<string, string> = {},
  ): HttpError {
    let detail: string;
    try {
      const data = JSON.parse(responseText);
      if (data?.error?.message) {
        detail = data.error.message;
      } else {
        detail = responseText;
      }
    } catch {
      detail = responseText;
    }

    const baseMsg =
      status === 401
        ? `Anthropic API error (401): Invalid API key. ${detail}`
        : status === 429
          ? `Anthropic API error (429): Rate limited. ${detail}`
          : `Anthropic API error (${status}): ${detail}`;
    return new HttpError(status, headers, responseText, baseMsg);
  }

  /**
   * Parse an Anthropic Messages API response.
   *
   * Response shape:
   * ```json
   * {
   *   "content": [
   *     { "type": "thinking", "thinking": "..." },
   *     { "type": "text", "text": "the actual output" }
   *   ],
   *   "usage": { "input_tokens": 100, "output_tokens": 50 }
   * }
   * ```
   */
  private parseResponse(responseText: string, model: string): CompletionResponse {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error("Anthropic API returned malformed response: " + responseText.slice(0, 200));
      }
      throw err;
    }

    let text = "";
    if (data && Array.isArray(data.content)) {
      const textBlock = data.content.find(
        (block: Record<string, unknown>) => block.type === "text",
      );
      if (textBlock && typeof textBlock.text === "string") {
        text = textBlock.text;
      }
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.input_tokens as number | undefined,
          outputTokens: data.usage.output_tokens as number | undefined,
        }
      : undefined;

    return {
      text,
      usage,
      model,
      provider: this.name,
    };
  }
}
