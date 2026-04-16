/**
 * PENNY - Annotation Parser
 *
 * Parses `%% TAG: instruction %%` annotations from markdown text.
 * Pure function -- no Obsidian API dependencies.
 */

import {
  type AnnotatedSection,
  type AnnotationTag,
  ACTIONABLE_TAGS,
  PASSTHROUGH_TAGS,
  ALL_TAGS,
} from "./types";

/** Single-line annotation pattern. */
const ANNOTATION_PATTERN = /%%\s*([A-Z]+)\s*:\s*(.*?)\s*%%/;

/** Multi-line annotation: opening %% TAG: ... without closing %% on same line */
const MULTILINE_OPEN = /%%\s*([A-Z]+)\s*:\s*(.*)/;
const MULTILINE_CLOSE = /(.*)%%/;

/**
 * Strip all annotation markers from a string (single-line and multi-line).
 */
function stripAnnotations(text: string): string {
  // Strip single-line annotations first
  let result = text.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), "");
  // Strip multi-line annotation fragments (lines that are part of %% ... %% blocks)
  result = result.replace(/%%[\s\S]*?%%/g, "");
  return result;
}

/**
 * Generate a deterministic hash from the annotation's identity fields.
 * Uses a simple hash (cyrb53 variant) since we need pure-function behavior
 * that runs in both Node and Obsidian's Electron renderer without crypto
 * dependencies.  Hex-encoded, truncated to 12 chars to match the spec's
 * example format `"a1b2c3d4e5f6"`.
 */
