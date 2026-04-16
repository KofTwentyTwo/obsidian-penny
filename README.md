# PENNY -- Prose Engine for Narrative, Notes, and Yarns

Your AI co-author for Obsidian. PENNY processes editorial annotations in your novel chapters, revises prose while enforcing your voice rules, and manages versioned drafts -- all without leaving Obsidian. It uses Claude (via the Anthropic API) to rewrite, expand, cut, adjust tone, fix dialogue, and more, guided by your style guide and voice tests.

<!-- Screenshots coming soon -->

## What PENNY Does

- **Process editorial annotations** -- Drop `%% REWRITE: more tension here %%` into your chapter and PENNY rewrites that passage for you.
- **Multi-provider LLM support** -- Use Anthropic Claude (cloud) for maximum quality, Ollama (local) for privacy and zero cost, or both at once with model routing.
- **Model routing by complexity** -- Simple tasks (CUT, PACING) can use a fast/cheap model while complex tasks (REWRITE, DIALOG) get the strongest model. Configure per-tier or use one model for everything.
- **Enforce voice consistency** -- PENNY reads your style guide and voice tests before every revision so the output sounds like your book, not a chatbot.
- **Manage chapter versions** -- Every revision creates a new numbered version (`ch-05.v1.md`, `ch-05.v2.md`, ...) with full history preserved.
- **Generate review notes** -- After processing, PENNY writes a review file summarizing what changed, word count deltas, and voice compliance flags.
- **Scaffold new novel projects** -- One command creates the entire directory structure, templates, and config file for a new book.
- **Handle git commits** -- Auto-generate descriptive commit messages for your writing sessions and push when you are ready.

## Quick Start

1. Install PENNY from Obsidian's Community Plugins browser (Settings > Community plugins > Browse > search "PENNY").
2. Configure a provider in Settings > PENNY > Providers: enter your Anthropic API key, or point PENNY at a running Ollama instance, or both.
3. Choose your model routing in Settings > PENNY > Model Routing (or leave the defaults).
4. Open a chapter file and add an annotation anywhere in the prose: `%% REWRITE: more tension here %%`
5. Open the command palette (Ctrl/Cmd + P) and run **PENNY: Process this chapter**.
6. PENNY creates a new version of the chapter in the same folder. Open it and review the changes.

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | First-time setup walkthrough |
| [Annotation Guide](docs/annotation-guide.md) | How to write annotations with examples |
| [Configuration](docs/configuration.md) | Every setting explained |
| [Project Structure](docs/project-structure.md) | Vault layout and what goes where |
| [Versioning](docs/versioning.md) | How chapter versions work |
| [Voice Enforcement](docs/voice-enforcement.md) | Voice rules, tests, and compliance |
| [Git Workflow](docs/git-workflow.md) | Commit and push integration |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [API Costs](docs/api-costs.md) | Understanding usage and costs |

## Requirements

- **Obsidian 1.5.0** or later
- **At least one LLM provider:**
  - **Anthropic API key** -- get one at [console.anthropic.com](https://console.anthropic.com) (cloud, paid per token)
  - **Ollama** -- install from [ollama.com](https://ollama.com) (local, free, runs on your machine)
  - Or both, for hybrid routing (e.g. local models for simple edits, Claude for complex work)
- **Desktop only** -- PENNY uses Node.js for git operations and is not available on Obsidian Mobile

## Installation

### From Community Plugins (Recommended)

1. Open Obsidian Settings > Community plugins.
2. Turn off Restricted mode if prompted.
3. Click **Browse** and search for "PENNY".
4. Click **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/KofTwentyTwo/obsidian-penny/releases/latest).
2. Create a folder called `penny` inside your vault's `.obsidian/plugins/` directory.
3. Copy the three files into that folder.
4. Restart Obsidian and enable PENNY in Settings > Community plugins.

## Commands

All commands are available from the command palette (Ctrl/Cmd + P).

| Command | Description |
|---------|-------------|
| **PENNY: Initialize project** | Scaffold a new novel project structure in the vault |
| **PENNY: Process this chapter** | Process all annotations in the active file |
| **PENNY: Process all chapters** | Process all annotated chapters in the current book |
| **PENNY: Dry run** | Show what would change without making any modifications |
| **PENNY: Migrate chapters** | One-time migration from flat chapter files to versioned folder structure |
| **PENNY: Show status** | Display annotation counts and version info for the active file |
| **PENNY: New chapter** | Create a new chapter file from template in the active book folder |
| **PENNY: New character** | Create a new character file from template |
| **PENNY: Commit progress** | Stage chapter and review changes, commit with auto-generated message |
| **PENNY: Push** | Push commits to remote |
| **PENNY: Commit and push** | Commit then push in one action |

## Annotation Reference

Annotations are Obsidian comments with a tag and instruction. Place them inline or between paragraphs.

```markdown
%% TAG: your instruction here %%
```

| Tag | Purpose | Processed? |
|-----|---------|------------|
| `REWRITE` | Rewrite the surrounding passage | Yes |
| `EXPAND` | Add depth, detail, or length | Yes |
| `CUT` | Remove or condense | Yes |
| `TONE` | Adjust voice or mood | Yes |
| `DIALOG` | Rework dialogue for voice, realism, or subtext | Yes |
| `PLOT` | Fix continuity or plot concerns | Yes (if specific) |
| `PACING` | Adjust pacing (too fast or too slow) | Yes |
| `CHARACTER` | Fix character voice or behavior | Yes |
| `NOTE` | Author's note to self | No -- passed through unchanged |
| `RESEARCH` | Needs fact-checking | No -- passed through, flagged in review |

See the [Annotation Guide](docs/annotation-guide.md) for full syntax, scope rules, and examples.

## Configuration

PENNY is configured through the Obsidian settings tab (Settings > PENNY) and optionally through a `PENNY.md` file at the root of your project folder for per-project overrides.

Key settings:

- **Providers** -- Configure Anthropic (API key) and/or Ollama (endpoint URL). Test connection buttons verify setup.
- **Model routing** -- Assign a provider + model to each complexity tier (Light, Standard, Heavy), or use one model for everything.
- **Project structure paths** -- Tell PENNY where your drafts, characters, style guide, outlines, and wiki live.
- **Voice rules** -- Custom rules injected into every revision prompt.
- **Behavior** -- Auto-process on save, verbose logging, file patterns.

See [Configuration](docs/configuration.md) for complete documentation of every setting.

## License

[MIT](LICENSE)
