# TODO

Personal-use sprint — issues that block daily writing use of PENNY.
Full audit list and tracker: [#62](https://github.com/KofTwentyTwo/obsidian-penny/issues/62).

## Tier 1 — Will bite during real sessions

- [x] **#18** LLM call timeout (PR #64 merged)
- [x] **#17** SSE error events surfaced (PR #65, ready to merge)
- [ ] **#15** Retry on 429 / transient 5xx with `Retry-After` + exponential backoff
- [ ] **#46** Roll-back command (revert to a previous chapter version cleanly)

## Tier 2 — Cost & speed quality of life

- [ ] **#13** Dry-run cost preview + confirmation gate above threshold
- [ ] **#9** Process annotations in parallel (configurable concurrency) — *depends on #15 retry*
- [ ] **#12** Multi-line annotation cap surfaces warning instead of silent truncate
- [ ] **#16** Remove provider `.trim()` — preserve meaningful whitespace

## Tier 3 — Correctness drift

- [ ] **#5** Fix dialogue regex (single-quoted/British dialogue currently uncounted)
- [ ] **#30** Warn on unknown annotation tags (typo'd `%% REWIRTE: ... %%` is silently dropped)
- [ ] **#33** `detectCharacters` regex misses two-word names, apostrophes, all-caps shouted dialogue
- [ ] **#31** Write `.bak` snapshot of `.state.json` before overwrite (recovery)
- [ ] **#14** Cap `maxTokens` against per-model output limits (avoid opaque 400s)

## Out of scope for this sprint

The remaining 47 audit-derived issues are tracked in [#62](https://github.com/KofTwentyTwo/obsidian-penny/issues/62). They cover community-store gating (#4 quotes legal, #8 inline styles, #19 API key warnings, #26 mobile guard), the big `commands.ts` refactor (#7), CI hygiene (#40, #43), and forward-leaning features. Pick up after this sprint stabilizes.

## Workflow notes

- Branch from `develop` as `feature/issue-XX-short-name`.
- TDD: write a failing test first, prove it fails on `develop`, then fix.
- Each PR ratchets `vitest.config.ts` per-file thresholds up to lock in coverage gains.
- `npm run check` mirrors CI: typecheck + tests + coverage gate.
- Hot Reload watches `Books/.obsidian/plugins/penny/main.js` (symlinked to repo root); `npm run dev` keeps the bundle fresh on save.
