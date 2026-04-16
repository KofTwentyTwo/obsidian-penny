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

/** Token estimation multiplier: ~1.0 tokens per word for most local models. */
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

      const data = JSON.parse(response.text);
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
    } catch {
      // If Ollama is not running or endpoint is wrong, return empty list.
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

    const response = await this.httpFn({
      url: `${endpoint}/v1/chat/completions`,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

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
      return `Ollama returned status ${response.status}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Ollama connection failed: ${message}. Is Ollama running at ${endpoint}?`;
    }
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
    const data = JSON.parse(responseText);

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
