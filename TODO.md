# TODO — Skerry Platform: Post-Alpha Sprint Roadmap

**Created:** 2026-03-08
**Based on:** `ReleaseReadinessReport_2026-03-08.md`
**Previous archives:** [`TODO_ARCHIVE_2026-02-13.md`](docs/archive/TODO_ARCHIVE_2026-02-13.md), [`TODO_ARCHIVE_2026-03-08.md`](docs/archive/TODO_ARCHIVE_2026-03-08.md), [`TODO_ARCHIVE_2026-05-02.md`](docs/archive/TODO_ARCHIVE_2026-05-02.md)

> **2026-05-02:** All open items have been migrated to [GitHub issues](https://github.com/SecareLupus/Skerry/issues) (#48–#87) and tagged inline with `(#NN)`. The two wishlist sections (Industry-Standard Gaps, Differentiators) are aggregated under tracker issues #86 and #87. Use the issue tracker as the source of truth for in-flight work. Completed phases and items live in [`docs/archive/TODO_ARCHIVE_2026-05-02.md`](docs/archive/TODO_ARCHIVE_2026-05-02.md).

---

## Phase 18 — Public Beta: Notification System

**Status:** Mostly Complete — real-time bus + preferences shipped; offline email pending.

- [ ] Email notifications for @mentions when user is offline (requires email service integration — see Phase 21) (#59)

---

## Phase 20 — Moderation Hardening

**Status:** Mostly Complete — admin triage UI pending.

- [ ] **Report Triage UI** — Interface for admins to view, manage, and resolve user reports (#60)

---

## Phase 22 — Test Coverage Expansion

**Status:** Mostly Complete — load test deferred until tooling is in place.

- [ ] Load test: SSE connection scalability under concurrent channel subscribers (deferred — requires dedicated load-testing tooling) (#61)

---

## Phase 23 — Extensions & Ecosystem (Post-Launch)

**Status:** In Progress — mobile client lives in a separate repo.

- [ ] **Mobile app** — (Separate repository) (#62)

---

## Phase 24 — Creator Suite & Branding

**Status:** In Progress — foundations & code editor complete; branding metadata + per-Hub deployment surfaces remain.

- [ ] **SEO & Social Metadata** — Per-page meta tags (og:title, og:image) and favicon customization (#63)
- [ ] **PWA Support** — Manifest.json generation per Hub for "Add to Home Screen" experience (#64)
- [ ] **Custom Domains** — Path-based routing with Caddy (Maintenance and support for user domains) (#65)

---

## Phase 25 — Triage Backlog

_Items prioritized during the Refactoring Sprint triage._
**Status:** Mostly Complete — Tier 1 closed; #21, #23, #26, and #9 reopened after re-triage on 2026-05-02.

### 🔧 Tier 2: Core UX Bugs

- [ ] **Invite Link Generation (#23)** — Partial: links are created and grant access (per [#23 thread](https://github.com/SecareLupus/Skerry/issues/23), 2026-05-02), but the broader permissions/invites system still needs design focus (what role invites play, how they differ from showing up at the server URL, etc.).
- [~] **Settings Theme Sync (#21)** — Possibly fixed by the Phase 27 theme-FOUC guard in `fe54478`; needs user testing to confirm (settings page → refresh, verify theme persists). See [#21](https://github.com/SecareLupus/Skerry/issues/21).
- [ ] **OAuth Mapping (#9)** — Not fixed. When an account created via Discord is linked with Twitch, logging in via Twitch shows the user as "Guest" in the corner instead of the display name. Both OIDC paths send correct display names downstream.

### 🏗️ Tier 3: Medium Features & Polish

- [ ] **Discord Block Quote Bridging (#26)** — Skerry → Discord block quote markdown still broken (Skerry icon prefix breaks the `>` syntax). Additionally, per the [#26 thread](https://github.com/SecareLupus/Skerry/issues/26): Discord messages that quote a previous message currently aren't getting bridged into Skerry at all.

---

## Phase 26 — Stability & Refinement

**Status:** Planning — video chat reliability landed; client-isolation discipline + modal E2E coverage + sing-along latency mode remain.

- [ ] **Deeper Client Isolation** — Maintain strict boundaries between `useChat` hooks and `<ChatClient />` DOM tree across all new features. (#58)
- [ ] **E2E Testing Expansion** — Implement automated headless Cypress/Playwright assertions for isolated Modals and UI triggers. (#66)

### Video Chat Enhancements

- [ ] Implement "Sing-along" Latency Monitoring Mode (Deferred) Implement Web Audio DelayNode loopback to allow synchronized singing/monitoring with network latency. (#67)

---

## Phase 27 — BugFixesAndPolish Retry

**Status:** Mostly Complete — PR #37 (`edfb91e`) merged 6 of 7 items; item below stays deferred until upload UI lands. See archive for the completed-item history.

- [ ] **Skerry emoji → Discord mirror at application level (slot-cap fix)** — landed in `e1b1bde`, **untested and deferred**. Skerry doesn't have custom-emoji upload UI yet, so there's nothing to mirror. Revisit once the upload UI lands. (#68)
  - Prior approach: migration `030-skerry-emoji-mirrors-app-level.js` reshapes `discord_emoji_mappings` from per-guild (50-slot cap, keyed on `server_id` + `skerry_emoji_id`) to application-level (2000-slot bot-wide, keyed on `skerry_emoji_id` alone). [discord-bot-client.ts](apps/control-plane/src/services/discord-bot-client.ts) `provisionProjectEmoji()` now targets `client.application.emojis` and runs once at bot login; relay path uses `getOrMirrorSkerryEmojiToBotApp` with collision-resistant naming `_<6-char-id-suffix>`. Per-guild provisioning was removed from `selectDiscordGuild` in [discord-bridge-service.ts](apps/control-plane/src/services/discord-bridge-service.ts).

---

## Pre-Release List

### Bugs

- [ ] **Sticker cache permission errors** — 6 failing tests trace to [`media-routes.ts:21-25`](apps/control-plane/src/routes/media-routes.ts#L21-L25); `fs.mkdir("/app/cache/stickers")` fails with `EACCES` and lacks fallback. (#48)
- [ ] **Sticker cache race condition** — [`media-routes.ts:105`](apps/control-plane/src/routes/media-routes.ts#L105): `fs.writeFile(...).catch(...)` not awaited; subsequent requests may hit empty/partial cache. (#48)
- [ ] **Silent poll failures** — [`use-chat-realtime.ts:101`](apps/web/src/hooks/use-chat-realtime.ts#L101): `.catch(() => {})` swallows errors; no retry or user notification. (#49)
- [ ] **Stray `console.log` calls** — 179 instances in production paths (`media-routes`, `discord-bridge-service`). (#51)
- [ ] **Unsafe type casts** — 39 `any` casts in control-plane + 15+ `as any` in web (e.g. [`voice-room.tsx:38`](apps/web/src/components/voice-room.tsx#L38) `grant as any`). (#52)

### Optimizations

- [ ] **Split `chat-window.tsx`** — 1,828 LOC with 11 `useEffect` + 7 `useMemo`. (#53)
- [ ] **Simplify URL sync** — [`chat-client.tsx:531-582`](apps/web/src/components/chat-client.tsx#L531-L582): 5 interconnected refs; brittle and re-render-prone. (#54)
- [ ] **Gate polling on SSE state** — [`use-chat-realtime.ts:102`](apps/web/src/hooks/use-chat-realtime.ts#L102): 3-second polling fallback can run alongside SSE on reconnect. (#49)
- [ ] **Add LRU/size cap to sticker cache** — currently unbounded disk growth. (#48)
- [ ] **Channel switch over-fetches metadata** — [`use-chat-initialization.ts:330`](apps/web/hooks/use-chat-initialization.ts#L330): `handleChannelChange` calls `refreshChatState(..., force=true)` to bypass the "already on this channel" early return at [line 151](apps/web/hooks/use-chat-initialization.ts#L151), but `force` is overloaded — it also invalidates `listServers`, `listViewerRoleBindings`, `listHubs`, `listChannels`, and `listCategories` ([lines 112-114](apps/web/hooks/use-chat-initialization.ts#L112-L114), [171-172](apps/web/hooks/use-chat-initialization.ts#L171-L172)), none of which change on an intra-server channel switch. Result: ~6 requests per switch instead of 1–2 (fetchChannelInit + markRead). Fix: split the flag — either add a `bypassEarlyReturn` parameter, or drop `force` from this path and tighten the early-return condition to compare requested vs current channel directly. (#55)

### Duplicate Code

- [ ] **MD5 hashing** — repeated in `media-routes`; extract to a shared util. (#56)
- [ ] **Media URL normalization** — [`chat-window.tsx:61-76`](apps/web/src/components/chat-window.tsx#L61-L76) (`normalizeMediaUrl()` / `getProxiedUrl()`) duplicates server-side logic in `media-routes`. (#56)
- [ ] **Discord permission checks** — duplicated between bridge service and bot client. (#56)
- [ ] **Reaction rendering** — duplicated across `chat-window` and `thread-panel`; extract a `<Reactions>` component. (#56)

### Missing Features

- [ ] **Report Triage UI** (Phase 20) — admins can't review reports. (#60)
- [ ] **Email notifications for @mentions** (Phase 21). (#59)
- [ ] **SEO metadata, PWA, custom domains** (Phase 24). (#63)
- [ ] **Discord OAuth UX polish** (Phase 25). (#69)
- [ ] **Loading state in `VoiceRoom`** — while fetching LiveKit token. (#50)
- [ ] **Debounce search modal** input. (#57)

### Industry-Standard Gaps

- [ ] **Message edit history** — show "edited" with a diff/timestamp on hover. (#77)
- [ ] **Pinned messages per channel** — with a "view all pins" drawer. (#78)
- [ ] **Slash commands** — beyond basic (`/shrug`, `/giphy`, custom webhooks, user-defined). (#86)
- [ ] **Scheduled messages** — compose now, send later. (#86)
- [ ] **Read receipts / last-read markers** — a "new messages" divider that persists across sessions. (#79)
- [ ] **Rich link unfurling** — OpenGraph previews with thumbnail, title, description. (#86)
- [ ] **Drafts per channel** — don't lose typed content when switching rooms. (#80)
- [ ] **Mute granularity** — 1h / 8h / 24h / until morning, not just on/off. (#86)
- [ ] **Do Not Disturb schedules** — status (away/busy/invisible) with auto-responses. (#86)
- [ ] **Code block syntax highlighting + copy button**. (#76)
- [ ] **Message forwarding** — across channels and DMs. (#86)
- [ ] **Native polls** — in messages (Discord/Slack both have them). (#86)
- [ ] **Voice messages** — record & send audio clips inline. (#86)
- [ ] **Screen sharing + server-side recording** — LiveKit already present; recording is a config away. (#86)
- [ ] **Accessibility audit** — keyboard-only navigation, ARIA on message list virtualization, reduced-motion for sticker animations, screen reader support for reactions. (#71)
- [ ] **Mobile web PWA with push notifications**. (#64)
- [ ] **2FA / passkeys** — WebAuthn support. (#73)
- [ ] **Session management UI** — "log out other devices". (#86)
- [ ] **Data export** — GDPR-compliant message download. (#75)
- [ ] **Bulk moderation tools** — select N messages; delete/move; timeout by pattern. (#74)
- [ ] **Audit log** — visible to admins. (#72)
- [ ] **Invite analytics** — track which invite link brought which users. (#86)

### Differentiators / Innovative Ideas

- [ ] **AI thread summaries** — "catch me up on the last 200 messages" using the existing Anthropic stack. (#87)
- [ ] **Semantic search** — embeddings-based, beats keyword-only search by a wide margin. (#87)
- [ ] **AI-assisted moderation** — auto-flag harassment/spam for the Report Triage UI. (#87)
- [ ] **Smart notifications** — learn which channels a user actually engages with; demote the rest. (#87)
- [ ] **Threaded voice rooms** — ephemeral breakout rooms spawned from a message. (#87)
- [ ] **Collaborative docs / whiteboard** — embedded in channels (Slack canvas-style). (#87)
- [ ] **Matrix / ActivityPub federation** — complement the existing Discord bridge. (#87)
- [ ] **Per-room custom CSS / themes** — for community identity. (#87)
- [ ] **"Lore" / pinned canon** — long-lived community knowledge surfaced to new joiners; auto-generated from popular pins + AI. (#87)
- [ ] **Creator monetization primitives** — paid channels, message tips, sticker-pack sales (extends Phase 24). (#87)
- [ ] **Voice room transcription + searchable archive** — huge for async communities. (#87)
- [ ] **Message "workflows"** — react with 📌 to auto-pin, 🗑️ to delete (admin), 🧵 to spin a thread; user-configurable. (#87)

---

## Test Suite Improvements

### Coverage Gaps

- [ ] **Performance budgets** — `chat-window.tsx` has no "render under N ms with 500 messages" guardrail. (#81)

### Quality-of-Life Upgrades

- [ ] **Standardize test names as sentences** — `"auth/session returns structured unauthorized error with correlation id"` is great; many others (e.g. [`extensions.test.ts`](apps/control-plane/src/test/extensions.test.ts)) are terse. Consistency helps when grepping failures. (#82)
- [ ] **Tag slow / serial tests** — add a convention like `{ concurrency: false }` for DB-touching tests so CI parallelism is explicit. (#82)
- [ ] **Add a JUnit / TAP reporter** — surface failures as CI annotations instead of tail-of-log hunts. (#82)
- [ ] **Expand [`api-snapshot.test.ts`](apps/control-plane/src/test/api-snapshot.test.ts)** — cover every route's response shape to prevent accidental breaking changes. (#83)
- [ ] **Add coverage tooling** — no `.nycrc` or `c8` config present; even a loose >60% threshold would highlight untested branches. (#84)
- [ ] **Seed-data factories** — replace scattered `insert into hubs...` SQL with `createHub()` / `createChannel()` / `createUser()` factories. (#85)
