# Configuration

PENNY is configured through the Obsidian settings tab and optionally through a `PENNY.md` file for per-project overrides. This guide explains every setting.

## API Settings

### API Key

| Field | Value |
|-------|-------|
| Type | Password text |
| Default | (empty) |
| Required | Yes |

Your Anthropic API key. Get one at [console.anthropic.com](https://console.anthropic.com). The key is stored locally in `.obsidian/plugins/penny/data.json` and is sent only to Anthropic's API endpoint (`https://api.anthropic.com/v1/messages`).

### Model

| Field | Value |
|-------|-------|
| Type | Dropdown |
| Default | `claude-opus-4-6` |

Which Claude model to use for revisions. Available options and recommendations:

| Model | Best For | Trade-off |
|-------|----------|-----------|
| `claude-opus-4-6` | Literary prose, voice matching, complex scenes | Highest quality, highest cost |
| `claude-sonnet-4-6` | Routine revisions, dialogue fixes, cuts | Good quality, moderate cost |
| `claude-haiku-3-5` | Quick passes, simple rewrites, bulk processing | Fastest, lowest cost, less nuanced |

**Recommendation:** Use Opus for chapters that matter most (key scenes, voice-critical passages, complex emotional beats). Use Sonnet for routine work. Use Haiku for bulk first-pass processing when you plan to do a second pass with a better model.

### Context Budget

| Field | Value |
|-------|-------|
| Type | Number |
| Default | `800000` |

Maximum tokens for context assembly. PENNY loads your chapter, style guide, voice tests, character sheets, outlines, and wiki entries into the prompt. If the assembled context exceeds this budget, PENNY drops sources from the bottom of the priority list (see [Voice Enforcement](voice-enforcement.md) for the priority order).

For most projects, the default of 800,000 tokens is more than sufficient. Lower this if you want to reduce API costs or speed up processing.

## Project Structure

All paths are relative to the vault root. These tell PENNY where to find your project's files. Leave a path blank to disable that context source -- PENNY will skip it without error.

### Drafts Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `04-drafts` |

Where your chapter files live. PENNY expects this folder to contain book subfolders (e.g., `04-drafts/book-1/`, `04-drafts/book-2/`) which in turn contain chapter folders.

**Examples for different vault layouts:**

| Layout | Setting |
|--------|---------|
| Standard PENNY scaffold | `04-drafts` |
| Single-book vault | `drafts` |
| Flat structure | `chapters` |
| Nested series | `my-series/drafts` |

### Style Guide

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Path to your style guide file. This is loaded into every revision prompt as high-priority context.

**Examples:** `06-reference/style-guide.md`, `style-guide.md`, `docs/writing-style.md`

### Voice Tests

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Path to your voice tests file. Voice tests are example passages that define how your prose should sound. PENNY loads the relevant section (matched to characters in the scene) into every revision prompt.

**Example:** `06-reference/voice-tests.md`

### Character Sheets Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Folder containing character profile files. PENNY loads character sheets for characters detected in the scene being revised (from the chapter's `focus` frontmatter field and dialogue attribution scanning).

**Examples:** `02-characters`, `characters`, `cast`

### Plot Outlines Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Folder containing per-book outline files. PENNY loads the outline for the current book to understand chapter context and plot continuity.

**Examples:** `03-plot`, `outlines`, `plot`

### Wiki/Lore Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Folder containing world-building entries, lore, and reference material. PENNY scans annotation text and chapter content for terms that match wiki entry titles and loads relevant entries.

**Examples:** `05-wiki`, `wiki`, `lore`, `world`

### Series Bible

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Path to your series bible file. Loaded as lower-priority context when token budget permits.

**Example:** `00-series/series-bible.md`

### Themes File

| Field | Value |
|-------|-------|
| Type | Text |
| Default | (empty) |

Path to your themes file. Loaded as lower-priority context when token budget permits.

**Example:** `00-series/themes.md`

### Reviews Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `07-reviews` |

Where PENNY writes review notes after processing a chapter. Review notes are organized by book subfolder, one file per version.

### Activity Log Folder

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `.penny-log` |

Where PENNY writes activity logs (JSONL format). Logs track processing history, token usage, word counts, and voice compliance data. Useful for monitoring costs and tracking revision history.

## Voice Rules

### Custom Voice Rules

| Field | Value |
|-------|-------|
| Type | Textarea |
| Default | (empty) |

Project-specific voice rules injected into the "CRITICAL VOICE RULES" section of every revision prompt. Write the rules that matter most for your project's voice.

**Example for a first-person autistic narrator:**

```
- No internal monologue. She does not think in narrated sentences. Every scene is dialogue.
- She is never named. No character uses her name.
- She does not describe emotions with emotion words. Physical sensations or subject changes only.
- Technical terms used casually, never explained to the reader.
- Humor is structural -- she is sincere, the reader finds it funny. She never knows she's funny.
```

**Example for a third-person literary novel:**

```
- Close third person. The narrator has access to the POV character's thoughts but not others'.
- Metaphors drawn from the natural world -- seasons, weather, landscape.
- No modern slang. Register is measured, deliberate, slightly formal.
- Dialogue is sparse. Most information comes through observation and interiority.
```

**Example for a thriller:**

```
- Short sentences. Short paragraphs. White space is tension.
- No adverbs in dialogue attribution. "Said" and "asked" only.
- Every chapter ends on a question or a threat.
- POV character notices threats before comforts -- describe exits, weapons, and hands first.
```

### Base System Prompt

| Field | Value |
|-------|-------|
| Type | Textarea |
| Default | (see below) |

The full system prompt template sent to Claude. Advanced users can customize this. The default template includes placeholders that PENNY fills with your project's context:

| Placeholder | Replaced With |
|-------------|---------------|
| `{voice_rules}` | Your custom voice rules (from settings or PENNY.md) |
| `{voice_tests}` | Relevant voice test section |
| `{style_guide}` | Your style guide content |
| `{outline}` | Current book's plot outline |
| `{characters}` | Character sheets for characters in the scene |
| `{wiki}` | Matched wiki/lore entries |
| `{chapter}` | Full text of the current chapter |
| `{tag}` | The annotation tag being processed (e.g., REWRITE) |
| `{passage}` | The specific passage being revised |
| `{instruction}` | Your annotation instruction |
| `{lineStart}` | Starting line number of the passage |
| `{lineEnd}` | Ending line number of the passage |

If a context source is not configured (e.g., no voice tests path set), that section is omitted from the prompt entirely.

**When to customize:** Most users should leave this alone. Customize if you need to change the fundamental instructions PENNY gives to Claude -- for example, adding genre-specific rules, changing the output format, or adding project-specific constraints that do not fit in the voice rules field.

## Behavior Settings

### Auto-Process on Save

| Field | Value |
|-------|-------|
| Type | Toggle |
| Default | Off |

When enabled, PENNY automatically processes annotations when you save a chapter file. Use with caution -- each annotation triggers an API call that costs money.

**Recommendation:** Leave this off until you are comfortable with PENNY's output and have tuned your voice rules. Use the manual **PENNY: Process this chapter** command instead.

### Verbose Logging

| Field | Value |
|-------|-------|
| Type | Toggle |
| Default | Off |

When enabled, PENNY writes detailed logs including full prompt text, API responses, and processing steps. Useful for debugging voice issues or understanding why a revision came out a certain way. Increases log file size significantly.

### Chapter File Pattern

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `ch-*.md` |

Glob pattern for identifying chapter files within book folders. Change this if your chapters use a different naming convention.

**Examples:**

| Convention | Pattern |
|------------|---------|
| `ch-01.v1.md`, `ch-02.v3.md` | `ch-*.md` (default) |
| `chapter-01.md` | `chapter-*.md` |
| `01-opening.md` | `*.md` (matches all markdown) |

### Prose Marker

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `<!-- Prose begins below -->` |

The HTML comment that separates frontmatter/outline content from prose in a chapter file. PENNY uses this marker to calculate word counts (only prose below the marker is counted) and to identify where annotations in the prose section begin.

## PENNY.md Per-Project Configuration

A `PENNY.md` file at the root of your novel project folder provides per-project overrides. This is how you configure multiple projects in the same vault with different settings.

### Format

PENNY.md uses a simple key-value format under section headings:

```markdown
# PENNY Configuration

## Project
name: My Novel
drafts: 04-drafts
style-guide: 06-reference/style-guide.md
voice-tests: 06-reference/voice-tests.md
characters: 02-characters
plot: 03-plot
wiki: 05-wiki
reviews: 07-reviews

## Voice Rules
- No internal monologue. Every scene is dialogue.
- She is never named.
- Humor is structural. She never knows she's funny.
```

### Fields

All paths in PENNY.md are relative to the project folder (the folder containing PENNY.md), not the vault root.

| Field | Maps To |
|-------|---------|
| `name` | Project name (display only) |
| `drafts` | Drafts folder setting |
| `style-guide` | Style guide setting |
| `voice-tests` | Voice tests setting |
| `characters` | Character sheets folder setting |
| `plot` | Plot outlines folder setting |
| `wiki` | Wiki/lore folder setting |
| `reviews` | Reviews folder setting |

The **Voice Rules** section content is used as the custom voice rules, overriding whatever is set in the plugin settings tab.

### Settings Resolution Order

PENNY resolves settings with highest priority first:

1. **PENNY.md** in the active file's project folder (if it exists)
2. **Plugin settings tab** (global settings)
3. **Built-in defaults**

This means if you set `drafts: my-chapters` in PENNY.md and `04-drafts` in the settings tab, PENNY uses `my-chapters` when you are editing a file inside that project.

### How PENNY Finds PENNY.md

When you open a chapter file, PENNY walks up the directory tree from the file's location looking for a `PENNY.md` file. The first one it finds becomes the active project configuration. This means you can nest projects:

```
vault/
  series-a/
    PENNY.md          <- Used when editing series-a chapters
    04-drafts/
  series-b/
    PENNY.md          <- Used when editing series-b chapters
    04-drafts/
```

## Git Settings

### Auto-Commit After Processing

| Field | Value |
|-------|-------|
| Type | Toggle |
| Default | Off |

Automatically run `git add` and `git commit` after PENNY finishes processing a chapter. The commit message is auto-generated from the processing results.

### Auto-Push After Commit

| Field | Value |
|-------|-------|
| Type | Toggle |
| Default | Off |

Automatically push to the remote after committing. Requires auto-commit to be enabled. Only pushes if a remote is configured for the current branch.

### Commit Message Format

| Field | Value |
|-------|-------|
| Type | Text |
| Default | `docs({chapter}): PENNY v{version} - {tags}` |

Template for auto-generated commit messages. Available placeholders:

| Placeholder | Replaced With |
|-------------|---------------|
| `{chapter}` | Chapter identifier (e.g., `ch-05`) |
| `{version}` | New version number |
| `{tags}` | Comma-separated list of processed annotation tags |
| `{book}` | Book identifier (e.g., `book-1`) |
| `{words}` | Word count delta (e.g., `+450 words`) |

**Example output:** `docs(ch-05): PENNY v3 - REWRITE, EXPAND, DIALOG`
