/**
 * PENNY - Anthropic Claude Provider
 *
 * Implements LLMService for the Anthropic Messages API.
 * Uses an injected HTTP function (Obsidian's requestUrl) so this module
 * has no direct Obsidian API dependency.
 */

import type {
  LLMService,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  ProviderSettings,
  HttpFn,
} from "./service";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Static model catalog for Anthropic. */
const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    contextWindow: 200000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    contextWindow: 200000,
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

/** Token estimation multiplier: ~1.33 tokens per word for Anthropic models. */
const TOKEN_MULTIPLIER = 1.33;

export class AnthropicProvider implements LLMService {
  readonly name = "anthropic";
  readonly requiresApiKey = true;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }

    const body = {
      model: request.model,
      max_tokens: request.maxTokens,
      thinking: { type: "enabled", budget_tokens: Math.min(10000, Math.floor(request.maxTokens * 0.5)) },
      system: request.systemPrompt,
      messages: [
        { role: "user", content: request.userPrompt },
      ],
    };

    const response = await this.httpFn({
      url: ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return this.parseResponse(response.text, request.model);
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
      return `Anthropic API returned status ${response.status}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Anthropic connection failed: ${message}`;
    }
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
    const data = JSON.parse(responseText);

    let text = "";
    if (data && Array.isArray(data.content)) {
      const textBlock = data.content.find(
        (block: Record<string, unknown>) => block.type === "text",
      );
      if (textBlock && typeof textBlock.text === "string") {
        text = textBlock.text.trim();
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
