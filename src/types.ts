/**
 * PENNY - Prose Engine for Narrative, Notes, and Yarns
 * Shared type definitions
 */

/** Route configuration for a complexity tier */
export interface ModelRoute {
  provider: string;
  model: string;
}

/** Plugin settings stored in Obsidian's data.json */
export interface PennySettings {
  // Provider keys & endpoints
  anthropicApiKey: string;
  ollamaEndpoint: string;
  ollamaApiKey: string;

  // Model routing
  routeLight: ModelRoute;
  routeStandard: ModelRoute;
  routeHeavy: ModelRoute;
  useSameModelForAll: boolean;

  // Context
  contextBudget: number;
  maxTokens: number;

  // Project structure (paths relative to vault root)
  draftsFolder: string;
  styleGuide: string;
  voiceTests: string;
  characterSheetsFolder: string;
  plotOutlinesFolder: string;
  wikiFolder: string;
  seriesBible: string;
  themesFile: string;
  reviewsFolder: string;
  activityLogFolder: string;

  // Voice
  customVoiceRules: string;
  systemPromptTemplate: string;

  // Behavior
  autoProcessOnSave: boolean;
  verboseLogging: boolean;
  chapterFilePattern: string;
  proseMarker: string;

  // Git
  autoCommitAfterProcessing: boolean;
  autoPushAfterCommit: boolean;
  commitMessageFormat: string;
}

/** The default system prompt template with placeholders */
export const DEFAULT_SYSTEM_PROMPT = `You are PENNY, a fiction co-author. You are revising a chapter based on the author's editorial annotation. Match the project's voice exactly.

{voice_rules}

## Voice Reference
{voice_tests}

## Style Guide
{style_guide}

## Plot Outline
{outline}

## Character References
{characters}

## Wiki/Lore References
{wiki}

---

## Current Chapter (Full Text)
{chapter}

---

Write the revised passage. Rules:
- Output ONLY the replacement text. No commentary, no meta-text, no code fences.
- Match the project's established prose style exactly.
- Maintain continuity with surrounding chapter text.
- If voice tests are provided, match them precisely.
- If a character sheet exists for a character in the scene, match their voice.`;

/**
 * Migrate legacy settings (pre-provider-abstraction) to the new format.
 *
 * If saved data contains old `apiKey` or `model` fields, map them to the
 * new `anthropicApiKey` and route fields so existing users are not broken.
 */
export function migrateSettings(
  saved: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = { ...saved };

  // Migrate old apiKey -> anthropicApiKey
  if ("apiKey" in migrated && !("anthropicApiKey" in migrated)) {
    migrated.anthropicApiKey = migrated.apiKey;
  }
  delete migrated.apiKey;

  // Migrate old model -> all three routes (uniform routing)
  if ("model" in migrated && typeof migrated.model === "string") {
    const oldModel = migrated.model as string;
    const route: ModelRoute = { provider: "anthropic", model: oldModel };
    if (!("routeLight" in migrated)) migrated.routeLight = { ...route };
    if (!("routeStandard" in migrated)) migrated.routeStandard = { ...route };
    if (!("routeHeavy" in migrated)) migrated.routeHeavy = { ...route };
    if (!("useSameModelForAll" in migrated)) migrated.useSameModelForAll = true;
  }
  delete migrated.model;

  return migrated;
}

export const DEFAULT_SETTINGS: PennySettings = {
  anthropicApiKey: "",
  ollamaEndpoint: "http://localhost:11434",
  ollamaApiKey: "",

  // These are valid current Anthropic model aliases (as of 2026).
  // See: https://docs.anthropic.com/en/docs/about-claude/models
  routeLight: { provider: "anthropic", model: "claude-haiku-4-5" },
  routeStandard: { provider: "anthropic", model: "claude-sonnet-4-6" },
  routeHeavy: { provider: "anthropic", model: "claude-opus-4-6" },
  useSameModelForAll: false,

  contextBudget: 800000,
  maxTokens: 16000,

  draftsFolder: "04-drafts",
  styleGuide: "",
  voiceTests: "",
  characterSheetsFolder: "",
  plotOutlinesFolder: "",
  wikiFolder: "",
  seriesBible: "",
  themesFile: "",
  reviewsFolder: "07-reviews",
  activityLogFolder: ".penny-log",

  customVoiceRules: "",
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT,

  autoProcessOnSave: false,
  verboseLogging: false,
  chapterFilePattern: "ch-*.md",
  proseMarker: "<!-- Prose begins below -->",

  autoCommitAfterProcessing: false,
  autoPushAfterCommit: false,
  commitMessageFormat: "docs({chapter}): PENNY v{version} - {tags}",
};

