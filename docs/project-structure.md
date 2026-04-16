# Project Structure

PENNY organizes novel projects using a numbered folder convention. Each folder has a clear purpose. This guide explains the standard layout, what each folder is for, and how to adapt it to your own vault.

## The Standard Layout

When you run **PENNY: Initialize project**, PENNY creates this structure:

```
Your Novel/
  00-series/
    series-bible.md
    series-arc.md
    themes.md
    timeline.md
  01-world/
    rules.md
    cultures/
    geography/
    history/
    politics/
    systems/
  02-characters/
    protagonists/
    supporting/
    antagonists/
    factions/
  03-plot/
    book-1/
      outline.md
    book-2/
      outline.md
  04-drafts/
    book-1/
      ch-01/
        ch-01.v1.md
        .version
      ch-02/
        ch-02.v1.md
        .version
      ...
    book-2/
      ...
  05-wiki/
    index.md
  06-reference/
    style-guide.md
    voice-tests.md
    comp-titles.md
    research/
  07-reviews/
    book-1/
    book-2/
  templates/
    chapter.md
    character.md
    location.md
    faction.md
    scene.md
  PENNY.md
```

## What Each Folder Is For

### 00-series/ -- Series Bible

The macro view. Everything that spans the entire series lives here.

| File | Purpose |
|------|---------|
| `series-bible.md` | Premise, genre, world rules, series-level themes |
| `series-arc.md` | The overarching plot across all books |
| `themes.md` | Thematic threads tracked across the series |
| `timeline.md` | Chronological event timeline |

PENNY loads the series bible and themes file as lower-priority context when the token budget permits. These help the model understand the broader story when revising individual chapters.

### 01-world/ -- World-Building

How your world works. Geography, magic systems, technology, political structures, cultural norms.

| Subfolder | Content |
|-----------|---------|
| `cultures/` | Societies, customs, languages, religions |
| `geography/` | Maps, locations, distances, climate |
| `history/` | Historical events, wars, founding myths |
| `politics/` | Governments, factions, power structures |
| `systems/` | Magic systems, technology, physics rules |
| `rules.md` | Top-level summary of what is and is not possible in this world |

PENNY does not load world-building files by default. They are loaded when wiki entries reference them or when they match terms found in the chapter being processed.

### 02-characters/ -- Character Sheets

One file per character, organized by role.

| Subfolder | Content |
|-----------|---------|
| `protagonists/` | Main character(s) |
| `supporting/` | Friends, family, allies |
| `antagonists/` | Villains, obstacles, opposing forces |
| `factions/` | Groups, organizations, crews |

Each character file should include:
- YAML frontmatter with `type`, `role`, `book-appearance`, and `status`
- Physical description
- Personality and mannerisms
- Voice description (how they talk, what language they use)
- Relationships to other characters
- Arc across the story

PENNY loads character sheets when it detects those characters in the scene being revised -- from the chapter's `focus` frontmatter field and from scanning dialogue attribution.

### 03-plot/ -- Plot Architecture

One subfolder per book, each containing an outline.

```
03-plot/
  book-1/
    outline.md
  book-2/
    outline.md
```

Each outline should cover:
- Act structure (whatever act model you use)
- Per-chapter summaries (what happens, who is present, what advances)
- Thread tracking (which plot threads move in which chapters)

PENNY loads the current book's outline into every revision prompt to maintain plot continuity.

### 04-drafts/ -- Prose Chapters

Where the actual writing lives. Organized by book, then by chapter, with versioned files inside each chapter folder.

```
04-drafts/
  book-1/
    ch-01/
      ch-01.v1.md      First version
      ch-01.v2.md      After first revision pass
      ch-01.v3.md      After second revision pass
      .version          Contains: 3
      .state.json       Processing history
    ch-02/
      ch-02.v1.md
      .version
```

See [Versioning](versioning.md) for full details on how versions work.

**Chapter file format:**

Every chapter file has YAML frontmatter followed by an optional outline section and then prose:

```markdown
---
type: chapter
book: 1
chapter: 5
title: The Discovery
pov: protagonist
status: draft
wordcount: 3200
focus: protagonist + darin
thread: mystery
act: 2
---

# Book 1, Chapter 5

## Scene Summary
> She and Darin investigate the memory allocation anomaly.

---

<!-- Prose begins below -->

The terminal cursor blinked at me like it was waiting for an apology...
```

