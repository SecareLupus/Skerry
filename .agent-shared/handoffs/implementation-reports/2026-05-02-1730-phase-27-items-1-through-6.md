# Phase 27: Items 1–6 — implementation report

**Author:** claude-code
**Date:** 2026-05-02
**Scope:** Re-apply BugFixesAndPolish fixes one-at-a-time on `Phase-27`.
**Status:** Items 1, 2, 3, 4, 5 landed and verified. Item 6 investigated;
no code change required (see below). Item 8 (styling drift) deferred to
next session.

## Commits (this session, on `Phase-27`)

| SHA | Item(s) | Summary |
| --- | --- | --- |
| `fe54478` | 1 | Theme toggle FOUC guard now runs only on first mount |
| `83db799` | 2 | `ModalManager` wrapped in `ChatHandlersProvider` |
| `d86c360` | 3+4 | `ADD_DM_CHANNEL` reducer + DM-list optimistic seed + channel-membership recovery |
| `dcd629b` | 5 | Discord reactions stored in tag form; `ReactionEmoji` renders CDN URL |

## What changed

**Item 1 — Theme toggle FOUC guard** ([apps/web/hooks/use-theme.ts](apps/web/hooks/use-theme.ts))
- Effect 2's FOUC guard now gated behind `useRef` so it only fires on
  initial mount; subsequent toggles always apply the new theme.
- Effect 1 dropped `theme` from its deps; it's an external→reducer
  mirror, not the reverse.

**Item 2 — DM picker modal crash** ([apps/web/components/chat-client.tsx](apps/web/components/chat-client.tsx))
- Wrapped `<ModalManager />` in `<ChatHandlersProvider value={…}>` so
  modal-rendered components can call `useChatHandlers()` without
  throwing the missing-context error.

**Item 3 — DM list refresh** ([apps/web/context/chat-context.tsx](apps/web/context/chat-context.tsx), [apps/web/components/dm-picker-modal.tsx](apps/web/components/dm-picker-modal.tsx))
- New `ADD_DM_CHANNEL` action prepends/dedupes into `allDmChannels`
  and conditionally into `state.channels` (when DM server is active).
- Exported `chatReducer` and `initialState` for testability.
- `DMPickerModal` dispatches `ADD_DM_CHANNEL` immediately on creation,
  before navigation kicks off.

**Item 4 — DM routing recovery** ([apps/web/hooks/use-chat-initialization.ts](apps/web/hooks/use-chat-initialization.ts))
- Channel-membership validator falls back to `state.allDmChannels`
  before resetting to default. `state.allDmChannels` added to
  `refreshChatState` deps.

**Item 5 — Custom emoji reactions render as images**
([apps/control-plane/src/services/discord-bot-client.ts](apps/control-plane/src/services/discord-bot-client.ts), [apps/web/components/chat-window.tsx](apps/web/components/chat-window.tsx))
- New `encodeDiscordReactionEmoji({id,name,animated})` produces
  `<:name:id>` / `<a:name:id>` for custom; passes through Unicode.
  Used in both reaction-add and reaction-remove handlers.
- `ReactionEmoji` component on the frontend parses the tag and renders
  `cdn.discordapp.com/emojis/<id>.<webp|gif>`.

## Tests

Unit suite (node:test, on localhost):
- `apps/web/test/chat-context-reducer.test.ts` — 4 reducer cases for
  `ADD_DM_CHANNEL` (Items 3+4).
- `apps/control-plane/src/test/discord-reaction-emoji.test.ts` — 5
  cases for `encodeDiscordReactionEmoji` (Item 5).

E2E (Playwright, `apps/web/e2e/ui-regressions.spec.ts`):
- `Bug 1: theme toggle flips data-theme and persists on a second toggle`.
- `Bug 5: "New Message" button opens the DM picker without a context error`.

Final localhost results:
- Unit: 146/146 (shared 16, web 9, control-plane 121).
- E2E: 29/29 on the post-Item-5 build.
- One unrelated flake in the post-Items-3+4 build:
  `messaging.spec.ts:145 social: reactions and threaded replies`
  (recovered on retry; does not touch DM creation paths).

No new E2E was added for the DM creation flow itself — would need a
two-user fixture (memberB invite). Reducer tests cover the state-shape
regression; manual smoke covers routing.

## Item 6 — emoji backfill investigation (no code change)

**Query** (against pangolin / `escapehatch-postgres-1`):

```sql
SELECT (emoji LIKE '<%') AS tagged, count(*) FROM message_reactions GROUP BY tagged;
-- f: 48, t: 4

SELECT emoji, count(*) FROM message_reactions
 WHERE emoji NOT LIKE '<%'
 GROUP BY emoji ORDER BY count(*) DESC;
-- 23 distinct rows: 22 Unicode emoji (🖤, 🤘, ❤️, 🥳, etc.), plus
-- one custom name `zombieTwerk` with 3 rows.
```

**Bucketing** of the unbackfilled rows:

| Bucket | Count | What it means |
| --- | --- | --- |
| (a) Unicode pass-through (correct) | 45 rows / 22 names | Migration intentionally leaves these — Item 5's `ReactionEmoji` renders Unicode as plain `<span>`. |
| (b) Custom name not in `discord_seen_emojis` | 3 rows / 1 name (`zombieTwerk`) | The bot never seeded this emoji into the seen-emojis table, so the migration's join produced no row to write. |
| (c) Same name across multiple snowflakes | 0 | None observed in current data. |
| (d) Unique-constraint collision | 0 | None observed. |

**Conclusion:** the partial-backfill behavior is mostly correct
(Unicode is supposed to stay raw). The only real gap is
`zombieTwerk`, which is one custom emoji name that the bot never
ingested into `discord_seen_emojis`. With only 3 affected rows and a
single name, the cost-benefit doesn't justify a structural fix
(extending the seed logic or doing on-demand REST lookups during
backfill). Practical remediations, in order of effort:

1. **Manual one-shot backfill** — if the project's Discord guild
   contains `zombieTwerk`, look up its snowflake and `UPDATE
   message_reactions SET emoji = '<:zombieTwerk:<id>>' WHERE emoji =
   'zombieTwerk'`. Lowest effort.
2. **Extend bot seeding** — when the bot processes a reaction event
   whose emoji has an ID, upsert into `discord_seen_emojis` even if it
   wasn't observed in a message body first. Catches future cases but
   doesn't help historical rows.
3. **On-demand REST fallback during backfill** — query Discord's
   application-emojis endpoint for each unmatched name and write the
   tag form. Most thorough but most code.

Recommend (1) for the existing 3 rows + (2) as a small follow-up so
the gap doesn't recur. Both are out of scope for Phase 27 unless the
user wants them now.

## Verification

All commands run on localhost (development machine; see `.agent-shared/CONTEXT.md`):
- `pnpm test` — 146/146 passing.
- `pnpm test:env:up && pnpm test:e2e` — 29/29 passing on the final build.

Pangolin (testing machine) was used read-only for the Item 6 SQL
investigation; nothing was written.

## Open issues / follow-ups

- **Item 8 (styling drift)** — not yet investigated. Needs a side-by-
  side comparison of DM picker / reaction buttons against `main` to
  decide whether to cherry-pick the token + class additions from
  `53c5ea7`/`fe015e9`. May be a no-op.
- **Item 7 (Skerry-side mirror)** — remains deferred per `TODO.md`.
- **Reactions test flake** in `messaging.spec.ts:145` — recovered on
  retry but worth a closer look if it recurs.
- **Item 6 follow-up (optional)** — remediation (1) and/or (2) above.
