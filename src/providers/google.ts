/**
 * PENNY - Google Gemini Provider
 *
 * Implements the LLMService interface for the Google Generative Language API.
 * Supports Gemini 2.5 Pro, 2.5 Flash, and 2.0 Flash model families.
 *
 * Key features:
 * - Static model catalog (GOOGLE_MODELS) for offline settings display
 * - Structured error handling with Google-specific status codes
 * - API key authentication via query parameter
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

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Static model catalog for Google Gemini.
 *
 * Intentionally hardcoded for offline/static use. Update manually
 * when Google ships new model aliases.
 *
 * Context windows current as of April 2026.
 */
export const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    contextWindow: 1048576,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    contextWindow: 1048576,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    contextWindow: 1048576,
  },
];

/** Token estimation multiplier: ~1.0 tokens per word for Gemini's tokenizer. */
const TOKEN_MULTIPLIER = 1.0;

export class GoogleProvider implements LLMService {
  readonly name = "google";
  readonly requiresApiKey = true;
  readonly tokenMultiplier = 1.0;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return GOOGLE_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Google API key is required");
    }

    const maxRetries = request.maxRetries ?? 3;

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
    // Stream via Node https (streamRequest) when onToken is set. AbortError
    // and API errors must propagate; only true transport failures fall back.
    if (request.onToken && typeof globalThis.fetch === "function") {
      try {
        return await this.completeStreaming(request, apiKey);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "TimeoutError") throw e;
        if (e instanceof HttpError) throw e;
        if (e instanceof Error && e.message.startsWith("Google streaming error")) throw e;
        // Transport-level failure -- fall through to httpFn.
      }
    }

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: request.userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens,
      },
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    const url = `${GOOGLE_API_BASE}/${request.model}:generateContent?key=${apiKey}`;

    const response = await withTimeout(
      this.httpFn({
        url,
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      request.timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text, response.headers);
    }

    return this.parseResponse(response.text, request.model);
  }

  private async completeStreaming(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
      generationConfig: { maxOutputTokens: request.maxTokens },
    };
    if (request.systemPrompt) {
      body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    // Google uses streamGenerateContent with alt=sse for SSE streaming
    const url = `${GOOGLE_API_BASE}/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    let buffer = "";
    const textParts: string[] = [];
    // Captured by the SSE parser when an upstream `error` event arrives.
    let streamError: Error | null = null;

    const result = await streamRequest({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      onChunk: (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          try {
            const event = JSON.parse(data);
            // Upstream error event. Google shape: { error: { code, message, status } }
            if (event.error) {
              const errStatus = event.error?.status ?? event.error?.code ?? "error";
              const errMsg = event.error?.message ?? String(event.error);
              streamError = new Error(`Google streaming error [${errStatus}]: ${errMsg}`);
              continue;
            }
            const parts = event.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part.text === "string") {
                  textParts.push(part.text);
                  request.onToken?.(part.text);
                }
              }
            }
          } catch { /* skip */ }
        }
      },
    });

    if (streamError) throw streamError;

    if (result.status < 200 || result.status >= 300) {
      throw this.buildHttpError(result.status, result.fullText, result.headers);
    }

    return {
      text: textParts.join(""),
      usage: {},
      model: request.model,
      provider: "google",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    if (!settings.apiKey) {
      return "Google API key is required";
    }

    try {
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: "ping" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 16,
        },
      };

      const url = `${GOOGLE_API_BASE}/gemini-2.0-flash:generateContent?key=${settings.apiKey}`;

      const response = await this.httpFn({
        url,
        method: "POST",
        headers: {
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
      return `Google connection failed: ${message}`;
    }
  }

  /**
   * Build a typed HttpError from a Google HTTP error response. Attaches
   * status + headers so the retry helper can read Retry-After.
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
        ? `Google API error (401): Invalid API key. ${detail}`
        : status === 429
          ? `Google API error (429): Rate limited. ${detail}`
          : `Google API error (${status}): ${detail}`;
    return new HttpError(status, headers, responseText, baseMsg);
  }

  /**
   * Parse a Google Generative Language API response.
   *
   * Response shape:
   * ```json
   * {
   *   "candidates": [
   *     { "content": { "parts": [{ "text": "the actual output" }] } }
   *   ],
   *   "usageMetadata": { "promptTokenCount": 100, "candidatesTokenCount": 50 }
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
        throw new Error("Google API returned malformed response: " + responseText.slice(0, 200));
      }
      throw err;
    }

    let text = "";
    if (data && Array.isArray(data.candidates) && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      if (candidate.content && Array.isArray(candidate.content.parts)) {
        const textPart = candidate.content.parts.find(
          (part: Record<string, unknown>) => typeof part.text === "string",
        );
        if (textPart) {
          text = textPart.text.trim();
        }
      }
    }

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount as number | undefined,
          outputTokens: data.usageMetadata.candidatesTokenCount as number | undefined,
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
