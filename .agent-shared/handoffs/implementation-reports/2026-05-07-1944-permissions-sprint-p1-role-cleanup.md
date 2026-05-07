# Permissions Sprint P1 — Role Enum Cleanup

First slice of the permissions sprint. Drops `user` and `visitor` from
the `Role` enum and reframes those tiers as derivations from membership
state (or its absence) rather than as granted roles. P3 (default Space
Owner = Hub) and P2 (audience tiers + cascade + capability split) are
the remaining slices.

## What changed

### Schema

- **Migration 034 (`1775500000000_034-drop-role-user-and-visitor.js`)**
  - Backfills `hub_members` rows for any *non-bridged* identity that
    currently has a `role='user'` binding scoped to a hub. The bridged-
    identity guard is `(im.matrix_user_id is null OR
    im.matrix_user_id NOT LIKE '@discord_%')` — the user explicitly
    required that bridged Discord user lists not be polluted.
  - Deletes every `role='user'` binding (now redundant for real users,
    inert for any hypothetical bridged data).
  - Deletes every `role='visitor'` binding (`permissionMatrix.visitor`
    was always the empty array, so these granted nothing).
  - The `down` migration is intentionally a no-op — the deletes can't
    be reversed under the new type union.

### Shared contracts

- `Role` reduced to `hub_owner | hub_admin | space_owner | space_admin
  | space_moderator`. New JSDoc on the type explains why `user` /
  `visitor` are no longer valid values.
- `MasqueradeParamsSchema.role` z.enum aligned.
- `INVITE_BAKEABLE_ROLES` reduced from `["user", "space_moderator",
  "space_admin"]` to `["space_moderator", "space_admin"]`. The
  previous `"user"` option was redundant once `user` left the Role
  enum; an invite with no `defaultRole` simply grants hub membership.

### Control plane

- `policy-service.ts`
  - `permissionMatrix` no longer has `user`/`visitor` keys. New JSDoc
    on the matrix documents the `space_moderator` boundary
    (chat-cleanup-only, NOT settings/roles/rooms — P2 will replace the
    `SERVER_MANAGER_ROLES` binary set with capability-specific gates).
  - `getEffectiveRoleBindings` masquerade-out-of-scope fallback now
    returns `[]` instead of a synthetic `role: "visitor"` binding.
    The downstream access-tier resolution maps "no bindings" to
    `relation = 'visitor'` already, so behavior is unchanged.
  - `authorizeRoleGrant.actorCanAssign` no longer adds `"user"` to the
    set — non-grantable.

- `chat/server-service.ts` — `useHubInvite`:
  - When `invite.defaultRole` is null, **no role binding is written**
    and **no audit log is emitted**. Plain hub membership (the
    `joinHub` call) is sufficient for "Member" tier; that's the new
    semantics for the no-defaultRole case.
  - When `defaultRole` is set, the binding + audit logic is unchanged
    from Slice C.

- Z-enum tightening in three routes (no behavioral change, just
  rejecting `user`/`visitor` at the boundary):
  - `auth-routes.ts` — `/auth/masquerade-token` payload role enum.
  - `channel-routes.ts` — `postingRestrictedToRoles` array enum (the
    field is currently stored but not enforced anywhere; P2 territory).
  - `moderation-routes.ts` — `/v1/roles/grant` body role enum.

- `voice.token.issue` gate — **no rewiring needed**. It was already
  in `ACCESS_ACTIONS`, which means `isActionAllowed` skips the role
  matrix and resolves via the access-tier system (admin/space_member/
  hub_member/visitor). The `permissionMatrix.user = ["voice.token.issue"]`
  line was dead code.

### Web

- `masquerade-drawer.tsx` — removes "Regular User" and "Visitor" cards
  from the SERVER_ROLES list. Comment explains: to preview those
  tiers, the operator joins as a regular member or browses signed
  out, respectively.
- `masquerade-modal.tsx` — same removal in the `<select>`.
- `InviteModals.tsx` — `ROLE_PICKER_LABELS` no longer has `user`. The
  default option in the role picker is now "No additional role
  (member only)".
- `role-modal.tsx` — the grant-role picker no longer offers `user` for
  either scope.

### Tests

- Two tests in `hub-invites.test.ts` updated for the new no-defaultRole
  semantics:
  - The list/revoke test now asserts the redeemer's `hub_members` row
    survived the revoke (instead of the now-absent role binding).
  - The double-redemption idempotency test was rewritten to use a
    `defaultRole: "space_moderator"` invite, exercising both the
    `hub_members` and `role_bindings` idempotent paths in the same
    flow plus the `role_assignment_audit_logs` single-write guarantee.
- `role-grants.test.ts` — removed the redundant
  `POST /v1/roles/grant` call with `role: "user"` (would now 400).
  The direct `hub_members` / `server_members` inserts that
  immediately followed already do the right setup.
- `packages/shared/src/test/contracts.test.ts` — exhaustive Role
  switch + MasqueradeParamsSchema minimal-payload test updated.

## Tests run

- `pnpm --filter @skerry/shared build` — clean.
- `pnpm --filter @skerry/shared test` — 16/16.
- `pnpm --filter @skerry/web test` — 12/12.
- `pnpm --filter @skerry/control-plane exec tsc --noEmit` — clean for
  changed files (pre-existing `link-service.ts` error remains).
- `pnpm --filter @skerry/web exec tsc --noEmit` — clean for changed
  files (pre-existing errors in `link-service.ts`, `embed-card.tsx`,
  `e2e/helpers/a11y.ts`, stale `.next/types/...` remain).
- **`pnpm --filter @skerry/control-plane test` — 129/129**, run on
  the live test stack (no skips or failures).

## Verification

Verified on **localhost** (the development machine — see CONTEXT.md).
Test stack was up; full integration suite executed against it. Not
yet verified on `pangolin` — the migration's bridged-user guard is
the only thing pangolin can exercise that localhost can't (production
data shape). Recommend running migration 034 on pangolin and
inspecting the `hub_members` and `role_bindings` row counts before
and after.

## Open issues / follow-ups

- **P3 next** (Default Space Owner = Hub). Then P2 (audience tiers +
  cascade + capability split — the largest slice).
- The `space_moderator` boundary is currently enforced by
  `space_moderator` being absent from `SERVER_MANAGER_ROLES`. P2
  splits `canManageServer` into `canModerateServer`,
  `canEditServerSettings`, `canManageServerRoles`, `canManageRooms`
  so the boundary is enforced by name, not by absence-from-set.
- `postingRestrictedToRoles` on channels is a stored-but-unenforced
  field. The P1 z-enum tightening prevents new rows from including
  `"user"`, but existing rows storing `["user"]` are still inert.
  P2 will either wire enforcement or remove the field.
- Migration 034's `down` is a no-op. If a rollback is ever needed,
  it's manual (and wouldn't make sense without simultaneously
  reverting the type changes).
