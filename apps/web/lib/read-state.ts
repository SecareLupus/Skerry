interface MessageLike {
  id: string;
  authorUserId: string;
  createdAt: string;
}

/**
 * Returns the id of the first unread message — the one to render the
 * "new messages" divider above — or `null` if there is no divider to
 * show. Rules:
 *   - `lastReadAt` is the snapshot captured when the user opened the
 *     channel; messages strictly newer than it are unread.
 *   - Messages authored by the viewer themselves are skipped — we don't
 *     mark "new messages" above your own outgoing message.
 *   - Returns null if `lastReadAt` is missing (first-time open) or no
 *     message qualifies.
 */
export function firstUnreadMessageId(
  messages: ReadonlyArray<MessageLike>,
  lastReadAt: string | null,
  viewerUserId: string | null | undefined
): string | null {
  if (!lastReadAt) return null;
  const cutoff = new Date(lastReadAt).getTime();
  if (Number.isNaN(cutoff)) return null;
  for (const m of messages) {
    if (m.authorUserId === viewerUserId) continue;
    if (new Date(m.createdAt).getTime() > cutoff) return m.id;
  }
  return null;
}

/**
 * Returns the id of the latest message authored by the viewer that has
 * been read by the given peer (peer's `lastReadAt` >= message.createdAt).
 * Used to render the DM "Seen" indicator under the most recent outgoing
 * message the peer has caught up with. `null` means none of the
 * viewer's messages have been seen yet.
 */
export function latestSeenOwnMessageId(
  messages: ReadonlyArray<MessageLike>,
  peerLastReadAt: string | null | undefined,
  viewerUserId: string | null | undefined
): string | null {
  if (!peerLastReadAt || !viewerUserId) return null;
  const cutoff = new Date(peerLastReadAt).getTime();
  if (Number.isNaN(cutoff)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.authorUserId !== viewerUserId) continue;
    if (new Date(m.createdAt).getTime() <= cutoff) return m.id;
  }
  return null;
}
