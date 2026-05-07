# Issue #23 Slice C — Invite Management, Default Badges, Audits, Dedup

Slice C of three. Layered onto the same branch as A and B
(`fix/issue-23-unauth-invite-redeem`, PR #92). Together A + B + C
close out #23 against the issue body and the user's "permissions &
invites cleanup" comment, with one clean carve-out for the broader
permissions sprint.

Two commits landed for Slice C:

- `b767da7` — backend (migrations + service + routes + tests +
  client helpers + nav entry).
- This commit — UI surfaces (invite-management settings page +
  badge picker in the create modal).

## What changed

### Schema (migrations 031 / 032 / 033)

- **031:** `hub_invites.revoked_at` (nullable timestamptz) plus a
  partial index `hub_invites_active_by_hub` on `hub_id` where
  `revoked_at is null` so the list endpoint stays cheap as the
  revoked tail grows.
- **032:** `hub_invite_default_badges (invite_id, badge_id)` join
  table with a unique constraint on the pair and a covering index
  on `invite_id`. Both columns have `references … on delete
  cascade` so deleting an invite or a badge cleans up the join row.
- **033:** Pre-existing `role_bindings` duplicate cleanup followed
  by a unique index `role_bindings_natural_key` on
  `(product_user_id, role, coalesce(hub_id, ''),
  coalesce(server_id, ''), coalesce(channel_id, ''))`. Coalesce is
  necessary because Postgres treats NULL-bearing tuples as distinct
  by default, which would defeat the dedup intent for hub-only or
  server-only bindings.

### Shared

- `HubInvite` gains `defaultBadgeIds: string[]` and
  `revokedAt: string | null`.

### Control plane service (`server-service.ts`)

- New: `listHubInvites(hubId)` — only non-revoked rows; ordered
  newest first.
- New: `revokeHubInvite({ inviteId, hubId })` — soft-delete via
  `revoked_at = now()`. Returns boolean for "actually changed";
  the route uses this to differentiate 404 from 204.
- Updated: `getHubInvite` now filters out revoked invites — the
  public splash 404s for them, and `useHubInvite` rejects them via
  the same null-return path it already used for "not found".
- Updated: `createHubInvite` accepts `defaultBadgeIds` and persists
  them in a single multi-row insert with conflict guard.
- Updated: `useHubInvite`
  - **Idempotent:** the new `role_bindings_natural_key` makes the
    `on conflict (product_user_id, role, coalesce(...) ...) do
    nothing` clause meaningful. Re-redeeming the same invite
    produces exactly one binding.
  - **Audited:** writes `role_assignment_audit_logs` only when a
    fresh binding actually landed. Actor of record is the inviter
    (`created_by_user_id`), target is the redeemer, role/scope
    matches the binding. Same shape as `/v1/roles/grant` audit
    rows so downstream tooling doesn't need to special-case
    invite-driven grants.
  - **Badge-aware:** applies `defaultBadgeIds` to `user_badges`
    with `on conflict (product_user_id, badge_id) do nothing`.
    The existing unique constraint makes this idempotent without
    any new index.
  - **Documented:** new prose comment on the join_policy bypass
    decision — invite is the consent mechanism; the hub admin's
    intent stands in for the named server's per-server approval.

### Routes (`invite-routes.ts`)

- `POST /v1/hubs/:hubId/invites` body now accepts
  `defaultBadgeIds: string[]` (max 20). The route resolves each id
  to a `(badge_id, hub_id)` row, returns 400
  `invite_invalid_default_badge` for unknown ids OR ids belonging
  to a different hub.
- `GET /v1/hubs/:hubId/invites` — hub-managers list active invites.
  Returns `{ items: HubInvite[] }`.
- `DELETE /v1/hubs/:hubId/invites/:inviteId` — soft delete. 204 on
  success, 404 on missing-or-already-revoked. The hub-id is part
  of the path so an attacker can't revoke another hub's invite by
  guessing an id.

### Web

- `lib/control-plane.ts` — new `listHubInvites`, `revokeHubInvite`
  helpers; `createHubInvite` accepts `defaultBadgeIds`.
- `app/settings/hub/invites/page.tsx` (NEW) — hub-managers' invite
  table. Columns: invite id (click-to-copy), default role,
  default server (resolved by name), badge count, uses
  (`current / max` if capped), creation date, revoke button.
  Revoke confirms via `window.confirm` ("already-redeemed users
  keep their access; the link will stop working immediately"),
  then calls the DELETE endpoint and removes the row from local
  state. The page is wired into the settings nav as a new
  "Hub Invites" entry, gated on `canManageHub` like the existing
  "Hub Members" entry.
- `components/modals/InviteModals.tsx` — when the modal opens,
  fetches badges from every server in the hub via
  `Promise.all(servers.map(fetchBadges))` and renders them in a
  scrollable multi-select fieldset. Selected ids are sent as
  `defaultBadgeIds` on create. Pickers reset on modal close.

### Tests

Four new control-plane integration cases (in
`hub-invites.test.ts`):

1. **List + revoke + redemption survival.** Create an invite,
   redeem it once, list (asserts presence), revoke (asserts 204),
   list again (asserts absence), public lookup (asserts 404),
   late-redeem attempt (asserts non-success), original redeemer's
   role binding still exists.
2. **Idempotent redemption.** Redeem the same invite twice with
   the same user; assert exactly one `role_bindings` row and
   exactly one `role_assignment_audit_logs` row.
3. **Default badges granted.** Create an invite with one
   `defaultBadgeIds` entry; redeem; assert `user_badges` contains
   the row.
4. **Cross-hub badge guard.** Insert a fabricated alien hub +
   server + badge directly via SQL, attempt to bake that badge
   into our hub's invite, assert 400
   `invite_invalid_default_badge`.

### What's NOT in this slice

- No E2E tests for the new settings page or badge picker. Per the
  agreed scope.
- The "permissions sprint" — the broader
  `{Hub|Server} × {Visitor|Member|Admin|Owner}` model — stays out.
  In particular: the dead `canManageServer`-without-`canManageHub`
  branch in invite creation that I introduced in Slice B is still
  there as dead code; the permissions sprint will activate or
  delete it.

## Tests run

- `pnpm --filter @skerry/shared build` — clean.
- `pnpm --filter @skerry/shared test` — 16/16.
- `pnpm --filter @skerry/web test` — 12/12.
- `pnpm --filter @skerry/control-plane exec tsc --noEmit` — clean for
  changed files (pre-existing `link-service.ts` error remains).
- `pnpm --filter @skerry/web exec tsc --noEmit` — clean for changed
  files (pre-existing errors in `link-service.ts`, `embed-card.tsx`,
  `e2e/helpers/a11y.ts`, stale `.next/types/...` remain).
- **NOT run this session:** the control-plane integration suite
  (no docker stack). The four new `hub-invites.test.ts` cases plus
  the two from Slice B were written but not executed.

## Open issues / follow-ups

- **CP integration suite needs a real run** before merge. Six
  un-executed cases between B + C, all touching SQL paths that are
  trivial-but-untested. `pnpm test:env:up && pnpm --filter
  @skerry/control-plane test` is the bar.
- **No E2E for the new pickers or the management page.** A
  reasonable shape for a follow-up: open the settings page after
  creating an invite, assert the row, click revoke, confirm,
  assert the row disappears.
- **Pangolin manual verification still owed for Slice A** (the
  logged-out → OIDC → autojoin chain). Slice C is server-CRUD that
  the integration suite covers; pangolin doesn't add anything for
  C.
- **Permissions sprint** is its own future ticket.

## Verification

- Verified on **localhost** (the development machine — see
  CONTEXT.md). All in-process unit + typecheck checks pass.
  Control-plane integration tests **not** run this session
  (docker test stack wasn't up); flagged above.
- **Not yet verified on `pangolin`.**
