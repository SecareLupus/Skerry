---
date: 2026-05-03 22:30
agent: claude-code
issues: [35, 40, 41, 45]
branch: fix/sprint-1-dm-reactivity
sprint: Sprint 1 Lane C (MVP)
verification_machine: localhost (development)
---

# Sprint 1 Lane C — DM reactivity, notifications, leave-DM

Reported symptoms (default-assumed pangolin per `.agent-shared/CONTEXT.md`,
not directly verified there):

- **#35** Creating a DM didn't repaint the sidebar — required a refresh.
- **#40** Receiving a DM didn't update the recipient's UI or notify them.
- **#41** No in-app notification surface for unread DMs / @-mentions.
- **#45** Only the DM creator could "delete" the DM; non-creators were stuck.

## Root causes

#35 was already largely addressed in Phase 27 by the `ADD_DM_CHANNEL`
reducer that prepends to `state.allDmChannels` (the source for the sidebar
DM list) and to `state.channels` when the DM server is active. The
remaining gap was that recipients (#40) only learned about a new DM via
the 60-second poll in `use-dms.ts`, because the backend never published a
`channel.created` event when a DM was first opened.

#40 had a second gap: even with reactivity, there was no notification
surface. Document-hidden Web Notifications fire for any new message, but
when the tab is foregrounded there was no visible queue of pending DMs
or @-mentions outside the sidebar's per-channel pill, which is hidden
behind the "back to servers" view.

#45 was a missing endpoint. `getOrCreateDMChannel` happily added members,
but there was no DELETE route to remove a single member from a DM. The
server-level `deleteChannel` only worked for owners, and DMs aren't
"owned" in the same sense as text channels.

## Files changed

### Backend (control-plane)

- `services/chat-realtime.ts` — extended `ChatEvent` type with the
  `channel.*`, `category.*`, and new `dm.left` events that the web
  client already listens for at runtime.
- `services/chat/channel-service.ts`
  - `getOrCreateDMChannel` now publishes `channel.created` to the hub
    when a DM channel is first created (not on the idempotent rehit).
  - New `leaveDmChannel(channelId, productUserId)`: removes the user
    from `channel_members`, kicks them from the underlying Matrix room
    if one exists, and tears down the channel + chat history when the
    last member leaves. Publishes `dm.left` for the leaver and
    `channel.deleted` when the channel is torn down.
- `routes/channel-routes.ts` — `DELETE /v1/channels/:channelId/members/me`
  wraps `leaveDmChannel`. Maps "Channel not found" / "Not a member" to
  404 and "not a DM" to 400 so non-DM channels can't be silently left.

### Frontend (web)

- `lib/control-plane.ts` — `leaveDmChannel(channelId)` client.
- `context/chat-context.tsx`
  - New `REMOVE_DM_CHANNEL` action: drops the channel from
    `allDmChannels` *and* `channels`, clears `selectedChannelId` /
    `activeChannelData` / `messages` if it was selected, otherwise
    leaves selection alone.
- `hooks/use-chat-realtime.ts`
  - `channel.created` now branches: DM with viewer in `participants`
    → `ADD_DM_CHANNEL` + notification-summary refresh; otherwise the
    pre-existing `UPSERT_CHANNEL` path.
  - New `dm.left` handler: triggers `REMOVE_DM_CHANNEL` only when the
    leaver is the viewer (other participants stay).
  - `channel.deleted` now also calls `REMOVE_DM_CHANNEL` so DM teardown
    propagates regardless of which server the viewer is currently on.
- `components/sidebar.tsx` — DM rows get a context menu with **Leave
  Conversation**, gated through the existing `confirmation` modal.
- `components/notifications-panel.tsx` (new) — bell icon in the topbar
  with a dropdown listing channels with mentions and DMs with unread,
  honoring the existing mute state. Clicking an item navigates via
  `handleServerChange(serverId, channelId)`.
- `components/layout/ClientTopbar.tsx` — embeds `NotificationsPanel`
  next to the search/settings icons.
- `components/chat-client.tsx` — `ChatHandlersProvider` now wraps the
  full main return (previously only `ModalManager`), so the
  topbar-embedded `NotificationsPanel` can call `handleServerChange`.

## Tests

- `apps/control-plane/src/test/dm-messaging.test.ts`
  - `non-creator can leave a DM and creator's view persists` — covers
    the multi-step lifecycle (leave → other member sees DM gone, creator
    sees it kept; final leave deletes; second leave 404s).
  - `leave-DM endpoint refuses non-DM channels` — guard for the 400
    branch.
- `apps/web/test/chat-context-reducer.test.ts`
  - `REMOVE_DM_CHANNEL drops the entry and clears active chat when
    selected`
  - `REMOVE_DM_CHANNEL leaves selection alone when a different DM is
    removed`
- `apps/web/e2e/dm-lifecycle.spec.ts` (new) — admin invites bob, opens
  a DM with him, both sidebars update live (no refresh), the bell shows
  the panel, bob right-clicks the DM and chooses Leave Conversation,
  the DM disappears from bob's sidebar while admin still sees it.

Failing-then-passing evidence: the new reducer tests (added before the
reducer changes) and the dm-messaging leave tests (added before the
service/route) failed exactly as predicted with `not a function` /
`404` until the implementations landed. The E2E was authored after the
implementation but caught one real defect — `useChatHandlers must be
used within a ChatHandlersProvider` from the topbar, which forced the
provider-broadening fix in `chat-client.tsx`.

### Suite results on localhost

- `pnpm --filter @skerry/web test` — 11/11 pass (was 9/9 baseline +2).
- `pnpm --filter @skerry/control-plane test` — 123/123 pass
  (was 121/121 baseline +2).
- `pnpm --filter @skerry/shared test` — 16/16 pass (unchanged).
- `pnpm --filter @skerry/web exec playwright test` — 33/33 pass.
- `pnpm typecheck` — clean.
- `pnpm lint` — clean modulo pre-existing unrelated warnings.

## Open issues / follow-ups

- Hub-level SSE leakage (pre-existing, not introduced here): the hub
  stream broadcasts message and channel events to every subscriber in
  the hub regardless of DM-membership. The frontend filters in
  `use-chat-realtime` (only acts on DMs the viewer participates in),
  but a curious client could read other users' DMs off the wire. The
  proper fix is per-user fan-out at the SSE layer; tracked separately
  per the user's "MVP scope" note — call it out in the next sprint.
- `channel.created` payload includes the full `participants` list with
  display names. That's necessary for the frontend's "am I in this DM?"
  check, but it does mean the same hub-stream listeners not in the DM
  see the participant list. Tightening this depends on the per-user
  fan-out above.
- `kickUser` for Matrix room cleanup on leave is best-effort (logged
  on failure). For pre-MVP this is acceptable; the channel-side state
  is the source of truth.
- Two-person DMs: leaving from one side doesn't tell the other side
  "they left." That's deliberate (Discord-style), but a future polish
  could add a system message when membership changes.

## Verification

Verification ran on localhost (development machine), the test stack
rebuilt with `pnpm test:env:up` after each backend change. Pangolin not
directly exercised — the failing-then-passing E2E on the locally rebuilt
stack is the regression evidence.
