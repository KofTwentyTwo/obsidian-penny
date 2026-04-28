/**
 * PENNY - Ollama Provider
 *
 * Implements the LLMService interface for Ollama's local model server.
 * Allows PENNY to use locally-hosted open-source models (LLaMA, Mistral,
 * DeepSeek, etc.) instead of or alongside the Anthropic API.
 *
 * Uses two Ollama APIs:
 * - GET /api/tags             -- list locally installed models
 * - POST /v1/chat/completions -- OpenAI-compatible chat completions
 *
 * Key differences from the Anthropic provider:
 * - No API key required by default (local server)
 * - Model list is dynamically fetched rather than hardcoded
 * - Token multiplier is 1.0 (most local tokenizers are ~1:1 word:token)
 * - No extended thinking support
 * - Connection errors include helpful "Is Ollama running?" messages
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

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

/**
 * Token estimation multiplier: ~1.0 tokens per word for most local models.
 *
 * Ollama models are fetched dynamically via /api/tags, so there is no
 * hardcoded model catalog here (unlike the Anthropic provider).
 */
const TOKEN_MULTIPLIER = 1.0;

export class OllamaProvider implements LLMService {
  readonly name = "ollama";
  readonly requiresApiKey = false;
  readonly tokenMultiplier = 1.0;

  constructor(private httpFn: HttpFn) {}

  /**
   * Fetch available models from the Ollama instance.
   * Calls GET /api/tags and returns the list of locally installed models.
   */
  async getModels(settings?: ProviderSettings): Promise<ModelInfo[]> {
    const endpoint = this.resolveEndpoint(settings);

    try {
      const response = await this.httpFn({
        url: `${endpoint}/api/tags`,
        method: "GET",
      });

      if (response.status < 200 || response.status >= 300) {
        throw this.buildHttpError(response.status, response.text, endpoint);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(response.text);
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new Error("Ollama API returned malformed response: " + response.text.slice(0, 200));
        }
        throw err;
      }
      if (data && Array.isArray(data.models)) {
        return data.models.map((m: Record<string, unknown>) => ({
          id: String(m.name ?? m.model ?? "unknown"),
          name: String(m.name ?? m.model ?? "unknown"),
          contextWindow: undefined,
          costPer1kInput: 0,
          costPer1kOutput: 0,
        }));
      }
      return [];
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Ollama error")) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Connection refused")) {
        throw new Error(`Cannot connect to Ollama at ${endpoint}. Is Ollama running?`);
      }
      // For other errors (network issues, etc.), return empty list.
      return [];
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
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

    return withRetry(() => this.doOneAttempt(wrappedRequest), {
      maxAttempts: maxRetries + 1,
      canStillRetry: () => !started,
      signal: request.signal,
      onRetry: request.onRetry,
    });
  }

  private async doOneAttempt(request: CompletionRequest): Promise<CompletionResponse> {
    const endpoint = request.endpoint ?? DEFAULT_OLLAMA_ENDPOINT;

    // Stream via Node http/https (streamRequest) when onToken is set. AbortError
    // and API errors must propagate; connection-refused and other transport
    // failures fall through to the non-streaming httpFn path as a safety net.
    if (request.onToken && typeof globalThis.fetch === "function") {
      try {
        return await this.completeStreaming(request, endpoint);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "TimeoutError") throw e;
        if (e instanceof HttpError) throw e;
        if (e instanceof Error && e.message.startsWith("Ollama streaming error")) throw e;
        // Transport-level failure (ECONNREFUSED, etc.) -- fall through to httpFn,
        // which will produce the usual "Is Ollama running?" diagnostic.
      }
    }

    const body = {
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      stream: false,
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (request.apiKey) {
      headers["Authorization"] = `Bearer ${request.apiKey}`;
    }

    let response;
    try {
      response = await withTimeout(
        this.httpFn({
          url: `${endpoint}/v1/chat/completions`,
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
        request.timeoutMs,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Connection refused")) {
        throw new Error(`Cannot connect to Ollama at ${endpoint}. Is Ollama running?`);
      }
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text, endpoint, response.headers);
    }

    return this.parseResponse(response.text, request.model);
  }

  private async completeStreaming(
    request: CompletionRequest,
    endpoint: string,
  ): Promise<CompletionResponse> {
    const body = {
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      stream: true,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (request.apiKey) {
      headers["Authorization"] = `Bearer ${request.apiKey}`;
    }

    let buffer = "";
    const textParts: string[] = [];
    // Captured by the SSE parser when an upstream `error` event arrives.
    let streamError: Error | null = null;

    const result = await streamRequest({
      url: `${endpoint}/v1/chat/completions`,
      method: "POST",
      headers,
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
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            // Ollama emits errors in two shapes:
            //   { "error": "context deadline exceeded" }     -- bare string
            //   { "error": { "message": "...", "type": "..." } } -- OpenAI-compat object
            if (event.error) {
              let errMsg: string;
              let errType: string;
              if (typeof event.error === "string") {
                errMsg = event.error;
                errType = "error";
              } else {
                errMsg = event.error?.message ?? String(event.error);
                errType = event.error?.type ?? "error";
              }
              streamError = new Error(`Ollama streaming error [${errType}]: ${errMsg}`);
              continue;
            }
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              textParts.push(delta);
              request.onToken?.(delta);
            }
          } catch { /* skip */ }
        }
      },
    });

    if (streamError) throw streamError;

    if (result.status < 200 || result.status >= 300) {
      throw this.buildHttpError(result.status, result.fullText, endpoint, result.headers);
    }

    return {
      text: textParts.join(""),
      usage: {},
      model: request.model,
      provider: "ollama",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    const endpoint = this.resolveEndpoint(settings);

    try {
      const response = await this.httpFn({
        url: `${endpoint}/api/tags`,
        method: "GET",
      });

      if (response.status >= 200 && response.status < 300) {
        return null; // success
      }
      return this.buildHttpError(response.status, response.text, endpoint, response.headers).message;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Connection refused")) {
        return `Cannot connect to Ollama at ${endpoint}. Is Ollama running?`;
      }
      return `Ollama connection failed: ${message}. Is Ollama running at ${endpoint}?`;
    }
  }

  /**
   * Build a typed HttpError from an Ollama HTTP error response. Attaches
   * status + headers so the retry helper can read Retry-After.
   */
  private buildHttpError(
    status: number,
    responseText: string,
    _endpoint: string,
    headers: Record<string, string> = {},
  ): HttpError {
    let detail: string;
    try {
      const data = JSON.parse(responseText);
      detail = data?.error ?? data?.message ?? responseText;
    } catch {
      detail = responseText;
    }
    return new HttpError(status, headers, responseText, `Ollama error (${status}): ${detail}`);
  }

  /**
   * Parse an OpenAI-compatible chat completions response.
   *
   * Response shape:
   * ```json
   * {
   *   "choices": [
   *     { "message": { "role": "assistant", "content": "response text" } }
   *   ],
   *   "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
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
        throw new Error("Ollama API returned malformed response: " + responseText.slice(0, 200));
      }
      throw err;
    }

    let text = "";
    if (data && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice.message && typeof choice.message.content === "string") {
        text = choice.message.content.trim();
      }
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens as number | undefined,
          outputTokens: data.usage.completion_tokens as number | undefined,
        }
      : undefined;

    return {
      text,
      usage,
      model,
      provider: this.name,
    };
  }

  private resolveEndpoint(settings?: ProviderSettings): string {
    return (settings?.endpoint as string) ?? DEFAULT_OLLAMA_ENDPOINT;
  }
}
