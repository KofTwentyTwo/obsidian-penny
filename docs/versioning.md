# Versioning

PENNY uses a simple file-based versioning system. Every time PENNY processes annotations in a chapter, it creates a new version file. Nothing is overwritten. You always have access to every previous version.

## Folder Structure

Each chapter lives in its own folder:

```
04-drafts/book-1/ch-05/
  ch-05.v1.md         Original draft
  ch-05.v2.md         After first revision pass
  ch-05.v3.md         After second revision pass
  ch-05.v4.md         After third revision pass
  .version            Contains: 4
  .state.json         Processing history
```

The folder name matches the chapter identifier. Version files are named `ch-XX.vN.md` where `N` is the version number.

## What Triggers a New Version

A new version is created when you run **PENNY: Process this chapter** (or **PENNY: Process all chapters**) and the chapter has at least one actionable annotation.

Actionable annotations are: `REWRITE`, `EXPAND`, `CUT`, `TONE`, `DIALOG`, `PLOT` (with specific instructions), `PACING`, and `CHARACTER`.

Non-actionable annotations (`NOTE`, `RESEARCH`) do not trigger a new version on their own.

If you run the command on a chapter with no actionable annotations, PENNY shows a notice ("No annotations to process") and does not create a new version.

## The .version File

A plain text file containing a single number: the current version.

```
4
```

That is the entire file. PENNY reads this to know which version is current, and writes to it after creating a new version.

**How PENNY uses it:**

1. Read `.version` to get current version number (e.g., `3`).
2. Read `ch-05.v3.md` as the source text.
3. Process annotations and assemble the new text.
4. Write `ch-05.v4.md`.
5. Update `.version` to `4`.

## The .state.json File

Tracks which annotations have been processed, preventing duplicate work.

```json
{
  "version": 4,
  "lastProcessed": "2026-04-16T14:30:00Z",
  "processedAnnotations": [
    {
      "hash": "a1b2c3d4e5f6",
      "tag": "REWRITE",
      "line": 14,
      "processedInVersion": 2
    },
    {
      "hash": "f6e5d4c3b2a1",
      "tag": "EXPAND",
      "line": 28,
      "processedInVersion": 2
    },
    {
      "hash": "1a2b3c4d5e6f",
      "tag": "TONE",
      "line": 45,
      "processedInVersion": 3
    }
  ]
}
```

### How Idempotency Works

Each annotation is hashed from its `tag + instruction + originalText`. When PENNY encounters an annotation, it checks the hash against `.state.json`:

- If the hash is already recorded, the annotation was processed in a previous version. PENNY skips it.
- If the hash is new, the annotation is processed.

This means running **PENNY: Process this chapter** twice on the same file with the same annotations produces only one new version. The second run finds all annotations already processed and reports "No new annotations to process."

### When Idempotency Resets

If you change an annotation's instruction or the text it applies to, the hash changes and it becomes a new annotation. PENNY will process it.

If you add a new annotation to an already-processed chapter, only the new annotation is processed. The existing text is preserved.

## Rolling Back

To go back to a previous version:

1. Open the `.version` file in the chapter folder.
2. Change the number to the version you want to return to (e.g., change `4` to `2`).
3. Save.

Now PENNY treats `ch-05.v2.md` as the current version. The v3 and v4 files still exist but PENNY will not use them as the source for new revisions.

If you add annotations to the v2 file and process again, PENNY creates `ch-05.v5.md` (next available number) based on v2's content.

**Tip:** You do not need to delete old version files. They take negligible space and serve as a full history of your revision process.

## What the New Version Contains

When PENNY creates a new version, it:

1. **Copies** the full text of the current version.
2. **Replaces** annotated passages with revised text (processing from bottom to top to preserve line numbers).
3. **Removes** processed annotations.
4. **Keeps** `NOTE` and `RESEARCH` annotations unchanged.
5. **Inserts** revision markers after each revised passage:
   ```markdown
   %% REVISED(v3): [REWRITE] "Added sensory detail to lab scene" -- 12 words -> 45 words %%
   ```
6. **Updates** frontmatter (version number, word count, status, timestamp, annotation count).
7. **Writes** the new file.
8. **Updates** `.version` and `.state.json`.

## Migration from Flat Files

If your chapters are currently flat files (not in versioned folders):

```
04-drafts/book-1/ch-01.md
04-drafts/book-1/ch-02.md
04-drafts/book-1/ch-03.md
```

Run **PENNY: Migrate chapters** from the command palette.

### What migration does:

1. Select which book to migrate when prompted.
2. For each `ch-XX.md` file in the book folder:
   - Create a folder `ch-XX/`.
   - Copy the file content to `ch-XX/ch-XX.v1.md` (verified with checksum).
   - Delete the original `ch-XX.md`.
   - Write `.version` containing `1`.
3. Show a completion notice: "Migrated 20 chapters in book-1."

### Migration is safe:

- **Checksum verified** -- PENNY verifies the copy matches the original before deleting the flat file.
- **Idempotent** -- Chapters already in folder format are skipped. Running migration twice is safe.
- **Non-destructive** -- If anything fails mid-migration, already-migrated chapters remain valid and un-migrated chapters remain as flat files.

### Before migration:

```
04-drafts/book-1/
  ch-01.md
  ch-02.md
  ch-03.md
```

### After migration:

```
04-drafts/book-1/
  ch-01/
    ch-01.v1.md
    .version
  ch-02/
    ch-02.v1.md
    .version
  ch-03/
    ch-03.v1.md
    .version
```

## FAQ

**Can I edit a version file directly?**

Yes. Open the current version (check `.version` for the number), make your changes, and save. If you add new annotations, PENNY will process them on the next run and create a new version.

**Can I rename version files?**

Do not rename them. PENNY expects the `ch-XX.vN.md` naming convention. If you rename files, PENNY will not find them.

**What if I want to start fresh?**

Set `.version` back to `1`. Optionally delete the higher-numbered version files. PENNY will treat `ch-XX.v1.md` as the current version.

**How much disk space do versions use?**

A typical chapter is 3,000-8,000 words, which is 20-50 KB of markdown. Ten versions of a chapter is 200-500 KB. An entire novel with 25 chapters and 10 versions each is under 15 MB. Disk space is not a concern.

**Can I use git instead of PENNY's versioning?**

You can use both. PENNY's versioning gives you named, browseable versions inside Obsidian. Git gives you commit-level history. They complement each other. The git commands (**PENNY: Commit progress**, etc.) work alongside PENNY versioning.

**What happens if .version is missing?**

PENNY looks for version files in the folder and sets `.version` to the highest number found. If no version files exist, it treats the folder as empty and will not process.

**What happens if .state.json is missing?**

PENNY creates a fresh `.state.json` and treats all annotations as unprocessed. This means the next processing run will create a new version even if those annotations were previously processed. This is safe -- you just get one extra version.
