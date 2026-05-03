# Issue #21 — Settings Menu Does Not Maintain Theme

## What changed

- `apps/web/e2e/ui-regressions.spec.ts` — added a new Playwright regression
  test, `#21: theme persists when refreshing the settings page`, and a
  matching entry in the file's docblock.
- No production source changes. The underlying defect was already addressed
  by the FOUC guard introduced in `fe54478` (Phase 27 Item 1) in
  `apps/web/hooks/use-theme.ts`. Verified by removing the guard, rebuilding
  the test stack, and watching the new test fail with
  `data-theme transitions: ["dark","light","dark"]` — then re-adding the
  guard and watching it pass.

## Why

Issue #21 reported that refreshing inside `/settings` reverted the page to
light mode regardless of the user's preference. The owner flagged
`fe54478` as a likely fix candidate but asked for confirmation via the
original repro path before closing.

## Root-cause recap

`useTheme` runs through the root layout's `<AppInitializer>`, which mounts
on every route including `/settings`. Without the FOUC guard, Effect 2 fires
on first render with the reducer's default `theme="light"` — overwriting the
DOM's correctly-applied `data-theme="dark"` (set by `<ThemeScript>`) and
clobbering `localStorage` to `"light"` in the same tick. The viewer's
identity-level preference eventually rehydrates the dark state, but the user
sees a flash and, in cases where the DB has no theme persisted, the choice
is lost permanently.

The `if (!hasAppliedRef.current) { ...skip if DOM already non-light... }`
block in `apps/web/hooks/use-theme.ts:41-46` blocks that initial
overwrite and lets Effect 1 dispatch the correct state before Effect 2
applies it.

## Tests

- **Added:** Playwright E2E test seeds `localStorage.theme = 'dark'` via
  `addInitScript` (mirrors a real browser carrying the preference across a
  reload), navigates to `/settings`, attaches a `MutationObserver` to track
  every `data-theme` transition, then reloads. Asserts:
  - `data-theme === 'dark'` after navigation and after reload
  - `__themeFlashes` records exactly `['dark']` (no transient `'light'`)
  - `localStorage.theme === 'dark'` after reload
- **Verification of test sensitivity:** temporarily removed the FOUC guard
  in `use-theme.ts`, rebuilt the `web` container, ran the test — it failed
  with the captured flash sequence `["dark","light","dark"]`. Restored the
  guard, rebuilt, ran again — passed.

### Suite results

- `pnpm --filter @skerry/web test:e2e -- ui-regressions.spec.ts` — 4/4 pass
  (Bug 1, #21, Bug 5, #22).
- `pnpm --filter @skerry/web test` — 9/9 pass.
- `pnpm typecheck` — clean across `@skerry/shared`, `@skerry/control-plane`,
  `@skerry/web`.
- `pnpm lint` — only pre-existing `<img>` and `react-hooks/exhaustive-deps`
  warnings. No new diagnostics from this change.

## Open issues / follow-ups

- The bug doesn't reproduce on the current `main` build for users whose
  identity-level theme is persisted, because the eventual `viewer` fetch
  rehydrates the correct state. The new test specifically pins the
  no-DB-preference flash path (the original failure mode) so we don't
  silently regress when the FOUC guard is touched again.
- Pre-existing lint warnings (`@next/next/no-img-element`,
  `react-hooks/exhaustive-deps`) are unrelated and out of scope for #21.

## Verification

- Verified on **localhost** (the development machine — see CONTEXT.md). The
  Skerry test stack was rebuilt twice (broken-fix, restored-fix) via
  `docker compose -f docker-compose-test.yml up -d --build web` against
  `http://localhost:8080`.
- Did **not** reproduce on `pangolin` directly. The failing-then-passing
  cycle on the local stack is sufficient evidence that the test catches
  the regression and the fix prevents it.
