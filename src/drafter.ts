/**
 * PENNY - Prompt Construction & Provider Dispatch
 *
 * Build the system and user prompts from assembled context and an annotation.
 * Dispatch completion requests to the active LLM provider.
 * Pure functions -- no Obsidian API dependencies (except callProvider which
 * accepts the provider as a parameter).
 */

import type { AssembledContext, AnnotatedSection } from "./types";
import type { CompletionRequest, CompletionResponse } from "./providers/service";

/**
 * All placeholders that can appear in the system prompt template.
 * Each maps to either a field on AssembledContext or a field on
 * AnnotatedSection.
 */
const SECTION_PLACEHOLDERS: Record<string, { label: string; contextKey?: keyof AssembledContext }> = {
  "{voice_rules}": { label: "CRITICAL VOICE RULES", contextKey: "voiceRules" },
  "{voice_tests}": { label: "Voice Reference", contextKey: "voiceTests" },
  "{style_guide}": { label: "Style Guide", contextKey: "styleGuide" },
  "{outline}": { label: "Plot Outline", contextKey: "outline" },
  "{characters}": { label: "Character References", contextKey: "characters" },
  "{wiki}": { label: "Wiki/Lore References", contextKey: "wiki" },
  "{chapter}": { label: "Current Chapter", contextKey: "chapter" },
};

/**
 * Build the system and user prompts for an API call.
 *
 * @param context     Assembled context (from context.ts).
 * @param annotation  The annotation being processed.
 * @param template    The system prompt template (with `{placeholders}`).
 * @returns           `{ system, user }` strings ready for the API call.
 */
export function buildPrompt(
  context: AssembledContext,
  annotation: AnnotatedSection,
  template: string,
): { system: string; user: string } {
  let system = template;

  // Replace context-sourced placeholders.
  // When the context value is empty/undefined, remove the entire section
  // (the heading line + placeholder line) to keep the prompt clean.
  for (const [placeholder, meta] of Object.entries(SECTION_PLACEHOLDERS)) {
    const value = meta.contextKey ? context[meta.contextKey] : "";
    if (typeof value === "string" && value.trim().length > 0) {
      system = system.replace(placeholder, value);
    } else {
      // Remove the section.  Look for the heading above and the placeholder,
      // and remove both lines.
      const headingRe = new RegExp(
        `(?:^|\\n)##\\s+${escapeRegExp(meta.label)}\\s*\\n\\s*${escapeRegExp(placeholder)}\\s*(?:\\n|$)`,
        "g",
      );
      system = system.replace(headingRe, "\n");
      // If that didn't match (template was customised), just replace inline.
      system = system.replace(placeholder, "");
    }
  }

  // Replace annotation-level placeholders.
  system = system.replace(/\{tag\}/g, annotation.tag);
  system = system.replace(/\{lineStart\}/g, String(annotation.lineStart));
  system = system.replace(/\{lineEnd\}/g, String(annotation.lineEnd));
  system = system.replace(/\{passage\}/g, annotation.originalText);
  system = system.replace(/\{instruction\}/g, annotation.instruction);

  // Clean up any double blank lines left by section removal.
  system = system.replace(/\n{3,}/g, "\n\n");

  // The user prompt is the focused task.
  const user = [
    `## Task: ${annotation.tag}`,
    "",
    `### Passage to Revise (Lines ${annotation.lineStart}-${annotation.lineEnd})`,
    annotation.originalText,
    "",
    `### Author's Instruction`,
    annotation.instruction,
    "",
    "---",
    "",
    "Write the revised passage. Output ONLY the replacement text.",
  ].join("\n");

  return { system: system.trim(), user };
}

/**
 * Minimal provider interface accepted by callProvider. Matches
 * PipelineProvider from pipeline.ts -- only the complete() method is needed.
 */
interface CallableProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/**
 * Send a completion request through the given LLM provider.
 *
 * The provider already has the HTTP function injected at construction time
 * (via the registry), so callers just need to pass the request with the
 * appropriate API key and endpoint from settings.
 *
 * @param provider  Any object with a complete() method (LLMService, PipelineProvider, etc.)
 * @param request   The completion request (systemPrompt, userPrompt, model, maxTokens,
 *                  plus optional apiKey and endpoint for the provider).
 * @returns         The provider's response including the generated text.
 */
export async function callProvider(
  provider: CallableProvider,
  request: CompletionRequest,
): Promise<CompletionResponse> {
  return provider.complete(request);
}

/** Escape special regex characters in a string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
