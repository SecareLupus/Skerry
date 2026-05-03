---
created_by: claude-code
last_updated: 2026-05-02
next_agent: either
status: complete
---

> **Note (2026-05-02):** Phase 27 merged via PR #37 (`edfb91e`). A
> follow-up fix for Issue #22 (Discord Bridge OAuth scroll/state
> restore) merged separately via PR #47 (`72aaae4`, commits `29785c3`
> + `61134c9` + `171c2de`) and the corresponding TODO.md entry has been
> checked off. No active plan is in flight; the user's next request
> should seed a new plan.

# Plan: Phase 27 — BugFixesAndPolish Retry

## Goal
Re-apply the fixes from the `BugFixesAndPolish` branch one at a time on
`Phase-27` (forked from main), instead of as a single batch.

## Steps
- [x] **Item 1** — Theme toggle FOUC guard re-applied with E2E regression
  (`fe54478`).
- [x] **Item 2** — `ModalManager` wrapped in `ChatHandlersProvider` with
  E2E regression (`83db799`).
- [x] **Items 3+4** — `ADD_DM_CHANNEL` reducer + DM-list optimistic seed
  + channel-membership recovery, with 4 reducer regression tests
  (`d86c360`).
- [x] **Item 5** — Discord reactions stored in tag form; `ReactionEmoji`
  renders CDN URL; 5 encoder regression tests (`dcd629b`).
- [x] **Item 6** — Investigation only, no code change. See
  `implementation-reports/2026-05-02-1730-phase-27-items-1-through-6.md`
  — partial backfill is mostly Unicode (correct); only one custom name
  (`zombieTwerk`, 3 rows on pangolin) is genuinely missing because the
  bot never seeded it into `discord_seen_emojis`.
- [x] **Item 8** — DM picker + reaction button rewired to current theme
  tokens; `--bg-strong` (light), `--accent-soft` (both), `.interaction-btn`,
  scrollbar styling, modal scoped styles added (`f940bfd`).

(Item 7 — Skerry-side mirror — remains deferred per `TODO.md`.)

## Final verification (localhost)
- Unit: 146/146 (shared 16, web 9, control-plane 121).
- E2E: 29/29 on the post-Item-8 build.

## Open Questions
- Should the optional Item 6 follow-ups (one-shot manual backfill of
  `zombieTwerk`'s 3 rows + extending the bot's reaction-event seed
  logic) land as a separate PR, or are 3 stale rows acceptable as-is?
- One unrelated flake observed in `messaging.spec.ts:145` (reactions +
  threaded replies) during the post-Items-3+4 run; recovered on retry
  and did not recur. Worth a closer look if it returns.

## Blocking Issues
None.
