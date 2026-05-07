---
created_by: claude-code
last_updated: 2026-05-07T14:50:00Z
next_agent: either
status: in-progress
---

> **Note (2026-05-07 14:50):** Issue #23 Slice C (invite management
> + default badges + redemption audits + role_bindings dedup)
> landed on the same branch (PR #92). User scoped Slice C explicitly
> after rejecting "merge as-is + separate ticket": invite-only
> cleanup, with the broader permissions sprint carved out. Backend
> shipped in commit `b767da7` (3 migrations, list/revoke endpoints,
> defaultBadgeIds, audit logs, idempotent redemption, 4 new
> integration tests); UI in the next commit (settings invite-
> management page + badge picker in create modal). Web 12/12,
> shared 16/16, typecheck clean. Control-plane integration tests
> **not** run (no docker stack) — six untested cases between B and
> C. Pangolin verification still owed for Slice A. Implementation
> report at
> `implementation-reports/2026-05-07-1450-issue-23-invite-management-and-badges.md`.
>
> **Issue #23 is now feature-complete on PR #92.** Remaining before
> merge: run the control-plane integration suite, exercise Slice A
> on pangolin. The "permissions sprint" referenced in Slice C
> scoping is a future milestone (own ticket); the dead
> `canManageServer`-without-`canManageHub` branch in invite creation
> stays as-is for the sprint to activate or delete.

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
  - [x] **Slice C** — Invite management + default badges + audits +
    dedup. On the same branch + PR #92. Backend in `b767da7`, UI in
    the next commit. Carve-out: the broader "permissions sprint"
    is its own future ticket — Slice C deliberately does not touch
    the `canManageHub`-vs-`canManageServer` gating on invite
    creation. Report at
    `implementation-reports/2026-05-07-1450-issue-23-invite-management-and-badges.md`.

- [ ] **Permissions sprint** (must land before #34 per user request).
  Three slices, separate PRs, foundation first.
  - [ ] **P1 — Role enum cleanup.** Drop `user` and `visitor` from
    the `Role` enum (they're tier classifiers derived from
    membership, not granted roles). Migration: ensure matching
    `hub_members` row exists before deleting `role='user'`
    bindings; drop `role='visitor'` bindings (always empty). Rewire
    `voice.token.issue` from "user role" to "is hub member" check.
    Update `MasqueradeParamsSchema` enum and frontend usages of
    `binding.role === 'user'`. Document `space_moderator` boundary
    in code comment. **Must not break bridged Discord user lists
    in bridged rooms** — verify what role bindings bridged Discord
    identities currently carry before running the migration.
  - [ ] **P3 — Default Space Owner = Hub.** `servers.owner_user_id`
    becomes nullable; null means hub-owned (any hub manager can
    manage). New-space creation flow gets a "owned by you / owned
    by hub" choice (default: hub). Existing data preserved.
    Auto-join policy + join_policy controls exposed in Space
    Settings UI.
  - [ ] **P2 — Audience tiers, cascade, and capability split.**
    Largest slice.
    - Replace per-resource `*_access` columns with a normalized
      `channel_access_rules` table keyed on
      (channel_id, audience_tier, capability) where capability is
      one of {visibility, read, write}. Same shape for spaces.
    - Audience tier ladder: `visitor`, `hub_member`, `space_member`,
      `space_moderator`, `space_admin` (owner inherits admin;
      hub admin spans hubs).
    - Visibility resolution: Hub → Space → Room cascade with
      narrower-tier override at each step. Hub-level lockout
      (no public default server) is **not** overridable by
      spaces — visitor access is bounded above by the hub.
    - **Split `canManageServer` into specific capability gates:**
      `canModerateServer` (chat cleanup), `canEditServerSettings`
      (rename, configure), `canManageServerRoles`,
      `canManageRooms`. `space_moderator` joins the moderation
      gate but stays excluded from settings/roles/rooms gates —
      matches the user's "moderators clean up chat but don't edit
      space/room settings" intent.
  - **Out of scope:** per-hub `permissionMatrix` overrides. Future
    sprint.

- [ ] **Issue #34** — Onboarding Display Name. Pending.
  - Context: Not yet investigated this session. Read the issue + code
    before scoping. **Blocked on the permissions sprint per user
    request.**

- [ ] **Issue #38** — Changing Server Permissions Does Not Update Backend.
  Pending.
  - Context: Not yet investigated this session. Read the issue + code
    before scoping. **Likely related to or subsumed by P2 of the
    permissions sprint** — re-scope after P1/P3 land.

## Open Questions

- For #23: which slice does the user want first? Slice A is the
  recommended start (smallest, fixes a visible regression), but the
  user has not yet confirmed. Default to Slice A if the user does not
  pick one.
- Should the "two productUserIds when emails differ" downstream concern
  noted in the #9 report be filed as a separate issue?

## Blocking Issues

None.
