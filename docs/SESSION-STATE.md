# Session State

**Last Updated:** 2026-04-29 (overnight + early-morning autonomous run, paused for cross-machine handoff)

## TL;DR for the next session (any machine)

`feature/issue-30-warn-unknown-tags` is open with WIP code that needs parser tests added before it ships. Everything else is clean. PRs #65 (#17), #66 (#15), #67 (#31), #68 (#16), #69 (#5), #70 (#33) all merged to develop. Two backlog items remain in the original "fix them all" pass: **#30 (in progress, WIP committed)** and **#14 maxTokens cap (not started)**.

## What shipped overnight (all merged to develop)

| Issue | PR | Subject |
|---|---|---|
| #17 | #65 | SSE error events surfaced across all providers |
| #15 | #66 | Retry on 429 / transient 5xx with backoff |
| #31 | #67 | `.state.json.bak` snapshot before overwrite |
| #16 | #68 | Preserve whitespace in LLM responses |
| #5  | #69 | Correct dialogue regex; support all quote styles |
| #33 | #70 | Broaden detectCharacters regex (two-word, hyphen, apostrophe, all-caps names) |

## Active branch: `feature/issue-30-warn-unknown-tags`

Current commit: `1fbbf6f` (marked WIP). Adds `parseAnnotationsWithWarnings()` to `src/parser.ts`, plus `ParserWarning` / `ParsedAnnotations` types, and seeds `flags` in `pipeline.ts` from parser warnings so unknown tags / empty instructions / unclosed multi-line blocks surface in the review note's "Flags for Author" section.

`src/types.ts` extends `ReviewFlag.type` with three new variants:
- `unknown_tag`
- `empty_instruction`
- `unclosed_annotation`

### What's still needed before this can ship

Coverage gates currently fail. Floors are 91 / 90 / 97 / 79 (lines / statements / functions / branches); current measurement is 90.77 / 89.7 / 96.96 / 78.27. Per-file `src/parser.ts` is at lines 79.36% (floor 88) and functions 92.85% (floor 100). The new code paths are untested.

**Add to `test/parser.test.ts`:**

```ts
import { parseAnnotationsWithWarnings } from "../src/parser";

describe("parseAnnotationsWithWarnings", () => {
  it("warns on unknown tag", () => {
    const { annotations, warnings } = parseAnnotationsWithWarnings("%% REWIRTE: foo %%");
    expect(annotations).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "unknown_tag", line: 1 });
    expect(warnings[0].description).toContain("REWIRTE");
  });

  it("warns on empty instruction", () => {
    const { warnings } = parseAnnotationsWithWarnings("%% REWRITE:  %%");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "empty_instruction", line: 1 });
  });

  it("warns on unclosed multi-line annotation", () => {
    const { warnings } = parseAnnotationsWithWarnings("%% REWRITE: open\nfoo\nbar");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "unclosed_annotation", line: 1 });
  });

  it("returns empty warnings when all annotations are valid", () => {
    const content = '%% REWRITE: tighten this %%\n%% TONE: lighter %%';
    const { annotations, warnings } = parseAnnotationsWithWarnings(content);
    expect(annotations.length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(0);
  });

  it("returns valid annotations alongside warnings for invalid ones", () => {
    const content = '%% REWRITE: keep this %%\n%% NOPE: drop this %%';
    const { annotations, warnings } = parseAnnotationsWithWarnings(content);
    expect(annotations).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("unknown_tag");
  });
});
```

After tests pass: amend the WIP commit (or new commit), push, open PR.

## Remaining backlog from the "fix them all" pass

- [ ] **#30** Warn on unknown annotation tags — WIP on `feature/issue-30-warn-unknown-tags`, needs the tests above.
- [ ] **#14** Cap `maxTokens` against per-model output limits — not started. Plan: extend `ModelInfo.maxOutputTokens`, populate for ANTHROPIC_MODELS / GOOGLE_MODELS / OPENAI_MODELS, clamp in `pipeline.ts:299` (`maxTokens: Math.min(settings.maxTokens, modelInfo?.maxOutputTokens ?? settings.maxTokens)`), and log when clamping happens.

## Backlog NOT touched (need user direction)

These need UX or architectural decisions:

- **#46** Rollback command — UX choice: do we delete intermediate version files, or just rewind `.version`?
- **#9** Parallel annotations — concurrency tradeoffs: shared rate-limit bucket vs. per-provider concurrency cap. Now unblocked by #15 retry.
- **#13** Dry-run cost preview — modal UX choice.
- **#7** `commands.ts` refactor — large architectural change; defer until time permits.
- **47 parked items in #62** — community-store gating, CI hygiene, forward-leaning features.

## Tier overview after this run

| Tier | Done | Open |
|---|---|---|
| Tier 1 (block real writing) | #18, #17, #15 | #46 rollback |
| Tier 2 (cost & speed)       | #16            | #13, #9, #12, #14 |
| Tier 3 (correctness drift)  | #5, #31, #33   | **#30 (WIP)**, #14 |

## Resume instructions on another machine

```bash
cd ~/Git.Local/kof22/obsidian-penny  # or wherever you keep it
git fetch origin
git checkout feature/issue-30-warn-unknown-tags
git pull
npm install   # in case lockfile bumped on the other machine
npm run check # confirm the coverage failure described above
```

Then add the tests in `test/parser.test.ts` per the snippet above, run `npm run check`, amend `1fbbf6f` (or add a new commit), push, open PR.

## Coverage thresholds (current floors on develop)

- `vitest.config.ts`: lines 91 / statements 90 / functions 97 / branches 79
- `.munitor.yml`: `min_instruction: 90`
- Per-file ratchets locked in vitest.config.ts: `node-stream.ts` lines 96, etc.

## Key Reference

- **Audit tracker (master):** https://github.com/KofTwentyTwo/obsidian-penny/issues/62
- **Recent PRs:** #65–#70 all merged to develop
- **Open PRs:** none currently. PR #66's session-state file may still be uncommitted on the prior machine.
- **Local dev loop:** `cd /Users/james.maes/Git.Local/kof22/obsidian-penny && npm run dev` — Hot Reload picks up bundle changes automatically
- **Books vault plugin path:** `/Users/james.maes/Git.Local/kof22/Books/.obsidian/plugins/penny/` (three files are symlinks → repo root)