function hashAnnotation(tag: string, instruction: string, originalText: string): string {
  const input = `${tag}|${instruction}|${originalText}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  // Use slice(-12) to keep the least-significant (most entropic) hex digits
  return n.toString(16).padStart(12, "0").slice(-12);
}

function isValidTag(tag: string): tag is AnnotationTag {
  return (ALL_TAGS as readonly string[]).includes(tag);
}

function isActionableTag(tag: string): boolean {
  return (ACTIONABLE_TAGS as readonly string[]).includes(tag);
}

/** True when a line is a markdown heading */
function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/** Return the heading level (1-6) or 0 if not a heading. */
function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

/** True when the line is blank / whitespace-only. */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Determine the scope, lineStart, and lineEnd for an annotation found at
 * `annotationLineIndex` in the array of `lines`.
 */
function resolveScope(
  lines: string[],
  annotationLineIndex: number,
): { scope: "inline" | "paragraph" | "section"; lineStart: number; lineEnd: number } {
  const annoLine = lines[annotationLineIndex];

  // --- Check: is the annotation inline (shares a line with other text)? ---
  const stripped = stripAnnotations(annoLine).trim();
  if (stripped.length > 0) {
    // Inline: the annotation sits within a paragraph line.
    // Scope = that single line.
    return { scope: "inline", lineStart: annotationLineIndex, lineEnd: annotationLineIndex };
  }

  // The annotation is on its own line.  Look at what comes above.

  // Walk backwards to find the first non-blank line above the annotation.
  let above = annotationLineIndex - 1;
  while (above >= 0 && isBlank(lines[above])) {
    above--;
  }

  // --- Check: is the line above a heading? ---
  if (above >= 0 && isHeading(lines[above])) {
    // Section scope: everything from the heading to the next heading of equal
    // or higher level (or EOF).
    const level = headingLevel(lines[above]);
    let end = annotationLineIndex + 1;
    while (end < lines.length) {
      const hl = headingLevel(lines[end]);
      if (hl > 0 && hl <= level) break;
      end++;
    }
    // lineEnd is the last line before the next heading (or last line of file).
    return { scope: "section", lineStart: above, lineEnd: end - 1 };
  }

  // --- Otherwise: paragraph scope (paragraph immediately above). ---
  // Walk upward from `above` to find the start of that paragraph (first blank
  // line or start of file).
  if (above < 0) {
    // Nothing above -- degenerate; point at annotation itself.
    return { scope: "paragraph", lineStart: annotationLineIndex, lineEnd: annotationLineIndex };
  }
  let paraStart = above;
  while (paraStart > 0 && !isBlank(lines[paraStart - 1]) && !isHeading(lines[paraStart - 1]) && !lines[paraStart - 1].trim().startsWith("%% REVISED(")) {
    paraStart--;
  }
  return { scope: "paragraph", lineStart: paraStart, lineEnd: annotationLineIndex };
}

/**
 * Parse all annotations from a markdown string.
 *
 * Returns an array of `AnnotatedSection` objects sorted by `lineStart`
 * ascending.  Malformed annotations (unrecognised tags, missing instruction)
 * are silently skipped.
 */
export function parseAnnotations(content: string): AnnotatedSection[] {
  const lines = content.split("\n");
  const results: AnnotatedSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try single-line annotations first
    const lineRegex = new RegExp(ANNOTATION_PATTERN.source, "g");
    let foundSingleLine = false;

    for (const match of line.matchAll(lineRegex)) {
      foundSingleLine = true;
      const tag = match[1];
      const instruction = match[2].trim();

      // Skip malformed: unrecognised tag or empty instruction.
      if (!isValidTag(tag) || instruction.length === 0) {
        continue;
      }

      const { scope, lineStart, lineEnd } = resolveScope(lines, i);

      // Build the original text (the passage the annotation applies to).
      // For inline scope the original text is the line content minus annotations.
      // For paragraph / section the original text is the range [lineStart..lineEnd]
      // excluding lines that are purely annotations.
      let originalText: string;
      if (scope === "inline") {
        originalText = stripAnnotations(line).trim();
      } else {
        const passageLines: string[] = [];
        for (let j = lineStart; j <= lineEnd; j++) {
          const strippedLine = stripAnnotations(lines[j]).trim();
          // Keep heading lines, non-blank content lines.
          if (strippedLine.length > 0 || isBlank(lines[j])) {
            passageLines.push(stripAnnotations(lines[j]).trimEnd());
          }
        }
        originalText = passageLines.join("\n").trim();
      }

      const actionable = isActionableTag(tag);
      const hash = hashAnnotation(tag, instruction, originalText);

      results.push({
        tag: tag as AnnotationTag,
        instruction,
        originalText,
        lineStart,
        lineEnd,
        scope,
        actionable,
        hash,
      });
    }

    // If no single-line match, check for multi-line annotation opening
    if (!foundSingleLine) {
      const openMatch = line.match(MULTILINE_OPEN);
      if (openMatch && !line.includes("%%", line.indexOf("%%") + 2)) {
        // Found opening %% TAG: ... without closing %% on this line
        const tag = openMatch[1];
        const instructionParts = [openMatch[2].trim()];
        let closeLine = i;

        // Scan forward for closing %%
        for (let j = i + 1; j < lines.length && j < i + 20; j++) {
          const cl = lines[j];
          const closeMatch = cl.match(MULTILINE_CLOSE);
          if (closeMatch) {
            instructionParts.push(closeMatch[1].trim());
            closeLine = j;
            break;
          } else {
            instructionParts.push(cl.trim());
          }
        }

        const instruction = instructionParts.join(" ").trim();
        if (isValidTag(tag) && instruction.length > 0) {
          // Use the line AFTER the closing %% as the annotation target
          const annotationLineIndex = closeLine;
          const { scope, lineStart, lineEnd } = resolveScope(lines, annotationLineIndex);

          let originalText: string;
          if (scope === "inline") {
            originalText = stripAnnotations(lines[annotationLineIndex]).trim();
          } else {
            const passageLines: string[] = [];
            for (let j = lineStart; j <= lineEnd; j++) {
              const strippedLine = stripAnnotations(lines[j]).trim();
              if (strippedLine.length > 0 || isBlank(lines[j])) {
                passageLines.push(stripAnnotations(lines[j]).trimEnd());
              }
            }
            originalText = passageLines.join("\n").trim();
          }

          const actionable = isActionableTag(tag);
          const hash = hashAnnotation(tag, instruction, originalText);

          results.push({
            tag: tag as AnnotationTag,
            instruction,
            originalText,
            lineStart,
            lineEnd,
            scope,
            actionable,
            hash,
          });

          // Skip past the multi-line annotation
          i = closeLine;
        }
      }
    }
  }

  // Sort by lineStart ascending (stable).
  results.sort((a, b) => a.lineStart - b.lineStart);
  return results;
}
