/**
 * PENNY - Context Assembly (pure logic)
 *
 * Assembles context from file contents for a revision prompt.
 * The Obsidian file-reading happens in the plugin shell; this module
 * takes string contents and assembles them by priority with token budgeting.
 * Pure function -- no Obsidian API dependencies.
 */

import type { AnnotatedSection, AssembledContext, PennySettings } from "./types";

/**
 * Files provided to the context assembler.
 * All fields are string contents (already read from the vault).
 */
export interface ContextFiles {
  chapter: string;
  voiceTests?: string;
  styleGuide?: string;
  outline?: string;
  characters?: string[];
  wiki?: string[];
  seriesBible?: string;
  themes?: string;
}

/**
 * Estimate token count from text.
 *
 * @param text       The text to estimate tokens for.
 * @param multiplier Words-to-tokens ratio. Defaults to 1.33 (Anthropic).
 *                   Ollama-style providers may use 1.0 or a different value.
 */
export function estimateTokens(text: string, multiplier = 1.33): number {
  if (!text || text.trim().length === 0) return 0;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.ceil(wordCount * multiplier);
}

/**
 * Select the most relevant voice test section for the characters in the scene.
 *
 * The voice tests file is expected to have sections headed by character names
 * (e.g. `## Tim`, `## Darin`). If any detected character name appears in a
 * heading, that section is included. If no match, the full file is returned
 * (up to a reasonable limit).
 */
export function selectVoiceTestSection(
  voiceTestsContent: string,
  characters: string[],
): string {
  if (!voiceTestsContent) return "";
  if (characters.length === 0) return voiceTestsContent;

  const lines = voiceTestsContent.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join("\n") });
      }
      currentHeading = headingMatch[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  // Push final section.
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, content: currentLines.join("\n") });
  }

  // Match character names (case-insensitive) against section headings.
  const lowerChars = characters.map((c) => c.toLowerCase());
  const matched = sections.filter((s) =>
    lowerChars.some((c) => s.heading.toLowerCase().includes(c)),
  );

  if (matched.length > 0) {
    return matched.map((s) => s.content).join("\n\n");
  }

  // No match -- return full content.
  return voiceTestsContent;
}

/**
 * Assemble context for a revision prompt.
 *
 * Loads content by priority order, truncating from the bottom (lowest
 * priority) if the token budget is exceeded. The annotation's passage
 * and instruction are never truncated.
 *
 * Priority (from spec):
 *   1. Full current chapter (always)
 *   2. Relevant voice test section (always if available)
 *   3. Style guide (always if available)
 *   4. Book plot outline (always if available)
 *   5. Character sheets (if characters in scene)
 *   6. Wiki entries (if terms match)
 *   7. Series bible (if space permits)
 *   8. Themes (if space permits)
 */
/**
 * @param tokenMultiplier  Words-to-tokens ratio for the active provider.
 *                         Defaults to 1.33 (Anthropic). Pass the value from
 *                         the provider's `tokenEstimationMultiplier()`.
 */
export function assembleContext(
  files: ContextFiles,
  annotation: AnnotatedSection,
  settings: PennySettings,
  tokenMultiplier = 1.33,
): AssembledContext {
  const budget = settings.contextBudget;
  let remaining = budget;

  // Priority 1: chapter (always included, never truncated).
  const chapter = files.chapter;
  remaining -= estimateTokens(chapter, tokenMultiplier);

  // Priority 2: voice tests (budget-gated like all other context).
  let voiceTests = "";
  if (files.voiceTests && remaining > 0) {
    // We don't know characters yet at this layer, so include full voice tests.
    // The caller can pre-filter using selectVoiceTestSection.
    voiceTests = files.voiceTests;
    remaining -= estimateTokens(voiceTests, tokenMultiplier);
  }

  // Priority 3: style guide.
  let styleGuide = "";
  if (files.styleGuide && remaining > 0) {
    styleGuide = files.styleGuide;
    remaining -= estimateTokens(styleGuide, tokenMultiplier);
  }

  // Priority 4: outline.
  let outline = "";
  if (files.outline && remaining > 0) {
    outline = files.outline;
    remaining -= estimateTokens(outline, tokenMultiplier);
  }

  // Priority 5: characters.
  let characters = "";
  if (files.characters && files.characters.length > 0 && remaining > 0) {
    const combined = files.characters.join("\n\n---\n\n");
    const tokens = estimateTokens(combined, tokenMultiplier);
    if (tokens <= remaining) {
      characters = combined;
      remaining -= tokens;
    } else {
      // Include as many character files as fit.
      const parts: string[] = [];
      for (const charFile of files.characters) {
        const t = estimateTokens(charFile, tokenMultiplier);
        if (t <= remaining) {
          parts.push(charFile);
          remaining -= t;
        }
      }
      characters = parts.join("\n\n---\n\n");
    }
  }

  // Priority 6: wiki.
  let wiki = "";
  if (files.wiki && files.wiki.length > 0 && remaining > 0) {
    const combined = files.wiki.join("\n\n---\n\n");
    const tokens = estimateTokens(combined, tokenMultiplier);
    if (tokens <= remaining) {
      wiki = combined;
      remaining -= tokens;
    } else {
      const parts: string[] = [];
      for (const entry of files.wiki) {
        const t = estimateTokens(entry, tokenMultiplier);
        if (t <= remaining) {
          parts.push(entry);
          remaining -= t;
        }
      }
      wiki = parts.join("\n\n---\n\n");
    }
  }

  // Priority 7: series bible.
  let seriesBible = "";
  if (files.seriesBible && remaining > 0) {
    const tokens = estimateTokens(files.seriesBible, tokenMultiplier);
    if (tokens <= remaining) {
      seriesBible = files.seriesBible;
      remaining -= tokens;
    }
  }

  // Priority 8: themes.
  let themes = "";
  if (files.themes && remaining > 0) {
    const tokens = estimateTokens(files.themes, tokenMultiplier);
    if (tokens <= remaining) {
      themes = files.themes;
      remaining -= tokens;
    }
  }

  // Voice rules from settings.
  const voiceRules = settings.customVoiceRules || "";

  const totalTokenEstimate = budget - remaining;

  return {
    chapter,
    voiceTests,
    styleGuide,
    outline,
    characters,
    wiki,
    seriesBible,
    themes,
    voiceRules,
    totalTokenEstimate,
  };
}
