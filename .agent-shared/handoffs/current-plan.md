---
created_by: claude-code
last_updated: 2026-05-07T12:16:00Z
next_agent: either
status: in-progress
---

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
    Branch `fix/issue-23-unauth-invite-redeem`. PR pending. Report at
    `implementation-reports/2026-05-07-1216-issue-23-unauth-invite-redeem.md`.
    Open follow-up: E2E coverage for the logged-out → OIDC → autojoin
    chain (none added in this slice).
  - [ ] **Slice B** — Role/server baking on invites. **NEXT** for
    issue #23. Schema migration adds `default_role` and
    `default_server_id` to `hub_invites`; `createHubInvite` accepts
    and persists them; `useHubInvite` applies the role binding and
    auto-joins the named server (when present). Frontend create-invite
    modal exposes optional dropdowns (role-picker space-admin only).
    Estimated medium scope; one PR.
  - [ ] **Slice C** — Broader permissions/invites cleanup. Vague —
    needs a scoping conversation before another agent picks it up.
    Out of scope for one PR.

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
