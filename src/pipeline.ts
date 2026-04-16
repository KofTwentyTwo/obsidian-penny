/**
 * PENNY - Core Processing Pipeline (pure logic)
 *
 * Extracted from commands.ts for testability. This module has NO Obsidian
 * dependencies. It takes pre-read content and an injected provider lookup,
 * runs the full annotation processing pipeline, and returns results that
 * the command layer writes back to the vault.
 */

import type { AnnotatedSection, AnnotationChange, ReviewFlag, PennySettings } from "./types";
import type { ContextFiles } from "./context";
import type { CompletionRequest, CompletionResponse } from "./providers/service";
import type { RouteConfig, ComplexityTier } from "./providers/router";
import { TAG_COMPLEXITY } from "./providers/router";
import { parseAnnotations } from "./parser";
import { assembleContext } from "./context";
import { buildPrompt, callProvider } from "./drafter";
import { assembleNewVersion } from "./assembler";
import { readVersion, nextVersion, readState, updateState, shouldProcess, serializeState } from "./versioner";
import { parseFrontmatter, serializeFrontmatter, updateAgentFields, countProseWords, detectCharacters } from "./frontmatter";
import { generateReview } from "./reviewer";
import { createLogEntry, formatLogEntry } from "./logger";
import { checkVoiceCompliance } from "./voice-check";
import { getRoute } from "./providers/router";

/**
 * A minimal provider interface for the pipeline. Matches the subset of
 * LLMService that the pipeline actually uses.
 */
export interface PipelineProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Optional token multiplier for this provider (words-to-tokens ratio). */
  tokenMultiplier?: number;
}

export interface PipelineInput {
  content: string;
  versionContent: string;
  stateContent: string;
  contextFiles: ContextFiles;
  settings: PennySettings;
  chapterId: string;
  bookId: string;
  /** Provider lookup: given a provider name, returns an object with a complete() method, or undefined */
  getProvider: (name: string) => PipelineProvider | undefined;
}

export interface PipelineResult {
  /** The assembled new version content (with frontmatter) */
  newContent: string;
  /** The new version number */
  newVersion: number;
  /** Serialized state JSON */
  stateJson: string;
  /** Review note markdown */
  reviewContent: string;
  /** Activity log entry line (JSONL) */
  logLine: string;
  /** Number of annotations processed */
  annotationsProcessed: number;
  /** Number of annotations skipped (passthrough) */
  annotationsSkipped: number;
  /** Tags that were processed */
  tags: string[];
  /** Duration in ms */
  durationMs: number;
  /** Whether there were any errors during individual annotation processing */
  hadErrors: boolean;
}

/**
 * Build the RouteConfig from plugin settings.
 * When useSameModelForAll is true, all tiers use the standard route.
 */
export function buildRouteConfig(s: PennySettings): RouteConfig {
  if (s.useSameModelForAll) {
    return {
      light: { ...s.routeStandard },
      standard: { ...s.routeStandard },
      heavy: { ...s.routeStandard },
    };
  }
  return {
    light: { ...s.routeLight },
    standard: { ...s.routeStandard },
    heavy: { ...s.routeHeavy },
  };
}

