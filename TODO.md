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

*Items prioritized during the Refactoring Sprint triage.*

### 🚨 Tier 1: Critical Blockers
- [x] **Fix Page Navigation Flashing (#29)** — Eliminate the back-and-forth flashing behavior when switching between rooms or servers.
- [x] **VC Reliability (#13)** — Fix dropping connections (LiveKit/WebRTC debugging required).
- [x] **Discord Bridging Refactor (#24)** — Implement dynamic message ID mapping for deletions and editing.
- [x] **Masquerade Persistence (#25)** — Fix complex issues with masquerade system.
- [x] **Real-time Message Sync Regression (#30)** — Fix issue where messages/edits/deletions don't appear until page refresh (SSE/EventBus).

### 🔧 Tier 2: Core UX Bugs
- [x] **Threaded Conversations (#27)** — Fix missing moderation/context menus for threaded replies.
- [ ] **Invite Link Generation (#23)** — Current generated links need a functional contract defining what they do and are for.
- [ ] **Settings Theme Sync (#21)** — Fix state desync where settings page drops dark/light preference.
- [ ] **OAuth Mapping (#9)** — Fix "Guest" issue when linking Twitch after Discord.

### 🏗️ Tier 3: Medium Features & Polish
- [ ] **Discord Content Bridging (#18, #26)** — Fix block quote rendering and implement sticker/emoji support.
- [ ] **Discord Bridge OAuth Flow (#22)** — Refactor connection UX to prevent losing place in menus.
- [ ] **Twitch Integration UI (#6)** — Fix "ITS F#CKED" alignment/asset issue with Twitch logo on login.
- [ ] **Storage Audit (#20)** — Monitor Docker storage (Note: manual prune `docker builder prune` recommended).
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
- [ ] Implement "Sing-along" Latency Monitoring Mode (Deferred) Implement Web Audio DelayNode loopback to allow synchronized singing/monitoring with network latency.