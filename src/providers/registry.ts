/**
 * PENNY - Provider Registry
 *
 * A simple name-keyed registry that stores LLMService instances.
 * Populated at plugin load by createRegistry() in providers/index.ts.
 * Consumed by:
 * - pipeline.ts (getProvider callback looks up providers by name)
 * - settings.ts (lists providers for route dropdowns, calls testConnection)
 * - commands.ts (requireProvider checks that configured providers exist)
 *
 * The registry is a thin Map wrapper -- no lifecycle management or
 * lazy initialization. Providers are fully constructed at registration time.
 */

import type { LLMService } from "./service";

/** Simple name-keyed store for LLM provider instances. */
export class ProviderRegistry {
  private providers: Map<string, LLMService> = new Map();

  /** Register a provider. Overwrites any existing provider with the same name. */
  register(provider: LLMService): void {
    this.providers.set(provider.name, provider);
  }

  /** Get a provider by name. Returns undefined if not registered. */
  get(name: string): LLMService | undefined {
    return this.providers.get(name);
  }

  /** Get all registered providers. */
  getAll(): LLMService[] {
    return Array.from(this.providers.values());
  }

  /** Get names of all registered providers. */
  getNames(): string[] {
    return Array.from(this.providers.keys());
  }
}