/**
 * Run the core processing pipeline on chapter content.
 *
 * Pure logic except for LLM calls (injected via getProvider).
 * Returns null if there are no new annotations to process.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult | null> {
  const startTime = Date.now();
  const { content, settings, chapterId, bookId } = input;

  // (a) Parse annotations
  const allAnnotations = parseAnnotations(content);

  // (b) Read version and state
  const currentVersion = readVersion(input.versionContent);
  const state = readState(input.stateContent);

  // (c) Filter to only new actionable annotations
  const toProcess = shouldProcess(allAnnotations, state);

  if (toProcess.length === 0) {
    return null; // nothing to do
  }

  // Build route config
  const routeConfig = buildRouteConfig(settings);

  // Count passthrough annotations
  const passthroughCount = allAnnotations.filter((a) => !a.actionable).length;

  // Word count before processing
  const wordCountBefore = countProseWords(content, settings.proseMarker);

  // (e) Process each annotation via the LLM provider
  const revisions: Array<{ annotation: AnnotatedSection; revisedText: string }> = [];
  const changes: AnnotationChange[] = [];
  const flags: ReviewFlag[] = [];
  const processedTags: string[] = [];
  let hadErrors = false;

  for (const annotation of toProcess) {
    const route = getRoute(annotation.tag, routeConfig);
    const provider = input.getProvider(route.provider);

    if (!provider) {
      // Insert error marker and continue
      const errorText = `%% AGENT-ERROR: Provider "${route.provider}" not available for ${annotation.tag} %%\n${annotation.originalText}`;
      revisions.push({ annotation, revisedText: errorText });
      flags.push({
        type: "error",
        line: annotation.lineStart,
        description: `Provider "${route.provider}" not found for [${annotation.tag}]`,
      });
      hadErrors = true;
      continue;
    }

    try {
      // Determine token multiplier from the provider (defaults to 1.33 for Anthropic)
      const tokenMultiplier = provider.tokenMultiplier ?? 1.33;

      // Build context
      const assembledCtx = assembleContext(
        input.contextFiles,
        annotation,
        settings,
        tokenMultiplier,
      );

      // Build prompt
      const { system, user } = buildPrompt(
        assembledCtx,
        annotation,
        settings.systemPromptTemplate,
      );

      // Only enable thinking for "heavy" tier tags to avoid burning budget on trivial annotations
      const tier: ComplexityTier = TAG_COMPLEXITY[annotation.tag] ?? "standard";
      const useThinking = tier === "heavy";

      // Call provider
      const response = await callProvider(provider, {
        systemPrompt: system,
        userPrompt: user,
        model: route.model,
        maxTokens: settings.maxTokens ?? 16000,
        apiKey: settings.anthropicApiKey,
        endpoint: route.provider === "ollama" ? settings.ollamaEndpoint : undefined,
        useThinking,
      });

      revisions.push({ annotation, revisedText: response.text });
      processedTags.push(annotation.tag);

      // Track which context files were used
      const contextUsed: string[] = ["chapter"];
      if (assembledCtx.voiceTests) contextUsed.push("voiceTests");
      if (assembledCtx.styleGuide) contextUsed.push("styleGuide");
      if (assembledCtx.outline) contextUsed.push("outline");
      if (assembledCtx.characters) contextUsed.push("characters");
      if (assembledCtx.wiki) contextUsed.push("wiki");

      const origWords = annotation.originalText.trim().split(/\s+/).filter((w) => w.length > 0).length;
      const revisedWords = response.text.trim().split(/\s+/).filter((w) => w.length > 0).length;

      changes.push({
        tag: annotation.tag,
        instruction: annotation.instruction,
        lineStart: annotation.lineStart,
        originalWordCount: origWords,
        revisedWordCount: revisedWords,
        contextFilesUsed: contextUsed,
        provider: route.provider,
        model: route.model,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorText = `%% AGENT-ERROR(${annotation.tag}): ${errMsg} %%\n${annotation.originalText}`;
      revisions.push({ annotation, revisedText: errorText });
      flags.push({
        type: "error",
        line: annotation.lineStart,
        description: `API error for [${annotation.tag}]: ${errMsg}`,
      });
      hadErrors = true;
    }
  }

  // (f) Assemble new version
  const newVer = nextVersion(currentVersion);
  const assembled = assembleNewVersion(content, revisions, newVer);

  // (g) Update frontmatter
  const { frontmatter: assembledFm, body: assembledBody } = parseFrontmatter(assembled);
  const wordCountAfter = countProseWords(assembled, settings.proseMarker);
  const charsInScene = detectCharacters(assembled, typeof assembledFm.focus === "string" ? assembledFm.focus : "");

  // Compute pending annotations remaining in the new version
  const newAnnotations = parseAnnotations(assembled);
  const pendingCount = newAnnotations.filter((a) => a.actionable).length;

  const updatedFm = updateAgentFields(assembledFm, {
    wordcount: wordCountAfter,
    status: pendingCount > 0 ? "in-progress" : "revised",
    agent_version: newVer,
    agent_last_revised: new Date().toISOString(),
    agent_annotations_pending: pendingCount,
    characters_in_scene: charsInScene,
  });

  const newContent = serializeFrontmatter(updatedFm, assembledBody);

  // (h) Update state
  const newState = updateState(state, newVer, toProcess);
  const stateJson = serializeState(newState);

  // (i) Voice compliance check on the new prose
  const voiceCompliance = checkVoiceCompliance(assembledBody);

  // (j) Generate review note
  const durationMs = Date.now() - startTime;
  const reviewData = {
    timestamp: new Date().toISOString(),
    book: bookId,
    chapter: chapterId,
    version: newVer,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    changes,
    flags,
    voiceCompliance,
    wordCountBefore,
    wordCountAfter,
  };
  const reviewContent = generateReview(reviewData);

  // (k) Generate activity log entry
  const logEntry = createLogEntry({
    book: bookId,
    chapter: chapterId,
    versionFrom: currentVersion,
    versionTo: newVer,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    wordCountBefore,
    wordCountAfter,
    tags: processedTags,
    durationMs,
    provider: processedTags.length > 0 ? changes[0]?.provider ?? "unknown" : "none",
    model: processedTags.length > 0 ? changes[0]?.model ?? "unknown" : "none",
    voiceCompliance,
  });
  const logLine = formatLogEntry(logEntry);

  return {
    newContent,
    newVersion: newVer,
    stateJson,
    reviewContent,
    logLine,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    tags: processedTags,
    durationMs,
    hadErrors,
  };
}
