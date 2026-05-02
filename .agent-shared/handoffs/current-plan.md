---
created_by: claude-code
last_updated: 2026-05-02
next_agent: claude-code
status: in-progress
---

# Plan: Phase 27 — BugFixesAndPolish Retry

## Goal
Re-apply the fixes from the `BugFixesAndPolish` branch one at a time on
`Phase-27` (forked from main), instead of as a single batch. Each item is
landed and verified in isolation so partial outcomes are diagnosable.
Reference branch: `BugFixesAndPolish` — commits `53c5ea7`, `e1b1bde`,
`fe015e9`. See `TODO.md` Phase 27 for full prior-approach context per item.

Focus: do not break the currently-passing test suite, and add regression
tests where the fix admits one without disproportionate scaffolding.

## Steps
- [ ] **Item 1** — Theme toggle FOUC guard. Re-apply
  `apps/web/hooks/use-theme.ts` so the FOUC guard runs only on first
  mount; add Playwright regression in `apps/web/e2e/ui-regressions.spec.ts`.

- [ ] **Item 2** — Wrap `ModalManager` inside `ChatHandlersProvider` in
  `apps/web/components/chat-client.tsx`. Add `Bug 5` E2E test alongside
  the theme spec.

- [ ] **Item 3** — `ADD_DM_CHANNEL` reducer action + dispatch from
  `apps/web/components/dm-picker-modal.tsx`. Add the 4 reducer tests from
  `chat-context-reducer.test.ts` (node:test).

- [ ] **Item 4** — Extend `refreshChatState` in
  `apps/web/hooks/use-chat-initialization.ts` with `extraKnownChannels`
  fallback; DM picker passes the new channel through. Depends on Item 3.
  Trace that `extraKnownChannels` is populated at the validation site
  before declaring fixed.

- [ ] **Item 5** — Backend stores Discord reactions in tag form
  (`apps/control-plane/src/services/discord-bot-client.ts`); frontend
  `ReactionEmoji` parses tag and renders CDN URL in
  `apps/web/components/chat-window.tsx`.

- [ ] **Item 6** — Investigate emoji backfill remainder. Run the bucketing
  query against pangolin and classify unbackfilled rows into the three
  failure modes; decide remediation from results.

- [ ] **Item 8** — Visual diff DM picker / reaction buttons against main
  to confirm whether drift exists; cherry-pick token + class additions
  from `53c5ea7`/`fe015e9` only if drift is real.

(Item 7 — Skerry-side mirror — remains deferred per TODO.md.)

## Open Questions
- Should Item 6's investigation block Item 5's commit, or land Item 5 first
  and investigate Item 6 against the resulting state? Leaning latter since
  Item 5 is the fresh-rows fix and Item 6 is the historical-rows fix.

## Blocking Issues
None at start.
