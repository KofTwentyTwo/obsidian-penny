/**
 * PENNY - Voice Compliance
 *
 * Analyzes prose for adherence to the project's voice rules by computing
 * three metrics:
 * 1. Dialogue-to-narration ratio (how much of the text is spoken dialogue)
 * 2. Long narration sentences (narration sentences exceeding a word threshold)
 * 3. Self-analysis flags (lines matching internal monologue / "she thought" patterns)
 *
 * Called by pipeline.ts after a new version is assembled. Results are
 * included in the review note and activity log so the author can spot
 * voice drift.
 *
 * Pure function -- no Obsidian API dependencies.
 */

import type { VoiceComplianceResult } from "./types";

/** Maximum allowed words in a narration sentence before flagging it as "long". */
const MAX_NARRATION_WORDS = 20;

/**
 * Regex patterns that indicate self-analysis / internal monologue.
 * These are voice violations for projects that forbid narrated inner thought
 * (e.g. the protagonist who only thinks by talking aloud).
 */
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
 * Patterns that match dialogue spans across the supported quote styles
 * (issue #5):
 *
 * - Straight double quotes (`"..."`)
 * - Paired typographic double quotes (U+201C ... U+201D)
 * - Single-quoted dialogue (British style `'...'`). Opener anchored at line
 *   start or after whitespace; closer followed by sentence punctuation,
 *   whitespace, or end-of-line. Apostrophes inside contractions don't qualify
 *   because they are mid-word, not at quote boundaries.
 * - Paired typographic single quotes (U+2018 ... U+2019)
 *
 * Each pattern captures the dialogue text in group 1.
 */
const DIALOGUE_PATTERNS: readonly RegExp[] = [
  /"([^"\n]+?)"/g,
  /\u201C([^\u201D\n]+?)\u201D/g,
  /(?:^|\s)'([^'\n]+?)'(?=[\s.!?,;:]|$)/gm,
  /\u2018([^\u2019\n]+?)\u2019/g,
];

/**
 * Extract dialogue word count from prose. Counts spoken text across all
 * supported quote styles.
 */
function extractDialogueWords(text: string): number {
  let count = 0;
  for (const re of DIALOGUE_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const words = match[1].trim().split(/\s+/);
      count += words.filter((w) => w.length > 0).length;
    }
  }
  return count;
}

/** Strip dialogue spans across all supported quote styles, leaving narration. */
function stripDialogue(text: string): string {
  let out = text;
  for (const re of DIALOGUE_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out;
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
  const narration = stripDialogue(prose);
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
