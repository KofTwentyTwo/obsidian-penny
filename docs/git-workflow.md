# Git Workflow

PENNY includes git integration for committing and pushing your writing progress. It generates descriptive commit messages based on what changed in your revision session.

## How Commit Messages Are Generated

When you run **PENNY: Commit progress**, PENNY:

1. Runs `git status` to find all changed files in the vault.
2. Categorizes the changes:
   - New chapter versions
   - Updated frontmatter
   - New review notes
   - Outline changes
   - Character sheet edits
   - Activity log entries
3. Generates a commit message summarizing the session.

### Example commit message:

```
docs(book-1): revise ch-05 v3, ch-07 v2

ch-05: processed 3 annotations (REWRITE, EXPAND, DIALOG), +450 words
ch-07: processed 1 annotation (TONE), voice compliance pass
```

The first line follows the format configured in settings (default: `docs({chapter}): PENNY v{version} - {tags}`). The body lists per-chapter details.

### Customizing the format:

Change the commit message template in Settings > PENNY > Commit Message Format.

Available placeholders:

| Placeholder | Value |
|-------------|-------|
| `{chapter}` | Chapter identifier (e.g., `ch-05`) |
| `{version}` | New version number |
| `{tags}` | Processed annotation tags |
| `{book}` | Book identifier (e.g., `book-1`) |
| `{words}` | Word count delta |

When multiple chapters are committed together, PENNY generates a summary message listing all chapters.

## Auto-Commit and Auto-Push

Two settings control automatic git behavior:

| Setting | Default | What it does |
|---------|---------|--------------|
| Auto-commit after processing | Off | Commits after PENNY finishes processing a chapter |
| Auto-push after commit | Off | Pushes to remote after committing |

**Recommendation:** Leave both off while you are learning PENNY. Once you trust the output, auto-commit is convenient. Auto-push is useful if you want an off-site backup of every revision.

## What Gets Staged

PENNY stages only files related to your novel project:

- New chapter versions (`ch-XX.vN.md`)
- Version manifests (`.version`)
- State files (`.state.json`)
- Review notes
- Activity logs
- Updated character sheets, outlines, or wiki entries (if modified)

PENNY does **not** stage:

- Plugin configuration (`.obsidian/` directory)
- Files outside the project folder
- Unrelated vault files

The staging uses `git add` with specific file paths, not `git add -A` or `git add .`.

## The Three Git Commands

### PENNY: Commit progress

Stages project files and commits with an auto-generated message. This is the primary git command.

1. Finds changed files.
2. Stages relevant files.
3. Generates commit message.
4. Commits.
5. Shows a notice with the commit summary.

### PENNY: Push

Pushes committed changes to the remote. Equivalent to `git push`.

If no remote is configured, PENNY shows an error notice: "No remote configured. Run 'git remote add origin <url>' in your terminal."

### PENNY: Commit and push

Runs commit followed by push in one action. Convenience command for when you want to back up immediately.

## Safety

PENNY's git operations follow strict safety rules:

- **No force-push.** PENNY never runs `git push --force` or `git push --force-with-lease`.
- **No rebase.** PENNY never runs `git rebase`.
- **No destructive operations.** PENNY only uses `git add`, `git commit`, `git push`, `git status`, and `git log`.
- **No branch manipulation.** PENNY does not create, delete, or switch branches.
- **Staging is specific.** PENNY stages individual files by path, not the entire working directory.

If a push fails (e.g., due to remote changes), PENNY shows the error and lets you resolve it manually. It does not attempt to pull, merge, or force-push.

## Working Without Git

Git integration is entirely optional. If your vault is not a git repository, PENNY's git commands show a notice: "Not a git repository. Git features are disabled."

All other PENNY features (annotations, processing, versioning, reviews) work without git. The chapter versioning system is independent of git -- it uses numbered version files, not git history.

If you want version history without git, PENNY's built-in versioning provides it. If you want off-site backup, consider using Obsidian Sync, a cloud-synced folder, or initializing a git repo.

## Tips

**Commit after each revision pass.** This gives you git-level undo in addition to PENNY's version files. If something goes wrong, you can `git checkout` the previous state.

**Use meaningful branches.** If you are working on a major revision of a chapter (e.g., restructuring act 2), consider creating a git branch first: `git checkout -b revise-act-2`. This keeps your main branch clean while you experiment.

**Review before pushing.** Even with auto-commit enabled, leaving auto-push off gives you a chance to review the commit before it goes to the remote. Run `git log --oneline -5` in a terminal to see recent commits before pushing.
