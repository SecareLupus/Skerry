---
created_by: claude-code
last_updated: 2026-05-07T13:30:00Z
next_agent: user
status: in-progress
---

> **Note (2026-05-07 13:30):** Issue #23 Slice B (default role +
> default server on invites) landed on the same branch as Slice A
> (`fix/issue-23-unauth-invite-redeem`, PR #92). Schema migration +
> shared type extension + service + route + UI + 2 new control-plane
> test cases. Web unit 12/12, shared unit 16/16, typecheck clean.
> Control-plane integration tests **not** run (no docker stack); the
> two new cases were written but unexecuted. E2E **not** added for
> Slice B; existing invite spec still passes (only the heading matcher
> was updated for Slice A). Slice A pangolin verification still owed.
> Implementation report at
> `implementation-reports/2026-05-07-1330-issue-23-default-role-and-server.md`.
>
> **Slice C decision deferred to user.** The issue body is fully
> covered by A + B. Slice C as originally framed
> ("broader permissions/invites cleanup") is too vague to implement
> without direction. The Slice B report enumerates concrete candidates
> for a follow-up ticket. Asked the user whether to (a) merge PR #92
> against #23 and file Slice C as a separate ticket, or (b) lock in a
> concrete C scope for this PR. **next_agent: user** until they
> answer.

> **Note (2026-05-07 12:16):** Issue #23 Slice A (unauthenticated
> invite redeem + modal title) landed on
> `fix/issue-23-unauth-invite-redeem`. Web unit 12/12, typecheck clean,
> E2E **not** run — flagged in the report. Slices B (role/server baking
> on invites) and C (permissions/invites cleanup) of #23 remain open.
> Implementation report at
> `implementation-reports/2026-05-07-1216-issue-23-unauth-invite-redeem.md`.

> **Note (2026-05-04 14:35):** Sprint 2 kicked off. Issue #9 (Multiple OIDC
> Accounts "Guest" Issue) merged via PR #91 (commit `0ea2018`).
> Implementation report at
> `implementation-reports/2026-05-04-1435-issue-9-oidc-display-name.md`.
> Agent (claude-code) failed to read `.agent-shared/` at session start
> and proceeded as if no prior cross-agent protocol existed; the user
> caught this and the agent course-corrected mid-session. Subsequent
> Sprint 2 work should follow the protocol from the start.

# Plan: Skerry MVP Sprint 2

## Goal
Land all four Sprint 2 issues from GitHub Project #2 (`Skerry MVP Sprint
Plan`), one PR per issue. The user is near a weekly model-usage cap, so
**no batching, no overlapping branches**.

## Steps

- [x] **Issue #9** — Multiple OIDC Accounts "Guest" Issue.
  Done by claude-code (PR #91, branch `fix/issue-9-oidc-display-name`).
  See `implementation-reports/2026-05-04-1435-issue-9-oidc-display-name.md`.

- [ ] **Issue #23** — Invite Link Buttons Do Not Currently Generate Links.
  Assigned to: either. Sliced into A/B/C; tracking each below.
  - [x] **Slice A** — Unauthenticated redeem flow + modal title fix.
    On branch `fix/issue-23-unauth-invite-redeem` (PR #92). Report at
    `implementation-reports/2026-05-07-1216-issue-23-unauth-invite-redeem.md`.
    Open follow-up: E2E coverage for the logged-out → OIDC → autojoin
    chain (none added in this slice); manual pangolin verification.
  - [x] **Slice B** — Default role + default server on hub invites.
    Same branch + PR. Schema migration `030`, shared
    `INVITE_BAKEABLE_ROLES`, route validation, modal pickers, two new
    control-plane integration tests (NOT run this session). Report at
    `implementation-reports/2026-05-07-1330-issue-23-default-role-and-server.md`.
  - [ ] **Slice C** — Broader permissions/invites cleanup. Vague.
    Awaiting user decision: merge PR #92 against #23 and file C as a
    separate ticket, or lock in a concrete C scope for this PR. The
    Slice B report lists four concrete candidate items for a follow-up
    ticket.

- [ ] **Issue #34** — Onboarding Display Name. Pending.
  - Context: Not yet investigated this session. Read the issue + code
    before scoping.

- [ ] **Issue #38** — Changing Server Permissions Does Not Update Backend.
  Pending.
  - Context: Not yet investigated this session. Read the issue + code
    before scoping.

## Open Questions

- For #23: which slice does the user want first? Slice A is the
  recommended start (smallest, fixes a visible regression), but the
  user has not yet confirmed. Default to Slice A if the user does not
  pick one.
- Should the "two productUserIds when emails differ" downstream concern
  noted in the #9 report be filed as a separate issue?

## Blocking Issues

None.
