/**
 * PENNY - Version Assembly
 *
 * Builds a new chapter version by splicing LLM-produced revisions into
 * the original chapter text. Called by pipeline.ts after all annotations
 * have been processed.
 *
 * Key design decisions:
 * - Processes revisions bottom-up (highest lineStart first) so that
 *   earlier line numbers remain valid as later ranges are replaced.
 * - Detects overlapping annotation ranges and keeps the larger-scope
 *   one, reporting the smaller as a skipped overlap in the result.
 * - Strips processed actionable annotations from the output while
 *   preserving passthrough annotations (NOTE, RESEARCH).
 * - Inserts `%% REVISED(vN) %%` markers after each replacement for
 *   traceability.
 *
 * Pure function -- no Obsidian API dependencies.
 */

import type { AnnotatedSection } from "./types";
import { PASSTHROUGH_TAGS } from "./types";

/**
 * Non-global regex pattern for matching annotations. A new RegExp with the 'g'
 * flag is created from this source per use-site to avoid shared lastIndex state.
 */
const ANNOTATION_PATTERN = /%%\s*([A-Z]+)\s*:\s*(.*?)\s*%%/;

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function isPassthrough(tag: string): boolean {
  return (PASSTHROUGH_TAGS as readonly string[]).includes(tag);
}

/** Info about an annotation that was skipped because its range overlapped a larger annotation. */
export interface SkippedOverlap {
  /** The tag of the skipped annotation. */
  tag: string;
  /** The starting line of the skipped annotation. */
  line: number;
}

/**
 * Result of assembleNewVersion.
 * Contains the fully assembled chapter text and metadata about any
 * annotations that were dropped due to overlapping ranges.
 */
export interface AssemblyResult {
  /** The new chapter content with revisions spliced in and processed annotations removed. */
  content: string;
  /** Annotations that were skipped because they overlapped a larger-scope annotation. */
  skippedOverlaps: SkippedOverlap[];
}

/**
 * Assemble a new version of the chapter by applying revisions.
 *
 * @param originalContent  The full text of the current chapter version.
 * @param revisions        Array of { annotation, revisedText } pairs.  Each
 *                         annotation's lineStart/lineEnd mark the range to
 *                         replace, and `revisedText` is the AI-produced
 *                         replacement prose.
 * @param version          The new version number (used in REVISED markers).
 * @returns                The assembled new-version content string.
 */
export function assembleNewVersion(
  originalContent: string,
  revisions: Array<{ annotation: AnnotatedSection; revisedText: string }>,
  version: number = 1,
): AssemblyResult {
  const lines = originalContent.split("\n");

  // Sort revisions bottom-up (highest lineStart first) so that replacements
  // don't shift line numbers for earlier entries.
  const sorted = [...revisions].sort((a, b) => b.annotation.lineStart - a.annotation.lineStart);

  // Handle overlapping ranges: keep the annotation with the larger scope (more
  // lines) and skip the smaller one. Skipped annotations are recorded in a
  // flags list so the review notes can report them.
  const resolved: typeof sorted = [];
  const skippedOverlaps: Array<{ tag: string; line: number }> = [];
  for (const rev of sorted) {
    if (resolved.length === 0) {
      resolved.push(rev);
      continue;
    }
    const prev = resolved[resolved.length - 1];
    // Since sorted descending by lineStart, prev.lineStart >= rev.lineStart
    // Same-line inline annotations are NOT overlaps -- they target different parts of the line
    const bothInline = prev.annotation.scope === "inline" && rev.annotation.scope === "inline"
      && prev.annotation.lineStart === rev.annotation.lineStart;
    // Overlap: prev.lineStart <= rev.lineEnd (prev starts before rev ends)
    if (!bothInline && prev.annotation.lineStart <= rev.annotation.lineEnd) {
      // Keep the annotation with the larger scope; skip the smaller one
      const prevSpan = prev.annotation.lineEnd - prev.annotation.lineStart;
      const revSpan = rev.annotation.lineEnd - rev.annotation.lineStart;
      if (revSpan > prevSpan) {
        // The new (larger) one replaces the previous (smaller) one
        skippedOverlaps.push({ tag: prev.annotation.tag, line: prev.annotation.lineStart });
        resolved[resolved.length - 1] = rev;
      } else {
        // Keep previous, skip current
        skippedOverlaps.push({ tag: rev.annotation.tag, line: rev.annotation.lineStart });
      }
    } else {
      resolved.push(rev);
    }
  }

  for (const { annotation, revisedText } of resolved) {
    // Skip passthrough tags -- they should never appear in revisions, but
    // guard just in case.
    if (isPassthrough(annotation.tag)) continue;

    const origSlice = lines.slice(annotation.lineStart, annotation.lineEnd + 1).join("\n");
    const origWords = wordCount(origSlice);
    const newWords = wordCount(revisedText);

    // Build the REVISED marker.
    const summary = annotation.instruction.length > 60
      ? annotation.instruction.slice(0, 57) + "..."
      : annotation.instruction;
    const marker = `%% REVISED(v${version}): [${annotation.tag}] "${summary}" -- ${origWords} words -> ${newWords} words %%`;

    // Build replacement lines: revised text + marker.
    const replacementLines = [...revisedText.split("\n"), marker];

    // Splice into the line array.
    lines.splice(
      annotation.lineStart,
      annotation.lineEnd - annotation.lineStart + 1,
      ...replacementLines,
    );
  }

  // Remove processed (actionable) annotations from the result.
  // Passthrough annotations (NOTE, RESEARCH) are kept.
  const cleaned = lines.filter((line) => {
    // Check if this line is purely an annotation (no other content).
    const withoutAnnotations = line.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), "").trim();
    if (withoutAnnotations.length > 0) {
      // Line has content beyond annotations.  Strip only actionable annotations.
      return true;
    }
    // Line is purely annotation(s).  Keep it only if ALL annotations on it
    // are passthrough.
    let hasActionable = false;
    let hasAny = false;
    for (const m of line.matchAll(new RegExp(ANNOTATION_PATTERN.source, "g"))) {
      hasAny = true;
      if (!isPassthrough(m[1])) {
        hasActionable = true;
      }
    }
    // If no annotations matched at all, keep the line (it's just whitespace).
    if (!hasAny) return true;
    // If all annotations are passthrough, keep.  Otherwise remove the line.
    return !hasActionable;
  });

  // For lines that contain inline actionable annotations mixed with text,
  // strip the annotation portion but keep the text.
  const final = cleaned.map((line) => {
    if (!ANNOTATION_PATTERN.test(line)) return line;

    // Check if any annotation on this line is actionable.
    let hasActionable = false;
    for (const m of line.matchAll(new RegExp(ANNOTATION_PATTERN.source, "g"))) {
      if (!isPassthrough(m[1])) hasActionable = true;
    }
    if (!hasActionable) return line;

    // Strip only actionable annotations, keep passthrough.
    return line.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), (full, tag) => {
      if (isPassthrough(tag)) return full;
      return "";
    }).trimEnd();
  });

  return { content: final.join("\n"), skippedOverlaps };
}
