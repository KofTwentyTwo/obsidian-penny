/**
 * PENNY - OpenAI Provider
 *
 * Implements the LLMService interface for the OpenAI Chat Completions API.
 * Supports GPT-4.1, o3, and o4-mini model families.
 *
 * Key features:
 * - Static model catalog (OPENAI_MODELS) for offline settings display
 * - Structured error handling with OpenAI-specific status codes
 * - Bearer token authentication via Authorization header
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
import { streamRequest, withTimeout } from "./node-stream";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

/**
 * Static model catalog for OpenAI.
 *
 * Intentionally hardcoded for offline/static use. Update manually
 * when OpenAI ships new model aliases.
 *
 * Context windows current as of April 2026.
 */
export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1047576,
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    contextWindow: 1047576,
  },
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    contextWindow: 1047576,
  },
  {
    id: "o3",
    name: "o3",
    contextWindow: 200000,
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    contextWindow: 200000,
  },
];

/** Token estimation multiplier: ~1.0 tokens per word for OpenAI's tokenizer. */
const TOKEN_MULTIPLIER = 1.0;

export class OpenAIProvider implements LLMService {
  readonly name = "openai";
  readonly requiresApiKey = true;
  readonly tokenMultiplier = 1.0;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return OPENAI_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }

    // Stream via Node https (streamRequest) when onToken is set. AbortError
    // and API errors must propagate; only true transport failures fall back.
    if (request.onToken && typeof globalThis.fetch === "function") {
      try {
        return await this.completeStreaming(request, apiKey);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof Error && e.message.startsWith("OpenAI API error")) throw e;
        // Transport-level failure -- fall through to httpFn.
      }
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
    };

    const response = await withTimeout(
      this.httpFn({
        url: OPENAI_API_URL,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      request.timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text);
    }

    return this.parseResponse(response.text, request.model);
  }

  private async completeStreaming(
    request: CompletionRequest,
    apiKey: string,
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

    let buffer = "";
    const textParts: string[] = [];

    const result = await streamRequest({
      url: OPENAI_API_URL,
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
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
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              textParts.push(delta);
              request.onToken?.(delta);
            }
          } catch { /* skip */ }
        }
      },
    });

    if (result.status < 200 || result.status >= 300) {
      throw this.buildHttpError(result.status, result.fullText);
    }

    return {
      text: textParts.join(""),
      usage: {},
      model: request.model,
      provider: "openai",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    if (!settings.apiKey) {
      return "OpenAI API key is required";
    }

    try {
      const response = await this.httpFn({
        url: OPENAI_MODELS_URL,
        method: "GET",
        headers: {
          "Authorization": `Bearer ${settings.apiKey}`,
        },
      });

      if (response.status >= 200 && response.status < 300) {
        return null; // success
      }
      return this.buildHttpError(response.status, response.text).message;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `OpenAI connection failed: ${message}`;
    }
  }

  /**
   * Build a descriptive Error from an OpenAI HTTP error response.
   * Attempts to parse the OpenAI error JSON format; falls back to raw text.
   */
  private buildHttpError(status: number, responseText: string): Error {
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

    if (status === 401) {
      return new Error(`OpenAI API error (401): Invalid API key. ${detail}`);
    }
    if (status === 429) {
      return new Error(`OpenAI API error (429): Rate limited. ${detail}`);
    }
    return new Error(`OpenAI API error (${status}): ${detail}`);
  }

  /**
   * Parse an OpenAI Chat Completions API response.
   *
   * Response shape:
   * ```json
   * {
   *   "choices": [
   *     { "message": { "role": "assistant", "content": "response text" } }
   *   ],
   *   "usage": { "prompt_tokens": 100, "completion_tokens": 50 },
   *   "model": "gpt-4.1"
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
        throw new Error("OpenAI API returned malformed response: " + responseText.slice(0, 200));
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
}
