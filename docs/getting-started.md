# Getting Started with PENNY

This guide walks you through installing PENNY, connecting it to the Anthropic API, and processing your first annotation.

## 1. Install the Plugin

### Option A: Community Plugin Browser

1. Open Obsidian and go to **Settings > Community plugins**.
2. If prompted, turn off **Restricted mode**.
3. Click **Browse**.
4. Search for **PENNY**.
5. Click **Install**, then **Enable**.

### Option B: Manual Install

Use this if PENNY is not yet in the community browser or you want to install from source.

1. Go to the [releases page](https://github.com/KofTwentyTwo/obsidian-penny/releases/latest).
2. Download three files: `main.js`, `manifest.json`, and `styles.css`.
3. In your vault's root folder, navigate to `.obsidian/plugins/`. If `plugins/` does not exist, create it.
4. Create a new folder called `penny` inside `plugins/`.
5. Copy the three downloaded files into `.obsidian/plugins/penny/`.
6. Restart Obsidian (or reload without cache: Ctrl/Cmd + Shift + R on desktop).
7. Go to **Settings > Community plugins**, find PENNY in the list, and toggle it on.

## 2. Configure an LLM Provider

PENNY supports multiple LLM providers. You need at least one.

### Option A: Anthropic (Claude API -- Cloud)

Best for: highest-quality prose revision, voice matching, complex scenes.

1. Go to [console.anthropic.com](https://console.anthropic.com).
2. Create an account or sign in.
3. Navigate to **API Keys** and click **Create Key**.
4. Copy the key. You will not be able to see it again.
5. In Obsidian, go to **Settings > PENNY > Providers**.
6. Paste the key into the **Anthropic API key** field.
7. Click **Test Anthropic connection** to verify.

**Pricing note:** Anthropic charges per token. PENNY makes one API call per annotation (not per chapter). A typical revision pass on a chapter with 5 annotations costs roughly $0.50-$2.00 depending on the model and context size. See [API Costs](api-costs.md) for detailed estimates.

**Which plan?** Any Anthropic API plan works. There is no minimum tier requirement. You load credits and pay for what you use.

### Option B: Ollama (Local Models -- Free)

Best for: privacy, zero cost, offline work, simple edits.

1. Install Ollama from [ollama.com](https://ollama.com). It runs on macOS, Linux, and Windows.
2. Pull a model. Open a terminal and run:
   ```bash
   ollama pull llama3.2
   ```
   Other good choices: `mistral`, `deepseek-coder`, `gemma2`. See [Ollama's model library](https://ollama.com/library) for the full list.
3. Ollama starts automatically after install. Verify it is running:
   ```bash
   ollama list
   ```
4. In Obsidian, go to **Settings > PENNY > Providers**.
5. The **Ollama endpoint** defaults to `http://localhost:11434`. Change this only if Ollama runs on a different host or port.
6. Click **Test Ollama connection** to verify. PENNY will list your locally available models.

**No API key needed** for local Ollama. If you use a remote/hosted Ollama instance that requires authentication, enter the key in the optional **Ollama API key** field.

### Option C: Both (Hybrid Routing)

You can configure both providers and use model routing to send different tasks to different models. For example:
- Light tasks (CUT, PACING) go to a fast local Ollama model (free)
- Heavy tasks (REWRITE, DIALOG, CHARACTER) go to Claude Opus (best quality)

Set this up in **Settings > PENNY > Model Routing** after configuring both providers. See [Configuration](configuration.md) for details.

## 3. Choose Your Model

1. In Obsidian, go to **Settings > PENNY > Model Routing**.
2. By default, **Use same model for all tiers** is on. Pick a provider and model from the dropdowns.
3. If you want different models for different annotation types, turn the toggle off and configure each tier separately.

API keys and endpoints are stored locally in your vault's plugin data (`.obsidian/plugins/penny/data.json`). They are never sent anywhere except the configured provider endpoints.

## 4. Set Up Your Project

You have two options: start from scratch or configure PENNY for an existing vault.

### Option A: Start a New Project

Run the **PENNY: Initialize project** command from the command palette (Ctrl/Cmd + P).

A wizard walks you through setup:

1. **Project name** -- The name of your novel or series. PENNY creates a root folder with this name.
2. **Number of books** -- How many books in the series (default: 1).
3. **Chapters per book** -- How many chapter files to scaffold (default: 20).
4. **Include templates?** -- Whether to create reusable templates for chapters, characters, locations, etc.
5. **POV and tense** -- First or third person, past or present tense. PENNY pre-fills your style guide with these choices.

PENNY creates the full directory structure:

```
Your Novel/
  00-series/       Series bible, arc, themes, timeline
  01-world/        World-building
  02-characters/   Character sheets
  03-plot/         Outlines per book
  04-drafts/       Prose chapters (versioned)
  05-wiki/         Living knowledge base
  06-reference/    Style guide, voice tests, research
  07-reviews/      Review notes from PENNY
  templates/       Reusable file templates
  PENNY.md         Project-level configuration
```

Each scaffolded file includes section headings and guidance prompts so you know what to put where.

### Option B: Configure for an Existing Vault

If you already have chapters and notes in your vault, you do not need to reorganize. Tell PENNY where things are.

1. Go to **Settings > PENNY > Project Structure**.
2. Set paths to match your vault layout:
   - **Drafts folder** -- Where your chapter files live (e.g., `04-drafts` or `chapters` or `drafts/book-1`)
   - **Style guide** -- Path to your style guide file (e.g., `reference/style-guide.md`)
   - **Character sheets folder** -- Where character files are (e.g., `characters`)
   - **Plot outlines folder** -- Where your outlines are (e.g., `outline`)

All paths are relative to the vault root. Leave any path blank to disable that context source.

3. If your chapter files are flat (e.g., `ch-01.md` instead of `ch-01/ch-01.v1.md`), run **PENNY: Migrate chapters** to convert them to the versioned folder structure. See [Versioning](versioning.md) for details.

## 5. Your First Annotation

Open a chapter file -- either one you wrote or one of the scaffolded templates -- and add some prose. Then add an annotation.

### Step by step:

1. Open a chapter file (e.g., `04-drafts/book-1/ch-01/ch-01.v1.md`).

2. Write some prose below the `<!-- Prose begins below -->` marker. For example:

   ```markdown
   The lab was quiet. She sat at the desk and looked at the screen.
   ```

3. Add an annotation directly after the passage you want revised:

   ```markdown
   The lab was quiet. She sat at the desk and looked at the screen.
   %% REWRITE: Add sensory detail -- the hum of the servers, the blue glow of monitors, the smell of old coffee. Make it feel like 3am. %%
   ```

4. Save the file.

That is it. The annotation is an Obsidian comment (`%% ... %%`) with a tag (`REWRITE`) and your instruction.

## 6. Your First Revision

1. With the chapter file open, press **Ctrl/Cmd + P** to open the command palette.
2. Type "PENNY" and select **PENNY: Process this chapter**.
3. PENNY reads the file, finds all annotations, assembles context from your project files (style guide, character sheets, outline, etc.), and sends each annotation to Claude for processing.
4. Wait for the status bar to show completion. For a single annotation, this typically takes 10-30 seconds.

### What happens:

- PENNY creates a **new version** of the chapter. If you were editing `ch-01.v1.md`, the output is `ch-01.v2.md` in the same folder.
- The `.version` file in the chapter folder updates from `1` to `2`.
- Processed annotations are **removed** from the new version and replaced with revision markers:
  ```markdown
  %% REVISED(v2): [REWRITE] "Added sensory detail to lab scene" -- 18 words -> 52 words %%
  ```
- Any `NOTE` or `RESEARCH` annotations are **kept** in the new version unchanged.
- A **review note** is written to `07-reviews/book-1/ch-01.v2-review.md` with a summary of changes, word counts, and voice compliance flags.

## 7. Understanding the Output

### The new version file

Open `ch-01.v2.md`. You will see:

- Updated frontmatter (`agent_version: 2`, updated `wordcount`, `agent_annotations_pending` reflecting any remaining annotations).
- The revised prose where your annotated passage was.
- Revision markers (`%% REVISED(v2): ... %%`) showing what changed.
- Any `NOTE` or `RESEARCH` annotations still in place.

### The review note

Open `07-reviews/book-1/ch-01.v2-review.md`. It contains:

- Timestamp and annotation counts.
- A summary of each annotation that was processed (tag, instruction, word count before and after).
- Flags for any `RESEARCH` or `PLOT` annotations that need your attention.
- Voice compliance results: dialogue-to-narration ratio, long narration sentences, internal monologue detection.

### The status bar

The bottom-left of Obsidian shows PENNY's status: `PENNY: 0 annotations in ch-01 (v2)`. This updates as you add annotations and process chapters.

## Next Steps

- Read the [Annotation Guide](annotation-guide.md) to learn all the annotation tags and how to write effective instructions.
- Read [Voice Enforcement](voice-enforcement.md) to set up voice rules and tests so PENNY matches your prose style.
- Read [Configuration](configuration.md) to understand every setting.
