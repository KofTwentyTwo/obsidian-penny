/**
 * PENNY - Ollama Provider
 *
 * Implements LLMService for Ollama's OpenAI-compatible endpoint.
 * Uses an injected HTTP function (Obsidian's requestUrl) so this module
 * has no direct Obsidian API dependency.
 *
 * Ollama exposes two relevant APIs:
 * - /api/tags          -- list locally available models
 * - /v1/chat/completions -- OpenAI-compatible chat completions
 */

import type {
  LLMService,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  ProviderSettings,
  HttpFn,
} from "./service";

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
    const endpoint = request.endpoint ?? DEFAULT_OLLAMA_ENDPOINT;

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
      response = await this.httpFn({
        url: `${endpoint}/v1/chat/completions`,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Connection refused")) {
        throw new Error(`Cannot connect to Ollama at ${endpoint}. Is Ollama running?`);
      }
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text, endpoint);
    }

    return this.parseResponse(response.text, request.model);
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
      return this.buildHttpError(response.status, response.text, endpoint).message;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed") || message.includes("Connection refused")) {
        return `Cannot connect to Ollama at ${endpoint}. Is Ollama running?`;
      }
      return `Ollama connection failed: ${message}. Is Ollama running at ${endpoint}?`;
    }
  }

  /**
   * Build a descriptive Error from an Ollama HTTP error response.
   */
  private buildHttpError(status: number, responseText: string, _endpoint: string): Error {
    let detail: string;
    try {
      const data = JSON.parse(responseText);
      detail = data?.error ?? data?.message ?? responseText;
    } catch {
      detail = responseText;
    }
    return new Error(`Ollama error (${status}): ${detail}`);
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