**Frontmatter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `chapter` |
| `book` | number | Book number |
| `chapter` | number | Chapter number |
| `title` | string | Chapter title |
| `pov` | string | Point-of-view character |
| `status` | string | `outline`, `draft`, `revised`, `final` |
| `wordcount` | number | Word count of prose section (updated by PENNY) |
| `focus` | string | Characters in this chapter (used for context loading) |
| `thread` | string | Plot threads this chapter advances |
| `act` | number | Act number |

PENNY also adds and maintains these fields:

| Field | Type | Description |
|-------|------|-------------|
| `agent_version` | number | Current version number |
| `agent_last_revised` | string | ISO timestamp of last revision |
| `agent_annotations_pending` | number | Unprocessed annotation count |
| `characters_in_scene` | list | Characters detected in the chapter |

### 05-wiki/ -- Living Knowledge Base

A continuity reference that grows as the story develops. One file per entry, with `index.md` as the master table of contents.

Use wiki entries for things characters, places, events, and concepts that appear in multiple chapters and need consistent treatment. PENNY scans chapter text for terms matching wiki entry titles and loads matching entries into the revision prompt.

### 06-reference/ -- Style and Research

| File | Purpose |
|------|---------|
| `style-guide.md` | Voice rules, POV, tense, register, things to avoid |
| `voice-tests.md` | Example passages that define the voice per character |
| `comp-titles.md` | Comparable published works and what to learn from them |
| `research/` | Research notes, technical references, source material |

The style guide and voice tests are critical. PENNY loads them into every revision prompt. See [Voice Enforcement](voice-enforcement.md) for how to write effective style guides and voice tests.

### 07-reviews/ -- Review Notes

Where PENNY writes its review notes after processing chapters.

```
07-reviews/
  book-1/
    ch-01.v2-review.md
    ch-01.v3-review.md
    ch-05.v2-review.md
```

One review note per version. Each contains:
- Processing timestamp
- Annotation count and breakdown
- Per-annotation change summary with word count deltas
- Voice compliance results
- Flags for RESEARCH and PLOT annotations

### templates/ -- Reusable Templates

Obsidian templates for creating new chapters, characters, locations, and other structured files. PENNY uses these when you run **PENNY: New chapter** or **PENNY: New character**.

### PENNY.md -- Project Configuration

The per-project configuration file. See [Configuration](configuration.md) for details.

## Where PENNY Writes Output

PENNY creates or modifies files in three locations:

| Output | Location |
|--------|----------|
| New chapter versions | Same folder as the source chapter (`04-drafts/book-N/ch-XX/`) |
| Review notes | Reviews folder (`07-reviews/book-N/`) |
| Activity logs | Log folder (default: `.penny-log/`) |

PENNY never modifies your existing chapter versions. It only creates new version files.

## Adapting for Non-Standard Layouts

You do not need to use the numbered folder convention. PENNY works with any layout as long as you configure the paths in settings.

### Example: Minimal single-book vault

```
my-novel/
  chapters/
    ch-01/
      ch-01.v1.md
      .version
  characters/
    alice.md
    bob.md
  style-guide.md
  reviews/
```

Settings:
- Drafts folder: `chapters`
- Style guide: `style-guide.md`
- Character sheets folder: `characters`
- Reviews folder: `reviews`
- Everything else: blank

### Example: Multi-project vault

```
vault/
  novel-a/
    PENNY.md
    drafts/
    characters/
    style-guide.md
  novel-b/
    PENNY.md
    drafts/
    characters/
    style-guide.md
```

Each `PENNY.md` configures paths relative to its own project folder. PENNY automatically uses the right config based on which file you are editing.

## Multi-Book vs. Single-Book

### Multi-book series

Use book subfolders inside drafts and plot:

```
04-drafts/
  book-1/
  book-2/
  book-3/
03-plot/
  book-1/
    outline.md
  book-2/
    outline.md
```

PENNY detects the book from the chapter file's location and loads the correct outline.

### Single book

You can still use the `book-1` subfolder (the scaffold always creates it), or you can put chapters directly in the drafts folder:

```
04-drafts/
  ch-01/
  ch-02/
```

If chapters are directly in the drafts folder without a book subfolder, PENNY treats them as book 1.