/** Supported annotation tags */
export const ACTIONABLE_TAGS = [
  "REWRITE",
  "EXPAND",
  "CUT",
  "TONE",
  "DIALOG",
  "PLOT",
  "PACING",
  "CHARACTER",
] as const;

export const PASSTHROUGH_TAGS = ["NOTE", "RESEARCH"] as const;

export const ALL_TAGS = [...ACTIONABLE_TAGS, ...PASSTHROUGH_TAGS] as const;

export type ActionableTag = (typeof ACTIONABLE_TAGS)[number];
export type PassthroughTag = (typeof PASSTHROUGH_TAGS)[number];
export type AnnotationTag = (typeof ALL_TAGS)[number];

/** Parsed annotation from a chapter file */
export interface AnnotatedSection {
  tag: AnnotationTag;
  instruction: string;
  originalText: string;
  lineStart: number;
  lineEnd: number;
  scope: "inline" | "paragraph" | "section";
  actionable: boolean;
  hash: string;
}

/** Chapter version state */
export interface VersionState {
  version: number;
  lastProcessed: string | null;
  processedAnnotations: ProcessedAnnotation[];
}

export interface ProcessedAnnotation {
  hash: string;
  tag: string;
  line: number;
  processedInVersion: number;
}

/** Context assembled for a revision prompt */
export interface AssembledContext {
  chapter: string;
  voiceTests: string;
  styleGuide: string;
  outline: string;
  characters: string;
  wiki: string;
  seriesBible: string;
  themes: string;
  voiceRules: string;
  totalTokenEstimate: number;
}

/** Chapter frontmatter */
export interface ChapterFrontmatter {
  type?: string;
  book?: number;
  chapter?: number;
  title?: string;
  pov?: string;
  status?: string;
  wordcount?: number;
  focus?: string;
  thread?: string;
  act?: number;
  // Agent-managed
  agent_version?: number;
  agent_last_revised?: string;
  agent_annotations_pending?: number;
  characters_in_scene?: string[];
  [key: string]: unknown;
}

/** Review note data */
export interface ReviewData {
  timestamp: string;
  book: string;
  chapter: string;
  version: number;
  annotationsProcessed: number;
  annotationsSkipped: number;
  changes: AnnotationChange[];
  flags: ReviewFlag[];
  voiceCompliance: VoiceComplianceResult;
  wordCountBefore: number;
  wordCountAfter: number;
}

export interface AnnotationChange {
  tag: string;
  instruction: string;
  lineStart: number;
  originalWordCount: number;
  revisedWordCount: number;
  contextFilesUsed: string[];
  provider: string;
  model: string;
}

export interface ReviewFlag {
  type: "research" | "plot" | "vague" | "error";
  line: number;
  description: string;
}

export interface VoiceComplianceResult {
  dialogueRatio: number;
  longNarrationSentences: string[];
  selfAnalysisFlags: string[];
}

/** Activity log entry */
export interface ActivityLogEntry {
  timestamp: string;
  book: string;
  chapter: string;
  versionFrom: number;
  versionTo: number;
  annotationsProcessed: number;
  annotationsSkipped: number;
  wordCountBefore: number;
  wordCountAfter: number;
  tags: string[];
  durationMs: number;
  provider: string;
  model: string;
  voiceCompliance: VoiceComplianceResult;
}

/** Project init wizard options */
export interface ProjectInitOptions {
  projectName: string;
  numberOfBooks: number;
  chaptersPerBook: number;
  includeTemplates: boolean;
  pov: "first" | "third";
  tense: "past" | "present";
}
