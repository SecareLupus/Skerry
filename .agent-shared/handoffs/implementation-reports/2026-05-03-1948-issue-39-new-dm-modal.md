---
date: 2026-05-03 19:48
agent: claude-code
issue: 39
branch: fix/issue-39-new-dm-modal
sprint: Sprint 1 (MVP)
verification_machine: localhost (development)
---

# Issue #39 — New DM Modal Dialog Issues

Reported symptoms (from pangolin test server):
1. Search results in the New DM modal do not render user names.
2. Clicking any entry produces an error.

## Root Causes

Two independent bugs, both reproduced locally:

### 1. Display name fallback missing
`apps/web/components/dm-picker-modal.tsx` rendered `user.displayName ?? "Unknown User"`, but the dev/OIDC login paths and onboarding only populate `preferred_username` — `display_name` stays NULL for freshly-onboarded users. So every search hit displayed as "Unknown User".

### 2. Missing `Content-Type` header on DM creation
`createDirectMessage` in `apps/web/lib/control-plane.ts` POSTed `JSON.stringify({ userIds })` without `Content-Type: application/json`. Fastify therefore couldn't parse the body, leaving `request.body` undefined, and the route's zod schema `{ userIds: z.array(z.string().min(1)).min(1).max(10) }` rejected the request with a 400. The web client surfaced that as a "Failed to start conversation." error and the modal stayed open — exactly the "clicking produces an error" symptom.

A bonus fix: `searchIdentities` now self-excludes the requester. Pre-fix, the admin appeared in their own results; clicking themselves would route through `getOrCreateDMChannel` with a 1-member self-DM, an untested edge case. Self-exclusion eliminates the path entirely. (Catching the click error from #2 above also prevented the self-DM follow-on; both fixes are now in place.)

## Files Changed

- `apps/web/components/dm-picker-modal.tsx` — fallback chain `displayName ?? preferredUsername ?? matrixLocalpart ?? "Unknown User"`, applied to both the rendered name and the avatar initial.
- `apps/web/lib/control-plane.ts` — added `Content-Type: application/json` to `createDirectMessage`.
- `apps/control-plane/src/services/identity-service.ts` — `searchIdentities` accepts `{ excludingProductUserId }` and filters via SQL.
- `apps/control-plane/src/routes/user-routes.ts` — passes `request.auth!.productUserId` into `searchIdentities`.
- `apps/control-plane/src/test/identity-service.test.ts` — extended lifecycle test with self-exclusion assertion.
- `apps/web/e2e/ui-regressions.spec.ts` — added `#39` Playwright regression: spawns alice in a second context, opens New DM modal as admin, asserts alice's preferred-username renders (no "Unknown User"), asserts admin doesn't appear in own results, clicks alice and asserts the modal closes with no DM-creation console errors.

## Tests

- New: 1 Playwright E2E (#39 in `ui-regressions.spec.ts`) and 1 assertion block extension in `identity-service.test.ts` (case 9: self-exclusion).
- Failing-then-passing: pre-fix the new E2E hit "Request validation failed (400)" on the DM POST; post-fix all 4 ui-regressions tests pass.
- Suite results on localhost:
  - `pnpm --filter @skerry/control-plane test` — 121/121 pass.
  - `pnpm --filter @skerry/web test` — 9/9 pass.
  - `pnpm --filter @skerry/shared test` — 16/16 pass.
  - `pnpm --filter @skerry/web exec playwright test e2e/ui-regressions.spec.ts` — 4/4 pass.
  - `pnpm typecheck` — clean.
  - `pnpm lint` — only pre-existing unrelated warnings.

## Open Issues / Follow-ups

None blocking. Note: the `Content-Type` omission is a one-off; spot-checked the rest of `control-plane.ts` and the other JSON POSTs in that file already set the header. If a similar bug surfaces elsewhere later, a centralized helper would prevent the class — out of scope here.

## Verification

All test runs above were on localhost (development machine). Pangolin not directly verified; the failing-then-passing E2E run on the locally-rebuilt test stack is the regression evidence.
