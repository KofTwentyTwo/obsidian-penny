/**
 * PENNY - Provider Exports
 *
 * Barrel file that re-exports all provider types, implementations,
 * router, and registry. Also provides createRegistry(), the convenience
 * factory used by main.ts to bootstrap the provider system.
 *
 * Import from `./providers` (this file) rather than from individual
 * provider files to keep import paths clean.
 */

// Service interface and types
export type {
  LLMService,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  ProviderSettings,
  HttpFn,
  HttpRequestParam,
  HttpResponse,
} from "./service";

// Router
export {
  TAG_COMPLEXITY,
  getRoute,
} from "./router";
export type {
  ComplexityTier,
  RouteConfig,
  ResolvedRoute,
} from "./router";

// Registry
export { ProviderRegistry } from "./registry";

// Provider implementations
export { AnthropicProvider, ANTHROPIC_MODELS } from "./anthropic";
export { OllamaProvider } from "./ollama";

// -- Convenience factory --

import type { HttpFn } from "./service";
import { ProviderRegistry } from "./registry";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

/**
 * Create a fresh ProviderRegistry pre-populated with all built-in providers.
 *
 * The plugin shell calls this at startup, passing Obsidian's `requestUrl`
 * (adapted to the HttpFn signature) so providers can make HTTP calls
 * without importing Obsidian directly.
 *
 * ```ts
 * import { requestUrl } from "obsidian";
 * import { createRegistry } from "./providers";
 *
 * const reg = createRegistry((params) => requestUrl(params));
 * ```
 */
export function createRegistry(httpFn: HttpFn): ProviderRegistry {
  const reg = new ProviderRegistry();
  reg.register(new AnthropicProvider(httpFn));
  reg.register(new OllamaProvider(httpFn));
  return reg;
}
