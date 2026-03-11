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
**Status:** Planned

- [ ] **URL preview / link embeds** — backend scraper (title, description, thumbnail via Open Graph); display card below message containing links
- [ ] **Image lightbox** — click to expand inline images full-screen
- [ ] **Video previews** — inline playback for video attachments
- [ ] **GIF support** — animated GIF rendering (already stored, just needs `<img>` pointer vs `<video>`)

---

## Phase 20 — Moderation Hardening

**Goal:** Make moderation actions safe, reversible, and complete.
**Status:** Planned

- [ ] Implement timed timeout via Synapse power-level scheduling or a `moderation_time_restrictions` DB table + scheduled runner
- [ ] Warn action (DM warning message to user before punitive action)
- [ ] Strike system — configurable warn → mute → kick → ban escalation
- [ ] Moderation action UI improvements — confirmation dialogs, undo window for redact
- [ ] Rate-limit reporting endpoint to prevent report spam

---

## Phase 21 — Infrastructure & Operations

**Goal:** Harden the platform for production traffic and operations.
**Status:** Planned

- [ ] **Email service** — integrate SMTP (e.g., Resend, Postmark, or SES) for: account recovery, invite emails, offline mention notifications
- [ ] **Observability** — expand `observability-service.ts`; add structured request logging (JSON), Prometheus metrics endpoint, Sentry (or equivalent) error tracking
- [ ] **Rate limit audit** — verify `rateLimitPerMinute: 240` is enforced on all routes; add per-user rate limits on message send
- [ ] **PostgreSQL backups** — automate point-in-time recovery (daily pg_dump to S3 or equivalent)
- [ ] **Health checks** — deepen `/health` to include DB ping, Synapse reachability, and Redis/SSE broker alive
- [ ] **Reverse proxy config** — finalize Nginx/Caddy production config with SSL, HSTS, WebSocket upgrade
- [ ] **CI/CD pipeline** — verify `.github/workflows/ci.yml` runs: lint, typecheck, build, and all tests on every PR; add deployment step

---

## Phase 22 — Test Coverage Expansion

**Goal:** Raise confidence before production traffic hits the system.
**Status:** Planned

- [ ] Integration tests for authenticated message send, edit, delete, and reaction flows
- [ ] Integration tests for DM creation and messaging
- [ ] Integration tests for voice token issuance
- [ ] Moderation action tests (kick, ban, timeout — with Discord bridge mocked)
- [ ] E2E tests: message send → receive via SSE, file upload, profile modal open
- [ ] Presence service tests: online threshold logic, stale user handling
- [ ] Load test: SSE connection scalability under concurrent channel subscribers

---

## Phase 23 — Extensions & Ecosystem (Post-Launch)

**Goal:** Grow the platform beyond core chat.
**Status:** Backlog

- [ ] **Custom emoji / stickers** — per-server emoji upload and picker
- [ ] **Webhooks** — inbound webhooks to post to channels (for CI/CD alerts, etc.)
- [ ] **Bot framework** — first-party bot scaffolding using the existing chat API
- [ ] **Federation enhancements** — cross-hub channel bridging, shared member identity
- [ ] **Mobile app** — PWA or native shell wrapping the web client
- [ ] **Multi-hub orchestration** — K8s manifests, helm chart, per-hub resource isolation (is this necessary?)
- [ ] **Stream Contextual Threads** — If a Space Administrator is a Twitch Streamer with their account linked to their Space, when they go live, the control plane should auto-create a "Live Discussion" room/thread/something... When the stream ends, it should post a link to the VOD and lock the discussion. If possible this channel should bridge to the live Twitch chat.
- [ ] **Twitch Integration** — Space Administrators should be able to configure a post to send when their Twitch stream goes live.
- [ ] **Announcement Channel Rework** — Announcements are an ephemeral stream. Perhaps we should reconsider whether Announcements are a channel at all, or if they're a feature of the Space, allowing direct posting to a custom UI location dedicated for followed Announcements.
---

## Current Sprint Focus

Current focus is **Phase 19** (Rich Media & Embeds) and **Phase 20** (Moderation Hardening).
