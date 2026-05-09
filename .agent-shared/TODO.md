# Skerry Active Tasks

## Current Goal: Sprint 3
Land all Sprint 3 issues from GitHub Project #2. **One PR per
isolated issue; closely coupled issues may be batched.**

## Tasks
- [ ] **Issue #80**: Drafts per channel — preserve typed content
  across channel switches. localStorage-backed; restore on mount,
  clear on send. Frontend-only.
- [ ] **Issues #42 + #43** (batched — shared autocomplete popover):
    - **#42**: `@-mention` autocomplete using channel-member display
      names.
    - **#43**: `:emoji:` autocomplete by emoji name.
- [ ] **Issue #79**: Read receipts / persistent last-read divider.
  Per-(user, channel) `last_read_message_id` (verify existing
  unread-badge schema first); sticky divider in message list;
  update on unfocus / explicit mark-read / scroll-to-bottom.
- [ ] **Issue #78**: Pinned messages drawer. Side drawer scoped to
  channel, newest-first, click-through to source. Backend pin
  functionality already exists (Phase 15).
- [ ] **Issue #44**: Restyle small square buttons. Common design
  language for emoji-icon buttons. Sequenced late so it can absorb
  any new buttons added by earlier issues.
- [ ] **Issue #77**: Message edit history with diff/timestamp on
  hover. Schema migration for revision rows, fetch endpoint, diff
  popover, retention policy. Heaviest — last in sprint.

## Open Questions
- **#44 design language**: confirm the target style with the user
  before cutting the PR (icon set, border-radius, hover states).
- **#77 retention policy**: keep all revisions, or cap (e.g. last 5)?
  Decide before the schema migration.

---
*For historical notes and completed sprint logs, see [ARCHIVE.md](./ARCHIVE.md).*
