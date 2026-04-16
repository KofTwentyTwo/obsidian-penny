/**
 * PENNY - Voice Compliance
 *
 * Analyze prose for voice compliance: dialogue ratio, long narration
 * sentences, and self-analysis patterns.
 * Pure function -- no Obsidian API dependencies.
 */

import type { VoiceComplianceResult } from "./types";

/** Maximum allowed words in a narration sentence before flagging. */
const MAX_NARRATION_WORDS = 20;

/** Patterns that indicate self-analysis / internal monologue. */
const SELF_ANALYSIS_PATTERNS: RegExp[] = [
  /\bmy brain\b/i,
  /\bI feel\b/i,
  /\bI realize[d]?\b/i,
  /\bI think about\b/i,
  /\bI notice that I\b/i,
  /\bI wonder(?:ed)?\s+(?:if|whether|why|what|how)\b/i,
  /\bI knew? that\b/i,
  /\bI thought to myself\b/i,
  /\bI told myself\b/i,
  /\bI remind(?:ed)? myself\b/i,
  /\bI couldn't help (?:but )?(?:think|feel|notice)\b/i,
  /\bsomething (?:inside|within) me\b/i,
  /\bI sensed\b/i,
  /\bI became aware\b/i,
  /\bI understood\b/i,
  /\bit occurred to me\b/i,
  /\bit dawned on me\b/i,
  /\bshe thought\b/i,
  /\bshe felt\b/i,
  /\bshe realized\b/i,
];

/**
 * Split text into sentences. Handles common abbreviations and dialogue
 * punctuation reasonably well for fiction.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end.
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Extract dialogue word count from prose.
 * Dialogue = text enclosed in quotation marks (straight or curly).
 */
function extractDialogueWords(text: string): number {
  const dialogueRe = /[""\u201C](.*?)[""\u201D]/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = dialogueRe.exec(text)) !== null) {
    const words = m[1].trim().split(/\s+/);
    count += words.filter((w) => w.length > 0).length;
  }
  return count;
}

function totalWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Check prose for voice compliance.
 *
 * @param prose  The prose text to analyze (body only, no frontmatter).
 * @returns      Voice compliance metrics.
 */
export function checkVoiceCompliance(prose: string): VoiceComplianceResult {
  // --- Dialogue-to-narration ratio ---
  const total = totalWords(prose);
  const dialogueWords = extractDialogueWords(prose);
  const dialogueRatio = total > 0 ? dialogueWords / total : 0;

  // --- Long narration sentences ---
  // Remove dialogue from the text to isolate narration.
  const narration = prose.replace(/[""\u201C].*?[""\u201D]/g, "");
  const sentences = splitSentences(narration);
  const longNarrationSentences: string[] = [];
  for (const sentence of sentences) {
    const wc = totalWords(sentence);
    if (wc > MAX_NARRATION_WORDS) {
      longNarrationSentences.push(sentence);
    }
  }

  // --- Self-analysis pattern scan ---
  const selfAnalysisFlags: string[] = [];
  const proseLines = prose.split("\n");
  for (const line of proseLines) {
    for (const pattern of SELF_ANALYSIS_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(line);
      if (m) {
        // Return the matched fragment plus surrounding context (the line).
        selfAnalysisFlags.push(line.trim());
        break; // One flag per line max.
      }
    }
  }

  return {
    dialogueRatio: Math.round(dialogueRatio * 100) / 100,
    longNarrationSentences,
    selfAnalysisFlags,
  };
}
