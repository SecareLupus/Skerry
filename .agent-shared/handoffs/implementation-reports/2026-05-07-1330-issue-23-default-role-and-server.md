# Issue #23 Slice B — Default Role + Default Server on Hub Invites

This is **Slice B of three** for issue #23. Slice A landed earlier
on the same branch (`fix/issue-23-unauth-invite-redeem`, PR #92) and
fixed the unauthenticated redeem flow plus the modal title. Slice C
("broader permissions/invites cleanup") is intentionally vague and
not implemented in this PR — see "Open issues / follow-ups".

## What changed

### Schema

- `apps/control-plane/migrations/1775300000000_030-invite-default-role-and-server.js`
  Adds two nullable columns to `hub_invites`:
  - `default_role text`
  - `default_server_id text references servers on delete set null`

  `set null` rather than cascade because dropping a server shouldn't
  invalidate an otherwise-good invite — it just falls back to the
  default behavior (no specific server placement).

### Shared contracts

- `packages/shared/src/domain/contracts.ts`
  - `HubInvite` gains `defaultRole: Role | null` and
    `defaultServerId: string | null`.
  - New export: `INVITE_BAKEABLE_ROLES = ["user", "space_moderator",
    "space_admin"] as const satisfies ReadonlyArray<Role>` plus the
    matching `InviteBakeableRole` type. Hub-level admin/owner roles
    and `space_owner` are deliberately **not** bakeable — those should
    only be granted by an explicit admin action, not via a shareable
    URL.

### Control plane

- `apps/control-plane/src/services/chat/server-service.ts`
  - `INVITE_RETURNING_COLUMNS` constant introduced so create + lookup
    return the same shape.
  - `createHubInvite` accepts optional `defaultRole` and
    `defaultServerId` and persists them.
  - `useHubInvite`:
    - Reads the invite's `defaultRole` (falling back to `"user"`).
    - The role binding's `server_id` is set when the role is
      space-scoped (`space_*`), null otherwise. This matches the
      existing pattern where hub-wide roles bind on `(hub_id, role)`
      and space-scoped roles bind on `(hub_id, server_id, role)`.
    - When `defaultServerId` is set, after the existing `joinHub`
      call (which honors `auto_join_hub_members`) we also explicitly
      `insert into server_members ... on conflict (server_id,
      product_user_id) do nothing` so the user lands in the named
      server even if it isn't auto-join.
    - The `on conflict do nothing` for `role_bindings` is unchanged
      and still leans on the old PK; flagged as a pre-existing issue
      below.

- `apps/control-plane/src/routes/invite-routes.ts`
  - Body schema accepts optional `defaultRole` (constrained to
    `INVITE_BAKEABLE_ROLES`) and `defaultServerId`.
  - **Validations:**
    1. If `defaultServerId` is set, look up the server. 400 if
       missing; 400 if it belongs to a different hub
       (`code: invite_invalid_default_server`).
    2. If `defaultRole` is `space_*`, `defaultServerId` is required
       (`code: invite_role_requires_server`).
    3. If `defaultRole` is space-scoped, the caller must be either a
       hub manager (already required to create *any* invite) **or** a
       manager of the named server. The current endpoint already
       gates the whole route on `canManageHub`, so the
       additional `canManageServer` check is effectively dead today —
       it's there for the future case where a non-hub-manager space
       admin wants to bake a space role into an invite. Flagged as a
       follow-up.

### Web

- `apps/web/lib/control-plane.ts` — `createHubInvite` client now
  accepts `defaultRole` and `defaultServerId`.

- `apps/web/components/modals/InviteModals.tsx`
  - New `hubServers: Server[]` prop. The modal filters this list to
    the active hub's servers and shows them in a dropdown.
  - New "Default role" picker (Standard user / Space moderator /
    Space admin). Roles outside `INVITE_BAKEABLE_ROLES` are not
    selectable.
  - New "Place new members in" server picker. When the role is
    space-scoped, the picker is required and an inline error appears
    until a server is chosen.
  - The "Generate Invite Link" button blocks the call when a
    space-scoped role is selected without a server. On backend
    rejection the toast surfaces the server-side message.
  - Pickers reset on modal close.

- `apps/web/components/modals/ClientModals.tsx` — passes the existing
  `props.servers` array as `hubServers`.

### Tests

- `apps/control-plane/src/test/hub-invites.test.ts` — two new cases:
  - **`defaultRole + defaultServerId applies role binding and server
    membership`:** creates an invite with `defaultRole=space_moderator`
    and `defaultServerId=<bootstrapped server>`, redeems with a fresh
    user, asserts there's exactly one role binding for that user with
    `role=space_moderator` and `server_id=<server>`, and that the user
    appears in `server_members`.
  - **`rejects space_moderator without defaultServerId`:** asserts a
    400 with `code: invite_role_requires_server`.

## Why

Per the issue body:

> Invite Link Buttons should generate a link for inviting a person to
> a hub, with specific inclusion as a member in one of the servers.
> If a space admin generates a link, they should be able to generate
> the invite to include a role by default. Currently they offer to,
> and then fail.

Slice A fixed "currently they offer to, and then fail" in the
redemption flow. Slice B implements the actual feature: optional
default role + optional default server placement. Together they cover
the issue body in full.

## Tests run

- `pnpm --filter @skerry/shared build` — clean.
- `pnpm --filter @skerry/shared test` — 16/16.
- `pnpm --filter @skerry/web test` — 12/12 (including the
  `providerLoginUrl` returnTo case from Slice A).
- `pnpm --filter @skerry/control-plane exec tsc --noEmit` — clean for
  changed files. Pre-existing unrelated error in `link-service.ts`
  remains.
- `pnpm --filter @skerry/web exec tsc --noEmit` — clean for changed
  files. Pre-existing unrelated errors remain in `link-service.ts`,
  `embed-card.tsx`, `e2e/helpers/a11y.ts`, and stale
  `.next/types/...` artifacts — none touched here.
- **NOT run:** the control-plane integration suite (no docker stack
  this session). The two new `hub-invites.test.ts` cases were written
  but not executed. Flagged below.
- **NOT run:** the E2E suite. The existing `invites.spec.ts` heading
  matcher was updated for Slice A; no new E2E was added for Slice B's
  pickers. Flagged below.

## Open issues / follow-ups

- **No control-plane test execution this session.** The two new
  `hub-invites.test.ts` cases exercise real redemption paths and SQL;
  they should be run via `pnpm test:env:up && pnpm --filter
  @skerry/control-plane test` before merge. I'm reasonably confident
  the SQL is right but flagging because I haven't observed it pass.

- **No E2E for the new pickers.** Natural shape: open the invite
  modal, pick `space_moderator` + the default server, generate the
  link, open it in a new context, redeem, assert the redeemer lands
  in the named server with the named role visible in the role-binding
  list.

- **Manual `pangolin` verification still owed for Slice A** (the
  logged-out → OIDC → autojoin chain).

- **Pre-existing role_bindings dedup gap (NOT introduced here).**
  `useHubInvite` inserts a fresh `id` on each redemption with `on
  conflict do nothing`. There's no unique constraint involving the
  data columns, so the conflict clause is effectively a no-op and a
  user redeeming the same invite twice will accumulate duplicate
  role_binding rows. This was already true before Slice B; flagging
  because the new defaultServerId case makes it slightly more
  noticeable. Right fix is a partial unique index on
  `(product_user_id, role, hub_id, coalesce(server_id, ''))` or
  similar. Out of scope for #23 — worth a separate ticket.

- **Slice C ("broader permissions/invites cleanup") is NOT
  implemented.** The issue body itself is fully satisfied by Slices A
  + B. Slice C originated from the owner's most recent comment
  ("we still need to give focus to our permissions & invites
  systems"), which isn't actionable as written. Concrete candidates
  surfaced during this work that could become Slice C if pursued:
  - A hub-invite list + revoke endpoint (currently no way for a hub
    manager to see or revoke their issued invites).
  - The role_bindings dedup gap above.
  - Tightening the `canManageServer`-without-`canManageHub` path on
    invite creation, which is currently unreachable because the route
    requires `canManageHub` up front.
  - Server-level join_policy interaction with `defaultServerId` — the
    invite intentionally bypasses approval today (the hub admin's
    consent stands in for the server's), but this should be
    documented somewhere.

  My recommendation: merge PR #92 as the answer to #23 once Slice A's
  pangolin verification is done, and file the above as a separate
  "permissions/invites hardening" ticket rather than expanding this
  PR further.

## Verification

- Verified on **localhost** (the development machine — see
  CONTEXT.md). Web + shared unit suites pass; typecheck clean for
  changed files. Control-plane integration tests **not** run this
  session because the docker test stack wasn't up.
- **Not yet verified on `pangolin`.**
