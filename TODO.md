# TODO — Skerry Platform: Post-Alpha Sprint Roadmap

**Created:** 2026-03-08
**Based on:** `ReleaseReadinessReport_2026-03-08.md`
**Previous archive:** `TODO_ARCHIVE_2026-02-13.md`, `TODO_ARCHIVE_2026-03-08.md`

All Tier 1 blockers from the Feb 28 report are resolved. This roadmap covers the remaining work to reach Private Alpha, then Public Beta, then production hardening.

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

## Phase 18 — Public Beta: Notification System

**Goal:** Keep users informed across sessions and devices.
**Status:** Complete (Real-time bus & preferences implementation)

- [x] Upgrade SSE transport from channel-scoped to hub-scoped global event bus — enables cross-channel presence, typing, and DM notifications without re-subscribing
- [x] Notification preferences per channel (all messages / mentions only / muted)
- [x] Notification badge in browser tab title update on new mentions
- [ ] Email notifications for @mentions when user is offline (requires email service integration — see Phase 21)

---

## Phase 19 — Public Beta: Rich Media & Embeds

**Goal:** Make shared content interactive and visually rich.
**Status:** Complete

- [x] **URL preview / link embeds** — backend scraper (title, description, thumbnail via Open Graph); display card below message containing links
- [x] **Image lightbox** — click to expand inline images full-screen
- [x] **Video previews** — support MP4/WebM inline previews and play icons for YouTube
- [x] **GIF support** — ensure animated GIFs are correctly prioritized over static thumbnails

---

## Phase 20 — Moderation Hardening

**Goal:** Make moderation actions safe, reversible, and complete.
**Status:** Mostly Complete

- [x] Implement timed timeout via Synapse power-level scheduling or a `moderation_time_restrictions` DB table + scheduled runner
- [x] Warn action (DM warning message to user before punitive action)
- [x] Strike system — configurable warn → mute → kick → ban escalation
- [x] Moderation action UI improvements — confirmation dialogs, undo window for redact
- [x] Rate-limit reporting endpoint to prevent report spam
- [ ] **Report Triage UI** — Interface for admins to view, manage, and resolve user reports

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

## Phase 22 — Test Coverage Expansion

**Goal:** Raise confidence before production traffic hits the system.
**Status:** Complete

- [x] Integration tests for authenticated message send, edit, delete, and reaction flows (`message-crud.test.ts`)
- [x] Integration tests for DM creation and messaging (`dm-messaging.test.ts`)
- [x] Integration tests for voice token issuance (covered in `integration-auth-chat-permissions.test.ts`)
- [x] Moderation action tests (kick/ban permission gates, warn, strike, report flow — Discord bridge mocked) (`moderation-actions.test.ts`)
- [x] E2E tests: message send → receive via SSE, edit, delete, profile modal open (`message-flow.spec.ts`, `profile-modal.spec.ts`)
- [x] Presence service tests: online threshold logic, stale user handling, multi-user mixed state (`presence-service.test.ts`)
- [ ] Load test: SSE connection scalability under concurrent channel subscribers (deferred — requires dedicated load-testing tooling)

---

## Phase 23 — Extensions & Ecosystem (Post-Launch)

**Goal:** Grow the platform beyond core chat.
**Status:** In Progress

- [x] **Custom emoji / stickers** — per-server emoji upload and picker
- [x] **Webhooks** — inbound webhooks to post to channels (for CI/CD alerts, etc.)
- [x] **Bot framework** — first-party bot scaffolding using the existing chat API (House Bot)
- [x] **Federation enhancements** — Web-of-Trust trust model, guest identity resolution
- [ ] **Mobile app** — (Separate repository)
- [x] **Multi-hub orchestration** — Docker Compose standard, bootstrap-hub.sh script
- [x] **Stream Contextual Threads** — Scaffolding for Live Status in House Bot
- [x] **Twitch Integration** — Scaffolding for Live Status in House Bot
- [x] **Announcement Channel Rework** — Followable space-level feed, global aggregation

---

## Current Sprint Focus

Current focus is **Phase 20** (Moderation Hardening) and **Phase 23** (Extensions & Ecosystem).

- [x] Phase 19: Rich Media & Embeds (URL previews, image lightbox, video previews, GIF support)
- [x] Phase 22: Test Coverage Expansion

---

## Phase 24 — Creator Suite & Branding

