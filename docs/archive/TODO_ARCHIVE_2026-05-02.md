# TODO Archive — 2026-05-02

Snapshot of completed work migrated out of `TODO.md` on 2026-05-02. Items here are historical record; the live tracker is the GitHub issues at https://github.com/SecareLupus/Skerry/issues and any remaining open items in `TODO.md`.

**Predecessors:** [`TODO_ARCHIVE_2026-02-13.md`](TODO_ARCHIVE_2026-02-13.md), [`TODO_ARCHIVE_2026-03-08.md`](TODO_ARCHIVE_2026-03-08.md).

---

## Phase 14 — Alpha Polish: UI Wiring (Backend-Complete Features)

**Goal:** Connect fully-implemented backends to missing frontend surfaces.
**Status:** Complete

- [x] Wire `profile-modal.tsx` to username clicks in `chat-window.tsx` (remove remaining `// TODO: Implement profile modal` at line 374)
- [x] Build DM frontend: sidebar inbox listing DM conversations, DM channel navigation, "New DM" user picker
- [x] Build emoji reaction picker UI and display reaction counts on message bubbles
- [x] Surface member list panel (`member-table.tsx`) as a toggleable right rail in the chat shell
- [x] Display online/offline presence dots using `listUserPresence` data in the member list and DM list

---

## Phase 15 — Alpha Polish: Missing Core UX

**Goal:** Ship the small-but-expected features that make the product feel complete.
**Status:** Complete

- [x] **Markdown rendering** — integrate `react-markdown` (or equivalent) for message content; support bold, italic, code, code blocks, and links at minimum
- [x] **Typing indicators** — backend: SSE event `typing.start`/`typing.stop` from composer keystrokes; frontend: "user is typing…" display below message list
- [x] **Browser desktop notifications** — use `Notification` API for @mentions and new DMs when tab is not focused; request permission on first login
- [x] **Pin messages** — backend endpoint + DB column; UI pin action in message context menu and pinned-messages header button
- [x] **Invite / join links** — generate shareable hub/space join URLs; backend redemption endpoint; invite landing page

---

## Phase 16 — Alpha Polish: Housekeeping

**Goal:** Remove dead code and reduce technical debt before publishing.
**Status:** Complete

- [x] Delete empty `apps/web/app/admin/` directory
- [x] Decompose `chat-client.tsx` (2,216 lines) — extract: voice panel state, notification state, DM state, and moderation panel into dedicated components or hooks
- [x] Add React error boundaries to the web app root and per major panel to prevent full-page crashes
- [x] Fix timeout moderation — implement true timed restriction (Synapse power-level schedule or scheduled job) instead of the current kick-as-timeout workaround
- [x] Lint/audit all remaining `any` type casts in `chat-service.ts` (bridgedMembers, etc.)

---

## Phase 17 — Public Beta: Message Discovery

**Goal:** Let users find content they're looking for.
**Status:** Complete

- [x] **Full-text message search** — `pg_trgm` or `tsvector` on message content; API endpoint `GET /v1/channels/:channelId/messages/search?q=`; search modal in UI with scoped results
- [x] **Message jump / deep link** — link directly to a specific message by ID and scroll to it on load
- [x] **Jump to unread** — "jump to first unread" button when entering a channel with unread messages

---

## Phase 18 — Public Beta: Notification System (completed items)

