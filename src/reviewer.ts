/**
 * PENNY - Review Note Generation
 *
 * Produces structured markdown review notes after a processing pass.
 * Each review note summarizes what PENNY did: which annotations were
 * processed, word count changes, voice compliance metrics, and any
 * flags for author attention.
 *
 * Review files are written to: `{reviewsFolder}/{book}/{chapter}.v{N}-review.md`
 *
 * Called by pipeline.ts to generate the review content string.
 * File I/O (creating the review file) is handled by commands.ts.
 *
 * Pure function -- no side effects, no file I/O.
 */

import type { ReviewData, AnnotationChange, ReviewFlag } from "./types";

/**
 * Generate the full markdown content for a review note file.
 *
 * Output format follows the spec:
 * - Header with metadata
 * - Per-annotation change summaries
 * - Flags for author attention
 * - Voice compliance metrics
 * - Word count delta
 *
 * @param data - All review data collected during the processing pass
 * @returns Markdown string ready to write to a review file
 */
export function generateReview(data: ReviewData): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${data.chapter} Review -- v${data.version}`);
  lines.push("");
  lines.push(`**Generated:** ${data.timestamp}`);
  lines.push(`**Annotations processed:** ${data.annotationsProcessed}`);
  lines.push(
    `**Annotations skipped (NOTE/RESEARCH):** ${data.annotationsSkipped}`
  );
  lines.push("");

  // Changes Made
  lines.push("## Changes Made");
  lines.push("");

  if (data.changes.length === 0) {
    lines.push("No annotations were processed in this pass.");
    lines.push("");
  } else {
    data.changes.forEach((change, index) => {
      lines.push(formatChange(change, index + 1));
      lines.push("");
    });
  }

  // Flags for Author
  lines.push("## Flags for Author");
  lines.push("");

  if (data.flags.length === 0) {
    lines.push("No flags raised.");
    lines.push("");
  } else {
    data.flags.forEach((flag) => {
      lines.push(formatFlag(flag));
    });
    lines.push("");
  }

  // Voice Compliance
  lines.push("## Voice Compliance");
  lines.push("");
  lines.push(
    `- Dialogue ratio: ${(data.voiceCompliance.dialogueRatio * 100).toFixed(1)}%`
  );
  lines.push(
    `- Long narration sentences: ${data.voiceCompliance.longNarrationSentences.length}`
  );
  if (data.voiceCompliance.longNarrationSentences.length > 0) {
    data.voiceCompliance.longNarrationSentences.forEach((s) => {
      lines.push(`  - "${truncate(s, 80)}"`);
    });
  }
  lines.push(
    `- Self-analysis flags: ${data.voiceCompliance.selfAnalysisFlags.length}`
  );
  if (data.voiceCompliance.selfAnalysisFlags.length > 0) {
    data.voiceCompliance.selfAnalysisFlags.forEach((s) => {
      lines.push(`  - "${truncate(s, 80)}"`);
    });
  }
  lines.push("");

  // Word Count
  lines.push("## Word Count");
  lines.push("");
  lines.push(`- Previous: ${data.wordCountBefore} words`);
  lines.push(`- Current: ${data.wordCountAfter} words`);

  const delta = data.wordCountAfter - data.wordCountBefore;
  const sign = delta >= 0 ? "+" : "";
  lines.push(`- Delta: ${sign}${delta} words`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a single annotation change entry.
 */
function formatChange(change: AnnotationChange, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index}. [${change.tag}] Line ${change.lineStart}`);
  lines.push(`- **Instruction:** "${truncate(change.instruction, 120)}"`);
  lines.push(`- **Original:** ${change.originalWordCount} words`);
  lines.push(`- **Revised:** ${change.revisedWordCount} words`);
  if (change.contextFilesUsed.length > 0) {
    lines.push(
      `- **Context used:** ${change.contextFilesUsed.join(", ")}`
    );
  }
  return lines.join("\n");
}

/**
 * Format a single review flag.
 */
function formatFlag(flag: ReviewFlag): string {
  const label = flag.type.toUpperCase();
  return `- [${label}] Line ${flag.line}: "${truncate(flag.description, 100)}"`;
}

/**
 * Truncate a string to a maximum length, appending ellipsis if needed.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Derive the review file path for a given chapter and version.
 *
 * @param reviewsFolder - Base reviews folder (e.g., "07-reviews")
 * @param book - Book identifier (e.g., "book-1")
 * @param chapter - Chapter identifier (e.g., "ch-05")
 * @param version - Version number
 * @returns Full path for the review file
 */
export function getReviewFilePath(
  reviewsFolder: string,
  book: string,
  chapter: string,
  version: number
): string {
  return `${reviewsFolder}/${book}/${chapter}.v${version}-review.md`;
}