**Goal:** Empower hub and space admins with professional branding and landing page tools.
**Status:** In Progress (Foundations & Code Editor Complete)

- [x] **Hierarchical CSS Theming** — Hub > Space > Page variable injection
- [x] **Professional Code Editor** — Integrated PrismJS with live side-by-side preview
- [x] **Variable Interpolation** — Dynamic tokens like `{{serverName}}`, `{{viewerName}}`
- [x] **Template Library** — Preset landing page layouts (Hero, Profile, Splash)
- [x] **Asset Integration** — Direct "Upload & Insert" help for images in the editor
- [ ] **SEO & Social Metadata** — Per-page meta tags (og:title, og:image) and favicon customization
- [ ] **PWA Support** — Manifest.json generation per Hub for "Add to Home Screen" experience
- [ ] **Custom Domains** — Path-based routing with Caddy (Maintenance and support for user domains)

---

## Phase 25 — Triage Backlog

_Items prioritized during the Refactoring Sprint triage._

### 🚨 Tier 1: Critical Blockers

- [x] **Fix Page Navigation Flashing (#29)** — Eliminate the back-and-forth flashing behavior when switching between rooms or servers.
- [x] **VC Reliability (#13)** — Fix dropping connections (LiveKit/WebRTC debugging required).
- [x] **Discord Bridging Refactor (#24)** — Implement dynamic message ID mapping for deletions and editing.
- [x] **Masquerade Persistence (#25)** — Fix complex issues with masquerade system.
- [x] **Real-time Message Sync Regression (#30)** — Fix issue where messages/edits/deletions don't appear until page refresh (SSE/EventBus).

### 🔧 Tier 2: Core UX Bugs

- [x] **Threaded Conversations (#27)** — Fix missing moderation/context menus for threaded replies.
- [x] **Invite Link Generation (#23)** — Current generated links need a functional contract defining what they do and are for.
- [x] **Settings Theme Sync (#21)** — Fix state desync where settings page drops dark/light preference.
- [x] **OAuth Mapping (#9)** — Fix "Guest" issue when linking Twitch after Discord.

### 🏗️ Tier 3: Medium Features & Polish

- [x] **Discord Content Bridging (#18, #26)** — Fix block quote rendering and implement sticker/emoji support.
- [ ] **Discord Bridge OAuth Flow (#22)** — Refactor connection UX to prevent losing place in menus.
- [x] **Twitch Integration UI (#6)** — Fixed alignment and asset issues with Twitch logo on login.
- [x] **Storage Audit (#20)** — Implemented automated `pnpm run cleanup` (builder/image prune) in build cycle.
- [x] **Rebranding Completion (#28)** — Finalize any remaining code references to EscapeHatch.

---

## Phase 26 — Stability & Refinement

**Goal:** Harden the newly refactored architecture and resolve navigation regressions.
**Status:** Planning

- [ ] **Deeper Client Isolation** — Maintain strict boundaries between `useChat` hooks and `<ChatClient />` DOM tree across all new features.
- [ ] **E2E Testing Expansion** — Implement automated headless Cypress/Playwright assertions for isolated Modals and UI triggers.
- [x] **Video Chat Reliability** — Fix camera preview and subscription bugs (Event listener overhaul).

### Video Chat Enhancements

- [x] Implement Track-based rendering in `VoiceRoom` (Camera + Screen)
- [x] Create `VoiceSettingsModal` for device management
- [x] Implement Stage Layout (Focus Mode)
- [x] Add Picture-in-Picture (PiP) support
- [x] **Voice join redirects to home hub from cold context** — root cause: `localStorage.lastServerId` was only updated by `handleServerChange`. Other paths that change `selectedServerId` (most notably the post-create-space auto-switch via `SET_CHAT_INITIAL_DATA`) left `lastServerId` stale. Meanwhile `handleChannelChange` kept `lastChannelId` fresh. When the Initial Chat Load effect re-fired (e.g., on a `bootstrapStatus` reference change), it called `refreshChatState(staleServer, freshChannel)` — channel didn't exist in stale server's list, validation reset to default → user kicked back to home hub. Fix: a single `useEffect` in [chat-client.tsx](apps/web/src/components/chat-client.tsx) writes `localStorage.lastServerId` whenever `selectedServerId` changes, keeping it in sync regardless of which code path triggered the change. Voice join test now passes deterministically (8.9s, single attempt). All 23 e2e tests green.
- [ ] Implement "Sing-along" Latency Monitoring Mode (Deferred) Implement Web Audio DelayNode loopback to allow synchronized singing/monitoring with network latency.

---

## Phase 27 — BugFixesAndPolish Retry

**Goal:** Re-apply fixes from the `BugFixesAndPolish` branch one-at-a-time on a fresh branch off main, instead of as a single batch. The original batch landed mixed (some stuck, some didn't, some partially); isolating each fix makes the partial outcomes diagnosable. Every item below needs re-doing on the new branch — even ones that worked the first time, since main never received them.

**Branch reference:** `BugFixesAndPolish` — 3 commits beyond main (`53c5ea7`, `e1b1bde`, `fe015e9`). Cherry-pick / re-implement each item below in isolation; verify before moving to the next.

**Suggested order:** small isolated fixes first (theme, modal crash), then the DM pair (list-refresh is a prerequisite for routing), then emoji rendering, then the partial-fix investigation, then styling verification. Skerry-side mirror is blocked on UI work and stays deferred.

- [ ] **Theme toggle doesn't persist across toggles** — previously stuck on first pass; just needs re-applying.
  - Prior approach in `53c5ea7`: FOUC guard in [use-theme.ts](apps/web/hooks/use-theme.ts) was re-applying on every render and overwriting user choice with stale `localStorage`. Fix gates the guard so it only runs on initial mount.

- [ ] **"New Message" / DM picker crashed with context error** — previously stuck on first pass; just needs re-applying.
  - Prior approach in `53c5ea7`: `ModalManager` wasn't wrapped in `ChatHandlersProvider`, so opening the DM picker threw `useChatHandlers must be used within a ChatHandlersProvider`. Fix wraps `ModalManager` inside the provider in [chat-client.tsx](apps/web/components/chat-client.tsx). (Note: this is a prerequisite for the DM-routing retry below — without it, the modal can't dispatch.)

- [ ] **DM list doesn't refresh after creating a new DM** — previously attempted in `53c5ea7`, did not stick.
  - Prior approach: new `ADD_DM_CHANNEL` reducer action in [chat-context.tsx](apps/web/context/chat-context.tsx) that prepends the new DM into `state.allDmChannels` (and conditionally `state.channels` when the DM server is active); dispatched from [dm-picker-modal.tsx](apps/web/components/dm-picker-modal.tsx) on creation. Regression test in [chat-context-reducer.test.ts](apps/web/test/chat-context-reducer.test.ts).
  - Next move: re-apply in isolation, then verify the dispatch actually fires after creation before assuming the reducer logic is at fault.

- [ ] **Routing to a just-created DM fails** — previously attempted in `53c5ea7` + `fe015e9`, did not stick. Depends on the previous item.
  - Prior approach: extended `refreshChatState` in [use-chat-initialization.ts](apps/web/hooks/use-chat-initialization.ts) with an `extraKnownChannels` parameter so the channel-existence validator falls back to `state.allDmChannels` when `listChannels` hasn't caught up. DMPickerModal passes the new channel explicitly to dodge closure-captured state. (The sibling fix that wrapped `ModalManager` in `ChatHandlersProvider` did stick — that was the "New Message crash" fix.)
  - Next move: land the optimistic-state plumbing first, then trace whether `extraKnownChannels` is populated at the validation site, or whether validation runs before the dispatch settles.

- [ ] **Custom Discord emoji reactions render as text instead of images** — previously stuck on first pass; just needs re-applying. Prerequisite for verifying the backfill investigation below.
  - Prior approach in `53c5ea7`: two halves. (1) Backend — [discord-bot-client.ts](apps/control-plane/src/services/discord-bot-client.ts) now encodes incoming Discord reactions in tag form (`<:name:id>` / `<a:name:id>`) when storing into `message_reactions`, so the row carries the snowflake. (2) Frontend — added a `ReactionEmoji` component in [chat-window.tsx](apps/web/components/chat-window.tsx) that parses the tag and renders the Discord CDN image URL.

- [ ] **Custom Discord emoji backfill — only some emojis render** — partially fixed by migration `031-backfill-discord-reaction-emoji-tags.js` in `fe015e9`. Investigate the remainder.
  - Prior approach: backfill migration joins `message_reactions` against `discord_seen_emojis` and rewrites bare names (`myEmoji`) into Discord tag form (`<:name:id>`). Uses `DISTINCT ON (name)` to pick the most-recently-seen variant.
  - Likely gaps that match "only some emojis show":
    - Emoji name not present in `discord_seen_emojis` (bot never observed it) → join produces no row, stays as bare text.
    - Same name across multiple snowflake IDs in different servers → `DISTINCT ON (name)` keeps one variant; others lose their join.
    - Unique-constraint collisions where both bare-name and tag-form rows exist for the same `(message_id, user_id)` → `UPDATE` silently skips.
  - Next move: `SELECT emoji, count(*) FROM message_reactions WHERE emoji NOT LIKE '<%' GROUP BY emoji` against the unbackfilled rows and bucket each into one of the three categories above. That determines whether the fix is "extend `discord_seen_emojis` coverage" or "handle collisions explicitly."

- [ ] **Skerry emoji → Discord mirror at application level (slot-cap fix)** — landed in `e1b1bde`, **untested** because Skerry doesn't have custom-emoji upload UI yet, so there's nothing to mirror.
  - Prior approach: migration `030-skerry-emoji-mirrors-app-level.js` reshapes `discord_emoji_mappings` from per-guild (50-slot cap, keyed on `server_id` + `skerry_emoji_id`) to application-level (2000-slot bot-wide, keyed on `skerry_emoji_id` alone). [discord-bot-client.ts](apps/control-plane/src/services/discord-bot-client.ts) `provisionProjectEmoji()` now targets `client.application.emojis` and runs once at bot login; relay path uses `getOrMirrorSkerryEmojiToBotApp` with collision-resistant naming `_<6-char-id-suffix>`. Per-guild provisioning was removed from `selectDiscordGuild` in [discord-bridge-service.ts](apps/control-plane/src/services/discord-bridge-service.ts).
  - Status: deferred. Revisit once the Skerry-side custom emoji UI lands and there's a source emoji to mirror.

- [ ] **Styling drift in DM picker / reaction buttons** — landed across `53c5ea7` + `fe015e9`, **status unverified**.
  - Prior approach: added `--bg-strong` and `--accent-soft` design tokens (light + dark) to [globals.css](apps/web/app/globals.css), defined `.interaction-btn` class, converted DM picker modal from inline styles to `.modal-overlay`/`.modal-content`/`.modal-header`/`.modal-body` classes, added a `ReactionEmoji` component in [chat-window.tsx](apps/web/components/chat-window.tsx) that renders custom emoji via CDN URL, plus scrollbar styling on `.messages`.
  - Next move: visual diff these surfaces against current main to confirm whether the drift exists at all before retrying. May be a no-op.

---

## Pre-Release List

### Bugs

- [ ] **Sticker cache permission errors** — 6 failing tests trace to [`media-routes.ts:21-25`](apps/control-plane/src/routes/media-routes.ts#L21-L25); `fs.mkdir("/app/cache/stickers")` fails with `EACCES` and lacks fallback.
- [ ] **Sticker cache race condition** — [`media-routes.ts:105`](apps/control-plane/src/routes/media-routes.ts#L105): `fs.writeFile(...).catch(...)` not awaited; subsequent requests may hit empty/partial cache.
- [ ] **Silent poll failures** — [`use-chat-realtime.ts:101`](apps/web/src/hooks/use-chat-realtime.ts#L101): `.catch(() => {})` swallows errors; no retry or user notification.
- [ ] **Stray `console.log` calls** — 179 instances in production paths (`media-routes`, `discord-bridge-service`).
- [ ] **Unsafe type casts** — 39 `any` casts in control-plane + 15+ `as any` in web (e.g. [`voice-room.tsx:38`](apps/web/src/components/voice-room.tsx#L38) `grant as any`).

### Optimizations

- [ ] **Split `chat-window.tsx`** — 1,828 LOC with 11 `useEffect` + 7 `useMemo`.
- [ ] **Simplify URL sync** — [`chat-client.tsx:531-582`](apps/web/src/components/chat-client.tsx#L531-L582): 5 interconnected refs; brittle and re-render-prone.
- [ ] **Gate polling on SSE state** — [`use-chat-realtime.ts:102`](apps/web/src/hooks/use-chat-realtime.ts#L102): 3-second polling fallback can run alongside SSE on reconnect.
- [ ] **Add LRU/size cap to sticker cache** — currently unbounded disk growth.
- [ ] **Channel switch over-fetches metadata** — [`use-chat-initialization.ts:330`](apps/web/hooks/use-chat-initialization.ts#L330): `handleChannelChange` calls `refreshChatState(..., force=true)` to bypass the "already on this channel" early return at [line 151](apps/web/hooks/use-chat-initialization.ts#L151), but `force` is overloaded — it also invalidates `listServers`, `listViewerRoleBindings`, `listHubs`, `listChannels`, and `listCategories` ([lines 112-114](apps/web/hooks/use-chat-initialization.ts#L112-L114), [171-172](apps/web/hooks/use-chat-initialization.ts#L171-L172)), none of which change on an intra-server channel switch. Result: ~6 requests per switch instead of 1–2 (fetchChannelInit + markRead). Fix: split the flag — either add a `bypassEarlyReturn` parameter, or drop `force` from this path and tighten the early-return condition to compare requested vs current channel directly.

### Duplicate Code

- [ ] **MD5 hashing** — repeated in `media-routes`; extract to a shared util.
- [ ] **Media URL normalization** — [`chat-window.tsx:61-76`](apps/web/src/components/chat-window.tsx#L61-L76) (`normalizeMediaUrl()` / `getProxiedUrl()`) duplicates server-side logic in `media-routes`.
- [ ] **Discord permission checks** — duplicated between bridge service and bot client.
- [ ] **Reaction rendering** — duplicated across `chat-window` and `thread-panel`; extract a `<Reactions>` component.

### Missing Features

- [ ] **Report Triage UI** (Phase 20) — admins can't review reports.
- [ ] **Email notifications for @mentions** (Phase 21).
- [ ] **SEO metadata, PWA, custom domains** (Phase 24).
- [ ] **Discord OAuth UX polish** (Phase 25).
- [ ] **Loading state in `VoiceRoom`** — while fetching LiveKit token.
- [ ] **Debounce search modal** input.
- [x] **Expand E2E coverage** — split monolithic spec into onboarding, community, invites, messaging, moderation, accessibility, visual-regression, voice-channel, voice-settings (10 spec files, 27+ tests). Federation E2E deferred to post-launch sprint.

### Industry-Standard Gaps

- [ ] **Message edit history** — show "edited" with a diff/timestamp on hover.
- [ ] **Pinned messages per channel** — with a "view all pins" drawer.
- [ ] **Slash commands** — beyond basic (`/shrug`, `/giphy`, custom webhooks, user-defined).
- [ ] **Scheduled messages** — compose now, send later.
- [ ] **Read receipts / last-read markers** — a "new messages" divider that persists across sessions.
- [ ] **Rich link unfurling** — OpenGraph previews with thumbnail, title, description.
- [ ] **Drafts per channel** — don't lose typed content when switching rooms.
- [ ] **Mute granularity** — 1h / 8h / 24h / until morning, not just on/off.
- [ ] **Do Not Disturb schedules** — status (away/busy/invisible) with auto-responses.
- [ ] **Code block syntax highlighting + copy button**.
- [ ] **Message forwarding** — across channels and DMs.
- [ ] **Native polls** — in messages (Discord/Slack both have them).
- [ ] **Voice messages** — record & send audio clips inline.
- [ ] **Screen sharing + server-side recording** — LiveKit already present; recording is a config away.
- [ ] **Accessibility audit** — keyboard-only navigation, ARIA on message list virtualization, reduced-motion for sticker animations, screen reader support for reactions.
- [ ] **Mobile web PWA with push notifications**.
- [ ] **2FA / passkeys** — WebAuthn support.
- [ ] **Session management UI** — "log out other devices".
- [ ] **Data export** — GDPR-compliant message download.
- [ ] **Bulk moderation tools** — select N messages; delete/move; timeout by pattern.
- [ ] **Audit log** — visible to admins.
- [ ] **Invite analytics** — track which invite link brought which users.

### Differentiators / Innovative Ideas

- [ ] **AI thread summaries** — "catch me up on the last 200 messages" using the existing Anthropic stack.
- [ ] **Semantic search** — embeddings-based, beats keyword-only search by a wide margin.
- [ ] **AI-assisted moderation** — auto-flag harassment/spam for the Report Triage UI.
- [ ] **Smart notifications** — learn which channels a user actually engages with; demote the rest.
- [ ] **Threaded voice rooms** — ephemeral breakout rooms spawned from a message.
- [ ] **Collaborative docs / whiteboard** — embedded in channels (Slack canvas-style).
- [ ] **Matrix / ActivityPub federation** — complement the existing Discord bridge.
- [ ] **Per-room custom CSS / themes** — for community identity.
- [ ] **"Lore" / pinned canon** — long-lived community knowledge surfaced to new joiners; auto-generated from popular pins + AI.
- [ ] **Creator monetization primitives** — paid channels, message tips, sticker-pack sales (extends Phase 24).
- [ ] **Voice room transcription + searchable archive** — huge for async communities.
- [ ] **Message "workflows"** — react with 📌 to auto-pin, 🗑️ to delete (admin), 🧵 to spin a thread; user-configurable.

---

## Test Suite Improvements

### Structural Issues

- [x] **Extract shared `resetDb()` helper** — consolidated into [`test/helpers/reset-db.ts`](apps/control-plane/src/test/helpers/reset-db.ts); table list derived dynamically from `information_schema.tables` (excluding `pgmigrations`/`platform_settings`) so it self-heals.
- [x] **Consolidate `createAuthCookie` + `bootstrap()` helpers** — extracted into [`test/helpers/auth.ts`](apps/control-plane/src/test/helpers/auth.ts) and [`test/helpers/bootstrap.ts`](apps/control-plane/src/test/helpers/bootstrap.ts) (includes `bootstrap()` + `bootstrapWithMember()`). Migrated 7 test files.
- [x] **Replace sequential `delete from` with `TRUNCATE ... CASCADE`** — 5 files (`api-snapshot`, `identity-service`, `hub-service`, `sql-robustness`, `masquerade`, plus narrower variants in `policy` and `presence-service`) had local `delete from`-based resetDb functions; all now use the shared `helpers/reset-db.ts` which truncates dynamically-discovered public tables in one statement.
- [x] **Move `config.discordBridge.mockMode = true` out of module-load** — created [`test/setup.ts`](apps/control-plane/src/test/setup.ts) preloaded via `tsx --import ./src/test/setup.ts --test ...`. Removed the per-file `config.discordBridge.mockMode = true;` line from 8 test files. New test files automatically inherit the baseline.
- [x] **Split oversized test files** — `integration-auth-chat-permissions.test.ts` (1,415 LOC, 18 tests) split into [`auth-basics.test.ts`](apps/control-plane/src/test/auth-basics.test.ts) (8 tests), [`federation.test.ts`](apps/control-plane/src/test/federation.test.ts) (2 tests), [`role-grants.test.ts`](apps/control-plane/src/test/role-grants.test.ts) (5 tests), [`space-permissions.test.ts`](apps/control-plane/src/test/space-permissions.test.ts) (3 tests). `message-crud.test.ts` (770 LOC, 13 tests) split into slimmed [`message-crud.test.ts`](apps/control-plane/src/test/message-crud.test.ts) (6 CRUD/permission tests), [`message-validation.test.ts`](apps/control-plane/src/test/message-validation.test.ts) (5 validation/media tests + search), [`hub-invites.test.ts`](apps/control-plane/src/test/hub-invites.test.ts) (1 invite test). 116/116 tests still green; biggest file dropped from 1,415 → 583 LOC.

### Performance

- [x] **Collapse pool idle timeout in tests** — [`db/client.ts`](apps/control-plane/src/db/client.ts) set `idleTimeoutMillis: 500` when `NODE_ENV=test`. Each test file was holding the process open for ~30s after the last assertion waiting for idle pg connections to drain; control-plane suite dropped from ~11.5 min to ~2 min.

### Flakiness

- [x] **Fix event-stream races** — added [`test/helpers/events.ts`](apps/control-plane/src/test/helpers/events.ts) with `captureEvents()` that collects into an array and provides `expect(eventName)` membership-matching. Migrated `realtime-sync.test.ts` (3 tests); `notifications.test.ts` uses HTTP assertions, no subscribe-style capture.
- [x] **Inject a clock** — `token-refresh.test.ts` now pins "now" to a fixed ISO instant (`2026-06-15T12:00:00Z`) via `t.mock.timers.enable({ apis: ["Date"] })` + `t.mock.timers.setTime(NOW)`. Token expiry values are expressed as absolute offsets from the anchor (`new Date(NOW + ONE_HOUR_MS)` instead of `new Date(Date.now() + 60*60*1000)`). Traces now read directly: "token expires at NOW + 1h, NOW is X, so not expired." `t.mock` auto-resets per test — verified 12/12 pass when run alongside `auth-edge-cases.test.ts` in the same process.
- [x] **Guard `fetch` monkey-patching** — added [`test/helpers/fetch-mock.ts`](apps/control-plane/src/test/helpers/fetch-mock.ts) exporting `withMockedFetch(mock, body)` which always restores `globalThis.fetch` even on throw. Migrated `token-refresh.test.ts`.
- [x] **Use `beforeEach(resetDb)` instead of start-of-test resets** — all 15 control-plane test files migrated to `beforeEach(async () => { if (pool) { await initDb(); await resetDb(); } })`. State leaks between tests are no longer possible.

### Coverage Gaps

- [x] **Split the 717-line E2E spec** — legacy `sequence-a-community-lifecycle.spec.ts` replaced with 5 feature specs (onboarding, community, invites, messaging, moderation) under [apps/web/e2e/](apps/web/e2e/) + shared [apps/web/e2e/helpers/](apps/web/e2e/helpers/) (reset, auth, navigation, setup). Each spec does its own `resetPlatform` + `bootstrapAdmin` in `beforeEach`, so one failure no longer cascades. Voice-room test left as `test.fixme` — real app-level bug where cold-context Join Voice redirects back to home hub (tracked in Phase 26).
- [~] **Voice / LiveKit UI tests** — pre-join in [`voice-channel.spec.ts`](apps/web/e2e/voice-channel.spec.ts) (2 tests); full create+join flow in [`community.spec.ts`](apps/web/e2e/community.spec.ts); VoiceSettingsModal in [`voice-settings.spec.ts`](apps/web/e2e/voice-settings.spec.ts) (4 tests: opens, dropdowns render, Cancel closes without reload, Save & Apply persists + reloads). **Bug surfaced + fixed during the test write:** `"voice-settings"` was missing from the `ModalType` union, dispatched via `"voice-settings" as any`, and `ClientModals.tsx` early-returned `null` for any modal not in its `isClientControlled` list — VoiceSettingsModal at [ClientModals.tsx:232](apps/web/components/modals/ClientModals.tsx#L232) was unreachable. Fix: add to union, drop `as any`, change early-return to short-circuit only when no modal is active. Still deferred: focus mode (needs 2-user multi-context test), PiP (`requestPictureInPicture()` unreliable in headless Chromium), reconnect (LiveKit reconnect timing non-deterministic).
- [~] **Discord bridge E2E** — gateway-side coverage deferred (no credible mock library; building one isn't worth the maintenance cost). REST/OAuth side may eventually use a forked `glideapps/fake-discord`. Until then, gateway flows are tested manually or via the future session-takeover system.
- [x] **SSE / realtime failure tests** — added [`realtime-failures.test.ts`](apps/control-plane/src/test/realtime-failures.test.ts) (7 tests): multi-subscriber, unsubscribe isolation, re-subscribe, no-buffering-while-disconnected, hub fan-out across channels, cross-hub isolation, cache short-circuit. Covers the in-process pub/sub layer; HTTP SSE transport tests deferred (route uses `reply.hijack()` which breaks `app.inject()`).
- [x] **Auth edge cases** — added [`auth-edge-cases.test.ts`](apps/control-plane/src/test/auth-edge-cases.test.ts) with 8 tests: tampered/expired/malformed/garbled session tokens (5 unit), tampered/expired cookie HTTP integration (2), OAuth refresh 500 graceful handling (1). Bundled an app fix to `auth/session.ts` that wraps `JSON.parse` in try/catch — without it, garbled payloads surfaced as 500s. Concurrent-refresh test deferred. Federation edge cases deferred to post-launch sprint.
- [~] **Federation tests** — deferred to post-launch sprint per direction; Phase 23 shipped Web-of-Trust / guest identity with zero coverage, revisit when federation is the active focus.
- [x] **Rate-limit tests** — added [`rate-limit.test.ts`](apps/control-plane/src/test/rate-limit.test.ts) (4 tests) covering 429 with structured body, `x-ratelimit-*` headers, per-IP buckets, x-forwarded-for chain handling.
- [x] **Migration tests** — added [`migrations.test.ts`](apps/control-plane/src/test/migrations.test.ts) with two tests: `up` twice is a no-op (idempotency) and a down→up roundtrip on the latest migration that diffs both `pgmigrations` and the `information_schema.columns` snapshot. Catches non-reversible migrations and partially-applied downs.
- [x] **Contract tests for `@skerry/shared`** — extended [`contracts.test.ts`](packages/shared/src/test/contracts.test.ts) with exhaustive `never` checks for all 9 string-union exports (AccessLevel, Role, ChannelType, JoinPolicy, ModerationActionType, ReportStatus, PrivilegedAction, DelegationAssignmentStatus, IdentityProvider) plus zod runtime tests for `MasqueradeParamsSchema`. Removing a value fails the array literal at compile; adding a value fails the `assertNever` branch at compile. 14 new tests, 16 total.
- [x] **Accessibility tests** — added [`accessibility.spec.ts`](apps/web/e2e/accessibility.spec.ts) (5 tests) using `@axe-core/playwright` on login, onboarding, initialize-workspace, post-bootstrap landing, and channel chat with messages. WCAG 2.0/2.1 A+AA rules; blocking impact tiers fail tests, advisory tiers log to stderr. Helper at [`helpers/a11y.ts`](apps/web/e2e/helpers/a11y.ts). `color-contrast` disabled by default (design tokens still tuning). Known finding: `nested-interactive` violation in sidebar (TODO follow-up — buttons inside buttons); rule disabled per-test until structural fix.
- [x] **Visual regression** — added [`visual-regression.spec.ts`](apps/web/e2e/visual-regression.spec.ts) (5 baselines): login, onboarding, initialize-workspace, empty-channel, message-bubble-with-markdown. Uses `toHaveScreenshot()` with focused selectors, animations disabled, masks for timestamps/avatars. Baselines under `apps/web/e2e/visual-regression.spec.ts-snapshots/`; regenerate with `--update-snapshots` after intentional design changes.
- [ ] **Performance budgets** — `chat-window.tsx` has no "render under N ms with 500 messages" guardrail.

### Quality-of-Life Upgrades

- [ ] **Standardize test names as sentences** — `"auth/session returns structured unauthorized error with correlation id"` is great; many others (e.g. [`extensions.test.ts`](apps/control-plane/src/test/extensions.test.ts)) are terse. Consistency helps when grepping failures.
- [ ] **Tag slow / serial tests** — add a convention like `{ concurrency: false }` for DB-touching tests so CI parallelism is explicit.
- [ ] **Add a JUnit / TAP reporter** — surface failures as CI annotations instead of tail-of-log hunts.
- [ ] **Expand [`api-snapshot.test.ts`](apps/control-plane/src/test/api-snapshot.test.ts)** — cover every route's response shape to prevent accidental breaking changes.
- [ ] **Add coverage tooling** — no `.nycrc` or `c8` config present; even a loose >60% threshold would highlight untested branches.
- [ ] **Seed-data factories** — replace scattered `insert into hubs...` SQL with `createHub()` / `createChannel()` / `createUser()` factories.

### Highest-ROI Next Moves

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

1. **Remaining Voice/LiveKit coverage** — focus mode (2-user multi-context test, realistic for E2E). PiP and reconnect stay manual (headless Chromium can't assert PiP; LiveKit reconnect timing non-deterministic).
2. **CI strategy decision** — self-hosted runner vs. cloud workflow with `services.postgres` (+ Synapse/LiveKit containers). Without this, none of the new tests run automatically. Unblocks #3.
3. **TAP reporter + coverage tooling** — deferred until (2) lands.

**Deferred to post-launch sprint:**
- **Federation tests** — Phase 23 shipped Web-of-Trust + guest identity with zero coverage; revisit when federation work is the active focus.
- **Discord bridge E2E** — gateway mocking has no good library and isn't worth building in-house; gateway flows stay manual or wait for the session-takeover system. REST/OAuth mocking still tracked separately if the fake-discord fork moves forward.

**Deferred to post-launch sprint:**
- **Federation tests** — Phase 23 shipped Web-of-Trust + guest identity with zero coverage; revisit when federation work is the active focus.
