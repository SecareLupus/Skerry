# Issue #23 Slice A — Unauthenticated Invite Redeem + Modal Title

This is the **first of three planned slices** for issue #23. Slice B
(role/server baking on invites — schema + UI) and Slice C (broader
permissions/invites cleanup) remain deferred per
`current-plan.md`.

## What changed

### Control plane

- `apps/control-plane/src/auth/oidc.ts`
  - `OidcStateEntry` and `OidcExchangeResult` both gain an optional
    `returnTo: string`.
  - `createAuthorizationRedirect` accepts `returnTo` and persists it in
    the in-memory state map alongside the PKCE verifier.
  - All three exchange branches (Discord/Google/Twitch) propagate
    `returnTo` from the state entry into the exchange result.

- `apps/control-plane/src/routes/auth-routes.ts`
  - New `sanitizeWebReturnTo(candidate)` helper: parses the candidate
    URL, requires same-origin with `config.webBaseUrl`, returns the
    canonicalized string or `undefined`. This is the open-redirect
    guard.
  - `GET /auth/login/:provider` now accepts `?returnTo=<url>`,
    validates it through `sanitizeWebReturnTo`, and threads it through
    `createAuthorizationRedirect`.
  - The OIDC callback uses the validated `returnTo` as the post-login
    destination when `intent === "login"`. The link-flow destination
    (`?linked=<provider>`) is untouched. The `?suggestedUsername=...`
    hint is suppressed when a `returnTo` is in play (the user is
    on a deep link, not the homepage onboarding flow).

### Web

- `apps/web/lib/control-plane.ts`
  - `providerLoginUrl(provider, options?)` is now options-shaped:
    `{ username?, returnTo? }`. Old positional `username` callers
    were updated. For the dev provider the option key is `redirectTo`
    (matching the existing `/auth/dev-login` query); for OIDC it's
    `returnTo` (matching the new control-plane route).

- `apps/web/components/auth-overlay.tsx` — single call site updated to
  the options shape.

- `apps/web/components/modals/InviteModals.tsx` — modal title fixed:
  `"Invite to {activeServer?.name}"` → `"Create Hub Invite Link"`.
  The previous title implied server-scope (it is hub-scope), and
  could be empty when `activeServer` was undefined.

- `apps/web/app/invite/[inviteId]/page.tsx`
  - Imports `ControlPlaneApiError`, `fetchAuthProviders`,
    `providerLoginUrl`, plus `useSearchParams` from `next/navigation`.
  - On a join attempt, if the response is `ControlPlaneApiError` with
    `statusCode === 401`, the page resolves the primary auth provider
    and redirects to its login URL with
    `returnTo = "<origin>/invite/<id>?autojoin=1"`.
  - On mount, when `?autojoin=1` is present and the invite has loaded
    cleanly, `handleJoin` is auto-triggered exactly once (guarded by
    a ref) so the user lands back on the page after OIDC and the join
    proceeds without a second click.

### Tests

- `apps/web/test/control-plane.test.ts`
  - Updated the dev-login test to the options-shape signature.
  - Added a new test asserting `providerLoginUrl("discord", { returnTo })`
    appends a URL-encoded `returnTo` query.
- `apps/web/e2e/invites.spec.ts`
  - Heading matcher updated from `/^Invite to /i` to
    `/Create Hub Invite Link/i`.

## Why

Per the issue's history: invites generate links and grant access for
already-logged-in users, but the redeem page has no graceful path for
a logged-out visitor — `/v1/invites/:inviteId/join` requires auth, so
clicking "Accept Invite" returned a 401 with a generic toast and no
way forward. The modal title was also misleading (claimed server scope
on a hub-scope action). Both are user-visible regressions worth fixing
before any of the larger feature work in Slices B/C.

## Tests

- **Web unit:** `pnpm --filter @skerry/web test` — 12/12 pass
  (including the new `providerLoginUrl` returnTo test).
- **Typecheck:** `pnpm --filter @skerry/control-plane exec tsc --noEmit`
  and `pnpm --filter @skerry/web exec tsc --noEmit` — clean for the
  files touched. Pre-existing unrelated errors persist in
  `link-service.ts`, `embed-card.tsx`, `e2e/helpers/a11y.ts`, and stale
  `.next/types/...` artifacts — none touched here.
- **E2E:** **NOT run.** The docker test stack was not brought up this
  session. The existing invite spec was updated for the new heading
  but not exercised; the new logged-out path has no E2E coverage yet
  (would require either a logged-out browsing context or a stubbed
  OIDC provider). Flagging this for follow-up.
- **Manual:** **NOT performed** against pangolin. The unauthenticated
  redirect-to-login chain genuinely needs to be exercised against
  a real OIDC provider before this is shippable.

## Open issues / follow-ups

- **E2E for the new path.** A natural shape: open `/invite/<id>` in
  a fresh context (no cookies), click Accept, assert the navigation
  goes to a `/auth/login/...` URL whose `returnTo` query points back
  at the invite page with `autojoin=1`. The auth roundtrip itself
  is hard to fake; the existing dev-login bypass could be wired
  through to make the full loop testable, but that's a separate
  diff.
- **Slice B (role/server baking).** Still pending. Schema + invite
  creation UI + redeem application path. The
  `apps/control-plane/src/services/chat/server-service.ts`
  `createHubInvite` / `useHubInvite` pair is the right entry point.
- **Slice C (permissions/invites cleanup).** Vague; needs scoping
  conversation before another agent picks it up.
- **Open-redirect surface:** `sanitizeWebReturnTo` only allows
  same-origin URLs against `config.webBaseUrl`. If the deployment
  ever runs the web app on a different origin from `webBaseUrl`,
  this guard becomes too tight and the redirect will silently fall
  back to the homepage. Worth noting in deployment docs if/when
  that comes up.

## Verification

- Verified on **localhost** (the development machine — see
  CONTEXT.md): web unit suite green, typecheck clean for changed
  files. The control-plane unit suite was **not** run (no docker
  stack up this session); changes are constrained to OIDC state
  threading and a same-origin URL parser, with no DB or Matrix
  side effects.
- **Not yet verified on pangolin.** PR should be deployed there for
  manual exercise of the logged-out → OIDC → autojoin chain before
  merge.