Email notifications for offline @mentions remain open in `TODO.md` (#59).

- [x] Upgrade SSE transport from channel-scoped to hub-scoped global event bus — enables cross-channel presence, typing, and DM notifications without re-subscribing
- [x] Notification preferences per channel (all messages / mentions only / muted)
- [x] Notification badge in browser tab title update on new mentions

---

## Phase 19 — Public Beta: Rich Media & Embeds

**Goal:** Make shared content interactive and visually rich.
**Status:** Complete

- [x] **URL preview / link embeds** — backend scraper (title, description, thumbnail via Open Graph); display card below message containing links
- [x] **Image lightbox** — click to expand inline images full-screen
- [x] **Video previews** — support MP4/WebM inline previews and play icons for YouTube
- [x] **GIF support** — ensure animated GIFs are correctly prioritized over static thumbnails

---

## Phase 20 — Moderation Hardening (completed items)

Report Triage UI remains open in `TODO.md` (#60).

- [x] Implement timed timeout via Synapse power-level scheduling or a `moderation_time_restrictions` DB table + scheduled runner
- [x] Warn action (DM warning message to user before punitive action)
- [x] Strike system — configurable warn → mute → kick → ban escalation
- [x] Moderation action UI improvements — confirmation dialogs, undo window for redact
- [x] Rate-limit reporting endpoint to prevent report spam

---

## Phase 21 — Infrastructure & Operations

**Goal:** Harden the platform for production traffic and operations.
**Status:** Complete

- [x] **Email service** — integrate SMTP (e.g., Resend, Postmark, or SES) for: account recovery, invite emails, offline mention notifications
- [x] **Observability** — expand `observability-service.ts`; add structured request logging (JSON), Prometheus metrics endpoint, Sentry (deferred)
- [x] **Rate limit audit** — verify `rateLimitPerMinute: 240` is enforced on all routes; add per-user rate limits on message send
- [x] **PostgreSQL backups** — automate point-in-time recovery (daily pg_dump to S3 or equivalent)
- [x] **Health checks** — deepen `/health` to include DB ping, Synapse reachability, and Redis/SSE broker alive
- [x] **Reverse proxy config** — finalize Nginx/Caddy production config with SSL, HSTS, WebSocket upgrade
- [x] **CI/CD pipeline** — verify `.github/workflows/ci.yml` runs: lint, typecheck, build, and all tests on every PR; add deployment step

---

## Phase 22 — Test Coverage Expansion (completed items)

SSE load test remains open in `TODO.md` (#61, deferred).

- [x] Integration tests for authenticated message send, edit, delete, and reaction flows (`message-crud.test.ts`)
- [x] Integration tests for DM creation and messaging (`dm-messaging.test.ts`)
- [x] Integration tests for voice token issuance (covered in `integration-auth-chat-permissions.test.ts`)
- [x] Moderation action tests (kick/ban permission gates, warn, strike, report flow — Discord bridge mocked) (`moderation-actions.test.ts`)
- [x] E2E tests: message send → receive via SSE, edit, delete, profile modal open (`message-flow.spec.ts`, `profile-modal.spec.ts`)
- [x] Presence service tests: online threshold logic, stale user handling, multi-user mixed state (`presence-service.test.ts`)

---

## Phase 23 — Extensions & Ecosystem (completed items)

Mobile app (separate repo) remains open in `TODO.md` (#62).

- [x] **Custom emoji / stickers** — per-server emoji upload and picker
- [x] **Webhooks** — inbound webhooks to post to channels (for CI/CD alerts, etc.)
- [x] **Bot framework** — first-party bot scaffolding using the existing chat API (House Bot)
- [x] **Federation enhancements** — Web-of-Trust trust model, guest identity resolution
- [x] **Multi-hub orchestration** — Docker Compose standard, bootstrap-hub.sh script
- [x] **Stream Contextual Threads** — Scaffolding for Live Status in House Bot
- [x] **Twitch Integration** — Scaffolding for Live Status in House Bot
- [x] **Announcement Channel Rework** — Followable space-level feed, global aggregation

---

## Current Sprint Focus (historical)

Snapshot of the live "Current Sprint Focus" section as of archive time.

> Current focus is **Phase 20** (Moderation Hardening) and **Phase 23** (Extensions & Ecosystem).
>
> - [x] Phase 19: Rich Media & Embeds (URL previews, image lightbox, video previews, GIF support)
> - [x] Phase 22: Test Coverage Expansion

---

## Phase 24 — Creator Suite & Branding (completed items)

SEO/Social Metadata, PWA Support, and Custom Domains remain open in `TODO.md` (#63, #64, #65).

- [x] **Hierarchical CSS Theming** — Hub > Space > Page variable injection
- [x] **Professional Code Editor** — Integrated PrismJS with live side-by-side preview
- [x] **Variable Interpolation** — Dynamic tokens like `{{serverName}}`, `{{viewerName}}`
- [x] **Template Library** — Preset landing page layouts (Hero, Profile, Splash)
- [x] **Asset Integration** — Direct "Upload & Insert" help for images in the editor

---

## Phase 25 — Triage Backlog (completed items)

Re-triaged on 2026-05-02; #21, #23, #26, and #9 reopened. Those four remain in `TODO.md`.

### 🚨 Tier 1: Critical Blockers

- [x] **Fix Page Navigation Flashing (#29)** — Eliminate the back-and-forth flashing behavior when switching between rooms or servers.
- [x] **VC Reliability (#13)** — Fix dropping connections (LiveKit/WebRTC debugging required).
- [x] **Discord Bridging Refactor (#24)** — Implement dynamic message ID mapping for deletions and editing.
- [x] **Masquerade Persistence (#25)** — Fix complex issues with masquerade system.
- [x] **Real-time Message Sync Regression (#30)** — Fix issue where messages/edits/deletions don't appear until page refresh (SSE/EventBus).

### 🔧 Tier 2: Core UX Bugs

- [x] **Threaded Conversations (#27)** — Fix missing moderation/context menus for threaded replies.

### 🏗️ Tier 3: Medium Features & Polish

- [x] **Discord Content Bridging (#18)** — Sticker/emoji bridging shipped.
- [x] **Discord Bridge OAuth Flow (#22)** — OAuth round-trip now preserves the user's place via scroll/state restoration (PR #47, `29785c3`).
- [x] **Twitch Integration UI (#6)** — Fixed alignment and asset issues with Twitch logo on login.
- [x] **Storage Audit (#20)** — Implemented automated `pnpm run cleanup` (builder/image prune) in build cycle.
- [x] **Rebranding Completion (#28)** — Finalize any remaining code references to EscapeHatch.

---

## Phase 26 — Stability & Refinement (completed items)

Deeper Client Isolation (#58), E2E Modal Expansion (#66), and Sing-along Latency (#67) remain open in `TODO.md`.

- [x] **Video Chat Reliability** — Fix camera preview and subscription bugs (Event listener overhaul).

### Video Chat Enhancements

- [x] Implement Track-based rendering in `VoiceRoom` (Camera + Screen)
- [x] Create `VoiceSettingsModal` for device management
- [x] Implement Stage Layout (Focus Mode)
- [x] Add Picture-in-Picture (PiP) support
- [x] **Voice join redirects to home hub from cold context** — root cause: `localStorage.lastServerId` was only updated by `handleServerChange`. Other paths that change `selectedServerId` (most notably the post-create-space auto-switch via `SET_CHAT_INITIAL_DATA`) left `lastServerId` stale. Meanwhile `handleChannelChange` kept `lastChannelId` fresh. When the Initial Chat Load effect re-fired (e.g., on a `bootstrapStatus` reference change), it called `refreshChatState(staleServer, freshChannel)` — channel didn't exist in stale server's list, validation reset to default → user kicked back to home hub. Fix: a single `useEffect` in [chat-client.tsx](../../apps/web/src/components/chat-client.tsx) writes `localStorage.lastServerId` whenever `selectedServerId` changes, keeping it in sync regardless of which code path triggered the change. Voice join test now passes deterministically (8.9s, single attempt). All 23 e2e tests green.

---

## Phase 27 — BugFixesAndPolish Retry (completed items)

Re-applied fixes from the `BugFixesAndPolish` branch one-at-a-time on `Phase-27` and merged via PR #37 (`edfb91e`). Final localhost verification: 146/146 unit + 29/29 E2E green. See [implementation report](../../.agent-shared/handoffs/implementation-reports/2026-05-02-1730-phase-27-items-1-through-6.md).

The Skerry-side mirror item (#68) remains deferred in `TODO.md` until upload UI lands.

- [x] **Theme toggle doesn't persist across toggles** — re-applied in `fe54478`. FOUC guard in [use-theme.ts](../../apps/web/hooks/use-theme.ts) gated to initial mount only; E2E regression added.
- [x] **"New Message" / DM picker crashed with context error** — re-applied in `83db799`. `ModalManager` now wrapped in `ChatHandlersProvider` in [chat-client.tsx](../../apps/web/components/chat-client.tsx); E2E regression added.
- [x] **DM list doesn't refresh after creating a new DM** — re-applied in `d86c360`. `ADD_DM_CHANNEL` reducer action in [chat-context.tsx](../../apps/web/context/chat-context.tsx); dispatched from [dm-picker-modal.tsx](../../apps/web/components/dm-picker-modal.tsx); 4 reducer regression tests in [chat-context-reducer.test.ts](../../apps/web/test/chat-context-reducer.test.ts).
- [x] **Routing to a just-created DM fails** — re-applied in `d86c360` (bundled with previous item). `refreshChatState` in [use-chat-initialization.ts](../../apps/web/hooks/use-chat-initialization.ts) now takes `extraKnownChannels`; DMPickerModal passes the new channel explicitly.
- [x] **Custom Discord emoji reactions render as text instead of images** — re-applied in `dcd629b`. Backend ([discord-bot-client.ts](../../apps/control-plane/src/services/discord-bot-client.ts)) stores reactions in tag form (`<:name:id>`); frontend `ReactionEmoji` in [chat-window.tsx](../../apps/web/components/chat-window.tsx) renders the Discord CDN URL; 5 encoder regression tests added.
- [x] **Custom Discord emoji backfill — only some emojis render** — investigated; no code change needed. Pangolin survey showed unbackfilled rows are mostly Unicode (correct as-is); only one custom name (`zombieTwerk`, 3 rows) is genuinely missing because the bot never seeded it into `discord_seen_emojis`. Optional one-shot manual backfill remains an open question (#70).
- [x] **Styling drift in DM picker / reaction buttons** — re-applied in `f940bfd`. Added `--bg-strong` (light) and `--accent-soft` (both) tokens to [globals.css](../../apps/web/app/globals.css), `.interaction-btn` class, `.modal-overlay`/`.modal-content`/`.modal-header`/`.modal-body` classes for the DM picker, plus scrollbar styling on `.messages`.

---

## Pre-Release List — completed items

- [x] **Expand E2E coverage** — split monolithic spec into onboarding, community, invites, messaging, moderation, accessibility, visual-regression, voice-channel, voice-settings (10 spec files, 27+ tests). Federation E2E deferred to post-launch sprint.

---

## Test Suite Improvements — completed items

### Structural Issues

- [x] **Extract shared `resetDb()` helper** — consolidated into [`test/helpers/reset-db.ts`](../../apps/control-plane/src/test/helpers/reset-db.ts); table list derived dynamically from `information_schema.tables` (excluding `pgmigrations`/`platform_settings`) so it self-heals.
- [x] **Consolidate `createAuthCookie` + `bootstrap()` helpers** — extracted into [`test/helpers/auth.ts`](../../apps/control-plane/src/test/helpers/auth.ts) and [`test/helpers/bootstrap.ts`](../../apps/control-plane/src/test/helpers/bootstrap.ts) (includes `bootstrap()` + `bootstrapWithMember()`). Migrated 7 test files.
- [x] **Replace sequential `delete from` with `TRUNCATE ... CASCADE`** — 5 files (`api-snapshot`, `identity-service`, `hub-service`, `sql-robustness`, `masquerade`, plus narrower variants in `policy` and `presence-service`) had local `delete from`-based resetDb functions; all now use the shared `helpers/reset-db.ts` which truncates dynamically-discovered public tables in one statement.
- [x] **Move `config.discordBridge.mockMode = true` out of module-load** — created [`test/setup.ts`](../../apps/control-plane/src/test/setup.ts) preloaded via `tsx --import ./src/test/setup.ts --test ...`. Removed the per-file `config.discordBridge.mockMode = true;` line from 8 test files. New test files automatically inherit the baseline.
- [x] **Split oversized test files** — `integration-auth-chat-permissions.test.ts` (1,415 LOC, 18 tests) split into [`auth-basics.test.ts`](../../apps/control-plane/src/test/auth-basics.test.ts) (8 tests), [`federation.test.ts`](../../apps/control-plane/src/test/federation.test.ts) (2 tests), [`role-grants.test.ts`](../../apps/control-plane/src/test/role-grants.test.ts) (5 tests), [`space-permissions.test.ts`](../../apps/control-plane/src/test/space-permissions.test.ts) (3 tests). `message-crud.test.ts` (770 LOC, 13 tests) split into slimmed [`message-crud.test.ts`](../../apps/control-plane/src/test/message-crud.test.ts) (6 CRUD/permission tests), [`message-validation.test.ts`](../../apps/control-plane/src/test/message-validation.test.ts) (5 validation/media tests + search), [`hub-invites.test.ts`](../../apps/control-plane/src/test/hub-invites.test.ts) (1 invite test). 116/116 tests still green; biggest file dropped from 1,415 → 583 LOC.

### Performance

- [x] **Collapse pool idle timeout in tests** — [`db/client.ts`](../../apps/control-plane/src/db/client.ts) set `idleTimeoutMillis: 500` when `NODE_ENV=test`. Each test file was holding the process open for ~30s after the last assertion waiting for idle pg connections to drain; control-plane suite dropped from ~11.5 min to ~2 min.

### Flakiness

- [x] **Fix event-stream races** — added [`test/helpers/events.ts`](../../apps/control-plane/src/test/helpers/events.ts) with `captureEvents()` that collects into an array and provides `expect(eventName)` membership-matching. Migrated `realtime-sync.test.ts` (3 tests); `notifications.test.ts` uses HTTP assertions, no subscribe-style capture.
- [x] **Inject a clock** — `token-refresh.test.ts` now pins "now" to a fixed ISO instant (`2026-06-15T12:00:00Z`) via `t.mock.timers.enable({ apis: ["Date"] })` + `t.mock.timers.setTime(NOW)`. Token expiry values are expressed as absolute offsets from the anchor (`new Date(NOW + ONE_HOUR_MS)` instead of `new Date(Date.now() + 60*60*1000)`). Traces now read directly: "token expires at NOW + 1h, NOW is X, so not expired." `t.mock` auto-resets per test — verified 12/12 pass when run alongside `auth-edge-cases.test.ts` in the same process.
- [x] **Guard `fetch` monkey-patching** — added [`test/helpers/fetch-mock.ts`](../../apps/control-plane/src/test/helpers/fetch-mock.ts) exporting `withMockedFetch(mock, body)` which always restores `globalThis.fetch` even on throw. Migrated `token-refresh.test.ts`.
- [x] **Use `beforeEach(resetDb)` instead of start-of-test resets** — all 15 control-plane test files migrated to `beforeEach(async () => { if (pool) { await initDb(); await resetDb(); } })`. State leaks between tests are no longer possible.

### Coverage Gaps

- [x] **Split the 717-line E2E spec** — legacy `sequence-a-community-lifecycle.spec.ts` replaced with 5 feature specs (onboarding, community, invites, messaging, moderation) under [apps/web/e2e/](../../apps/web/e2e/) + shared [apps/web/e2e/helpers/](../../apps/web/e2e/helpers/) (reset, auth, navigation, setup). Each spec does its own `resetPlatform` + `bootstrapAdmin` in `beforeEach`, so one failure no longer cascades. Voice-room test left as `test.fixme` — real app-level bug where cold-context Join Voice redirects back to home hub (tracked in Phase 26).
- [~] **Voice / LiveKit UI tests** — pre-join in [`voice-channel.spec.ts`](../../apps/web/e2e/voice-channel.spec.ts) (2 tests); full create+join flow in [`community.spec.ts`](../../apps/web/e2e/community.spec.ts); VoiceSettingsModal in [`voice-settings.spec.ts`](../../apps/web/e2e/voice-settings.spec.ts) (4 tests: opens, dropdowns render, Cancel closes without reload, Save & Apply persists + reloads). **Bug surfaced + fixed during the test write:** `"voice-settings"` was missing from the `ModalType` union, dispatched via `"voice-settings" as any`, and `ClientModals.tsx` early-returned `null` for any modal not in its `isClientControlled` list — VoiceSettingsModal at [ClientModals.tsx:232](../../apps/web/components/modals/ClientModals.tsx#L232) was unreachable. Fix: add to union, drop `as any`, change early-return to short-circuit only when no modal is active. Still deferred: focus mode (needs 2-user multi-context test), PiP (`requestPictureInPicture()` unreliable in headless Chromium), reconnect (LiveKit reconnect timing non-deterministic).
- [~] **Discord bridge E2E** — gateway-side coverage deferred (no credible mock library; building one isn't worth the maintenance cost). REST/OAuth side may eventually use a forked `glideapps/fake-discord`. Until then, gateway flows are tested manually or via the future session-takeover system.
- [x] **SSE / realtime failure tests** — added [`realtime-failures.test.ts`](../../apps/control-plane/src/test/realtime-failures.test.ts) (7 tests): multi-subscriber, unsubscribe isolation, re-subscribe, no-buffering-while-disconnected, hub fan-out across channels, cross-hub isolation, cache short-circuit. Covers the in-process pub/sub layer; HTTP SSE transport tests deferred (route uses `reply.hijack()` which breaks `app.inject()`).
- [x] **Auth edge cases** — added [`auth-edge-cases.test.ts`](../../apps/control-plane/src/test/auth-edge-cases.test.ts) with 8 tests: tampered/expired/malformed/garbled session tokens (5 unit), tampered/expired cookie HTTP integration (2), OAuth refresh 500 graceful handling (1). Bundled an app fix to `auth/session.ts` that wraps `JSON.parse` in try/catch — without it, garbled payloads surfaced as 500s. Concurrent-refresh test deferred. Federation edge cases deferred to post-launch sprint.
- [~] **Federation tests** — deferred to post-launch sprint per direction; Phase 23 shipped Web-of-Trust / guest identity with zero coverage, revisit when federation is the active focus.
- [x] **Rate-limit tests** — added [`rate-limit.test.ts`](../../apps/control-plane/src/test/rate-limit.test.ts) (4 tests) covering 429 with structured body, `x-ratelimit-*` headers, per-IP buckets, x-forwarded-for chain handling.
- [x] **Migration tests** — added [`migrations.test.ts`](../../apps/control-plane/src/test/migrations.test.ts) with two tests: `up` twice is a no-op (idempotency) and a down→up roundtrip on the latest migration that diffs both `pgmigrations` and the `information_schema.columns` snapshot. Catches non-reversible migrations and partially-applied downs.
- [x] **Contract tests for `@skerry/shared`** — extended [`contracts.test.ts`](../../packages/shared/src/test/contracts.test.ts) with exhaustive `never` checks for all 9 string-union exports (AccessLevel, Role, ChannelType, JoinPolicy, ModerationActionType, ReportStatus, PrivilegedAction, DelegationAssignmentStatus, IdentityProvider) plus zod runtime tests for `MasqueradeParamsSchema`. Removing a value fails the array literal at compile; adding a value fails the `assertNever` branch at compile. 14 new tests, 16 total.
- [x] **Accessibility tests** — added [`accessibility.spec.ts`](../../apps/web/e2e/accessibility.spec.ts) (5 tests) using `@axe-core/playwright` on login, onboarding, initialize-workspace, post-bootstrap landing, and channel chat with messages. WCAG 2.0/2.1 A+AA rules; blocking impact tiers fail tests, advisory tiers log to stderr. Helper at [`helpers/a11y.ts`](../../apps/web/e2e/helpers/a11y.ts). `color-contrast` disabled by default (design tokens still tuning). Known finding: `nested-interactive` violation in sidebar (TODO follow-up — buttons inside buttons); rule disabled per-test until structural fix.
- [x] **Visual regression** — added [`visual-regression.spec.ts`](../../apps/web/e2e/visual-regression.spec.ts) (5 baselines): login, onboarding, initialize-workspace, empty-channel, message-bubble-with-markdown. Uses `toHaveScreenshot()` with focused selectors, animations disabled, masks for timestamps/avatars. Baselines under `apps/web/e2e/visual-regression.spec.ts-snapshots/`; regenerate with `--update-snapshots` after intentional design changes.

### Highest-ROI Next Moves (historical log)

X. **Extract helpers** (`resetDb`, auth, factories) — cuts suite size ~30% and prevents further drift.
X. **Fix the event-race pattern everywhere** — single source of unreliable failures.
X. **Split E2E into 4–5 specs** — independent failure signal.
X. **Add SSE-reconnect + rate-limit tests** — covers high-risk prod failure modes (`realtime-failures.test.ts` + `rate-limit.test.ts`, 11 tests).
X. **Migrate to `beforeEach(resetDb)` + replace local `delete from` resets** — all 15 control-plane test files now share one `beforeEach` and the TRUNCATE CASCADE helper.

X. **Auth edge cases** — `auth-edge-cases.test.ts` (8 tests) + JSON.parse-in-verify bug fix.
X. **Migration idempotency** — `migrations.test.ts` (2 tests) covering up-twice and down→up roundtrip.

X. **Concurrent-refresh test + single-flight fix** — added 9th test to `auth-edge-cases.test.ts`. Two parallel `ensureIdentityTokenValid` calls for the same identity now share one OAuth refresh via an in-flight `Map<userId, Promise>` in `identity-service.ts`. Test was initially failing 3≠1 because `upsertIdentityMapping` triggers Synapse `registerUser` + `setUserDisplayName` fetches; mock now filters to OAuth-only.
X. **Contract tests for `@skerry/shared`** — exhaustive-never checks on 9 string unions + zod tests for `MasqueradeParamsSchema`. 14 new tests in `contracts.test.ts`.
X. **Accessibility, visual regression, and pre-join voice tests** — `accessibility.spec.ts` (5), `visual-regression.spec.ts` (5), `voice-channel.spec.ts` (2). 12 new e2e tests.

X. **Voice join cold-context bug (Phase 26)** — fixed via single useEffect that keeps `localStorage.lastServerId` in sync with `selectedServerId`. Test passes deterministically; full e2e suite green.

X. **VoiceSettingsModal coverage + ClientModals visibility bug** — `voice-settings.spec.ts` (4 tests) + 3-line app fix in `ClientModals.tsx`/`chat-context.tsx`/`chat-window.tsx`.
X. **Inject a clock for token-refresh** — `t.mock.timers` pinning "now" to a fixed ISO instant. Self-documenting traces.
X. **Move `config.discordBridge.mockMode` out of module-load** — centralized in `test/setup.ts`, preloaded via `tsx --import`. 8 per-file lines removed.
X. **Split oversized test files** — `integration-auth-chat-permissions.test.ts` (1,415 LOC) → 4 files; `message-crud.test.ts` (770 LOC) → 3 files. 116/116 still green.

**Deferred to post-launch sprint:**
- **Federation tests** — Phase 23 shipped Web-of-Trust + guest identity with zero coverage; revisit when federation work is the active focus.
- **Discord bridge E2E** — gateway mocking has no good library and isn't worth building in-house; gateway flows stay manual or wait for the session-takeover system. REST/OAuth mocking still tracked separately if the fake-discord fork moves forward.
