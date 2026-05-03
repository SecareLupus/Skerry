# Cross-agent chat log

Append-only short summaries. One paragraph per turn. Format:

`## YYYY-MM-DD HH:MM — <agent>`

---

## 2026-05-02 — claude-code

Bootstrapped `.agent-shared/` with CONTEXT, WORKFLOW, TESTING, and a
CHANGELOG. Extended `AGENTS.md` with a pointer to the shared files
(preserving the existing Skerry guardrails) and created `CLAUDE.md` with
`@`-imports plus links to the existing `.agents/rules/` skills. Added three
skills (`bug-fix-test`, `handoff`, `verify-environment`) and two slash
commands (`/handoff`, `/verify-env`). Left the public test server section
in CONTEXT.md as a TODO for the user to confirm. Next agent: either.

## 2026-05-02 — claude-code

Re-applied the BugFixesAndPolish branch as Phase 27, one item at a time on
`Phase-27`. Five commits landed: theme FOUC guard (`fe54478`), modal
provider wrap (`83db799`), DM list+routing (`d86c360`), Discord reaction
tag-form + ReactionEmoji renderer (`dcd629b`), styling token rewire
(`f940bfd`). Added regression tests where reasonable (4 reducer tests +
5 encoder tests + 2 E2E specs). Item 6 was investigation-only:
unbackfilled Discord reactions on pangolin are mostly Unicode (correct)
plus 3 rows of `zombieTwerk` whose name was never seeded into
`discord_seen_emojis`. Item 7 stays deferred. Final localhost run:
146/146 unit + 29/29 E2E green. See
`implementation-reports/2026-05-02-1730-phase-27-items-1-through-6.md`
for the full report. Next agent: either.

## 2026-05-03T17:06Z — claude-code
Issue #21 (Settings menu theme persistence) — verified the Phase 27
FOUC guard in `apps/web/hooks/use-theme.ts` already fixes it. Added a
Playwright regression in `e2e/ui-regressions.spec.ts` that seeds
`localStorage.theme=dark`, navigates to `/settings`, reloads, and
asserts via `MutationObserver` that `data-theme` only ever holds
`"dark"` (no FOUC flash to light). Sensitivity-checked by removing
the guard, rebuilding `web`, watching it fail, then restoring. All
4 ui-regressions pass; 9/9 web unit pass; typecheck clean. Branch
`fix/issue-21-settings-theme`, report at
`implementation-reports/2026-05-03-1706-issue-21-settings-theme.md`.
Next agent: either.
## 2026-05-03 19:48 — claude-code

Started Sprint 1 (Skerry MVP) with concurrency analysis: identified 3 safe
parallel lanes — A: #21 (settings theme), B: #39 (New DM modal), C
(sequential): #35 → #40 → #41 → #45. Lane A landed via worktree agent
(`fix/issue-21-settings-theme`, commit `a029071`): no production change
needed — verified Phase 27's FOUC guard already handles refresh, added
Playwright regression that fails without the guard. Lane B agent hit
sandbox permission denials in the worktree but produced a clean diagnosis;
I picked Lane B up in the main tree on `fix/issue-39-new-dm-modal`. Two
real bugs fixed: (1) modal display-name fallback (`displayName ??
preferredUsername ?? matrixLocalpart`), and (2) `createDirectMessage`
missing `Content-Type: application/json`, which was the actual click-error
root cause (Fastify couldn't parse the body, zod 400'd). Bonus:
`searchIdentities` now self-excludes the requester. Tests: 1 new E2E +
1 control-plane assertion block extension. Suite: 121/121 control-plane,
9/9 web unit, 16/16 shared, 4/4 ui-regressions E2E, typecheck clean.
Lane C (#35/#40/#41/#45) still pending — separate session. Next agent:
either.

## 2026-05-03 22:30 — claude-code

Sprint 1 Lane C: shipped #35, #40, #41, #45 on a single branch
(`fix/sprint-1-dm-reactivity`). Root cause for #35/#40 collapsed to one
fix: backend `getOrCreateDMChannel` now publishes `channel.created` to
the hub, and `use-chat-realtime.ts` routes DM channel.created events
through `ADD_DM_CHANNEL` when the viewer is in `participants`. #45
needed a new endpoint (`DELETE /v1/channels/:id/members/me` →
`leaveDmChannel`) plus a sidebar context-menu entry guarded by the
existing confirmation modal; `dm.left` SSE event drives `REMOVE_DM_CHANNEL`
on the frontend. #41 added a `NotificationsPanel` (bell + dropdown)
to the topbar, surfacing DMs with unread + channels with @-mentions
(honoring mute state). Tests: 2 new control-plane (leave + non-DM
guard), 2 new web reducer (REMOVE_DM_CHANNEL with/without active
selection), 1 new Playwright E2E covering the full lifecycle. Suite on
localhost: shared 16/16, web 11/11, control-plane 123/123, E2E 33/33.
One pre-existing concern surfaced and noted in the report: the hub SSE
stream is not user-scoped, so DM channel.created payloads are visible
to all hub members on the wire even though the frontend filters them.
Per-user fan-out is the proper fix — left as follow-up. No active plan;
next agent: either.
