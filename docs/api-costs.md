# API Costs

PENNY uses the Anthropic API to process annotations. You pay per token. This guide explains how costs work and how to manage them.

## How PENNY Uses the API

PENNY makes **one API call per annotation**, not per chapter. If a chapter has 5 annotations, that is 5 API calls. Each call includes:

1. **System prompt** -- PENNY's instructions, your voice rules, and the processing template.
2. **Context** -- Your style guide, voice tests, relevant character sheets, plot outline, and other project files loaded by priority.
3. **Chapter text** -- The full text of the current chapter.
4. **Annotation** -- The specific passage and your instruction.

The API response contains only the revised passage.

`NOTE` and `RESEARCH` annotations are never sent to the API. They are free.

## Token Counts for Different Operations

Token usage depends on how much context PENNY loads. Here are typical ranges:

### Input tokens (what you send)

| Component | Typical Size |
|-----------|-------------|
| System prompt + template | 500-1,000 tokens |
| Style guide | 500-2,000 tokens |
| Voice tests (matched section) | 300-1,500 tokens |
| Character sheets (1-3 characters) | 500-3,000 tokens |
| Plot outline | 500-2,000 tokens |
| Full chapter text | 2,000-10,000 tokens |
| Wiki/lore entries | 0-2,000 tokens |
| Series bible + themes | 0-3,000 tokens |
| **Total per annotation** | **4,000-20,000 tokens** |

A typical annotation with moderate context uses 8,000-12,000 input tokens.

### Output tokens (what comes back)

| Operation | Typical Output |
|-----------|---------------|
| REWRITE (paragraph) | 100-500 tokens |
| EXPAND (add a scene) | 300-1,500 tokens |
| CUT (condense) | 50-200 tokens |
| TONE (adjust passage) | 100-500 tokens |
| DIALOG (rework exchange) | 200-800 tokens |
| PACING (restructure) | 200-1,000 tokens |
| CHARACTER (fix voice) | 100-500 tokens |
| **Typical per annotation** | **100-800 tokens** |

### Thinking tokens

PENNY uses adaptive thinking, which means Claude may use additional tokens for internal reasoning before producing the output. Thinking tokens are billed at the input token rate. Typical thinking usage is 500-3,000 tokens per annotation.

## Context Assembly and Token Usage

The biggest variable in cost is context size. PENNY loads context by priority:

| Priority | Source | Impact on Cost |
|----------|--------|----------------|
| 1 | Full chapter | Always loaded. Longer chapters cost more. |
| 2 | Voice tests | Matched section only. Usually small. |
| 3 | Style guide | Always loaded. Keep it concise. |
| 4 | Plot outline | Always loaded. Bigger outlines cost more. |
| 5 | Character sheets | Loaded per character. More characters = more tokens. |
| 6 | Wiki entries | Loaded by term match. Varies widely. |
| 7 | Series bible | Only if budget permits. |
| 8 | Themes | Only if budget permits. |

If you want to reduce costs, the most effective lever is the context budget setting. Lowering it from 800,000 to 100,000 tokens means PENNY loads fewer low-priority sources (wiki, series bible, themes) and each call costs less.

## Cost Estimates by Model

Current Anthropic pricing (as of early 2026):

| Model | Input Price | Output Price | Thinking Price |
|-------|------------|-------------|----------------|
| Claude Opus 4 (`claude-opus-4-6`) | $5 / 1M tokens | $25 / 1M tokens | $5 / 1M tokens |
| Claude Sonnet 4 (`claude-sonnet-4-6`) | $3 / 1M tokens | $15 / 1M tokens | $3 / 1M tokens |
| Claude Haiku 3.5 (`claude-haiku-3-5`) | $1 / 1M tokens | $5 / 1M tokens | $1 / 1M tokens |

### Cost per annotation (estimated)

Using typical token counts of 10,000 input + 2,000 thinking + 400 output:

| Model | Input Cost | Thinking Cost | Output Cost | Total per Annotation |
|-------|-----------|---------------|-------------|---------------------|
| Opus | $0.05 | $0.01 | $0.01 | **~$0.07** |
| Sonnet | $0.03 | $0.006 | $0.006 | **~$0.04** |
| Haiku | $0.01 | $0.002 | $0.002 | **~$0.014** |

### Cost per chapter (estimated, 5 annotations)

| Model | Cost per Chapter |
|-------|-----------------|
| Opus | $0.20-$0.60 |
| Sonnet | $0.10-$0.30 |
| Haiku | $0.04-$0.10 |

### Cost per full novel revision (estimated, 25 chapters, 5 annotations each = 125 calls)

| Model | Cost per Novel Pass |
|-------|-------------------|
| Opus | $5-$15 |
| Sonnet | $3-$8 |
| Haiku | $1-$3 |

These are rough estimates. Actual costs depend on your chapter lengths, context size, and how much output each annotation generates.

**Note:** Anthropic pricing changes over time. Check [anthropic.com/pricing](https://www.anthropic.com/pricing) for current rates.

## Tips for Reducing Costs

### Use the right model for the job

- **Opus** for voice-critical scenes, complex emotional beats, and chapters where precision matters most.
- **Sonnet** for routine revisions, dialogue fixes, and general prose tightening. Good balance of quality and cost.
- **Haiku** for bulk first-pass processing, simple cuts, and when you plan to do a follow-up pass with a better model.

Switching models per chapter is easy -- change the model in settings before processing.

### Write fewer, better annotations

Five well-written annotations cost less and produce better results than fifteen vague ones. Each annotation is one API call.

Instead of:
```markdown
%% REWRITE: fix this %%
%% TONE: wrong %%
%% DIALOG: fix the dialogue %%
```

Write one:
```markdown
%% REWRITE: the tone is off and the dialogue doesn't match her voice. Rewrite to be casual, blunt, and technically specific. Check the Tim voice test. %%
```

### Reduce context budget

Lower the context budget in settings. A budget of 100,000 tokens still loads the chapter, style guide, voice tests, and character sheets -- the most important sources. It just skips the wiki, series bible, and themes.

### Keep your style guide concise

A 500-word style guide loaded into 125 API calls adds up. A 5,000-word style guide costs 10x more in input tokens across the same run. Say what matters. Cut what does not.

### Process in batches

Instead of annotating every chapter and running **Process all chapters**, process 3-5 chapters at a time. Review the results, adjust your approach if needed, then continue. This avoids paying for a full novel pass when your voice rules need tuning.

### Use dry runs

**PENNY: Dry run** shows what would change without making API calls. Use it to verify your annotations are well-formed and targeting the right passages before spending tokens.

## Monitoring in the Activity Log

PENNY writes a JSONL log file to your activity log folder (default: `.penny-log/activity.jsonl`). Each line records:

```json
{
  "timestamp": "2026-04-16T14:30:00Z",
  "book": "book-1",
  "chapter": "ch-05",
  "versionFrom": 3,
  "versionTo": 4,
  "annotationsProcessed": 4,
  "annotationsSkipped": 2,
  "wordCountBefore": 3200,
  "wordCountAfter": 3450,
  "tags": ["REWRITE", "EXPAND"],
  "durationMs": 45000,
  "model": "claude-opus-4-6"
}
```

Use this to track:
- How many annotations you process per session.
- Which models you use most.
- How long processing takes.
- Word count trends across revisions.

For precise token and cost tracking, check your usage dashboard at [console.anthropic.com](https://console.anthropic.com).
