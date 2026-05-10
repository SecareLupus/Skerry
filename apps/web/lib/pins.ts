interface PinnedMessageLike {
  id: string;
  isPinned?: boolean;
  createdAt: string;
}

/**
 * Apply a single message update (pin / unpin / edit) to the in-memory pin
 * list, keeping it sorted newest-first. Pure so the drawer stays in sync
 * with optimistic local updates and incoming `message.updated` SSE events
 * without a server round-trip.
 *
 * - If the update marks the message pinned and it's not already in the
 *   list, insert it in createdAt-descending position.
 * - If it marks the message unpinned (or omitted from `isPinned`), remove
 *   any matching entry.
 * - If it's already in the list and still pinned, replace the entry in
 *   place (e.g. a content edit on a pinned message).
 */
export function applyPinUpdate<T extends PinnedMessageLike>(pins: ReadonlyArray<T>, update: T): T[] {
  const without = pins.filter((p) => p.id !== update.id);
  if (!update.isPinned) return without;
  const updateTime = new Date(update.createdAt).getTime();
  const insertIdx = without.findIndex((p) => new Date(p.createdAt).getTime() < updateTime);
  if (insertIdx === -1) return [...without, update];
  return [...without.slice(0, insertIdx), update, ...without.slice(insertIdx)];
}
