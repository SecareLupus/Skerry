import type { ChatMessage } from "@skerry/shared";

type ChatEvent = "message.created" | "message.updated" | "message.deleted" | "typing.start" | "typing.stop" | "presence.update" | "voice.presence.update";
type ChatListener = (event: ChatEvent, payload: any) => void;

const channelListeners = new Map<string, Set<ChatListener>>();
const hubListeners = new Map<string, Set<ChatListener>>();

// Cache for mapping channelId -> hubId to avoid constant DB lookups
const channelToHubCache = new Map<string, string>();

export function subscribeToChannelMessages(channelId: string, listener: ChatListener): () => void {
  const listeners = channelListeners.get(channelId) ?? new Set<ChatListener>();
  listeners.add(listener);
  channelListeners.set(channelId, listeners);

  return () => {
    const existing = channelListeners.get(channelId);
    if (!existing) return;
    existing.delete(listener);
    if (existing.size === 0) {
      channelListeners.delete(channelId);
    }
  };
}

/**
 * Manually populate or refresh the channel-to-hub mapping cache.
 * Useful when we already have the hub context in a route handler.
 */
export function warmChannelHubCache(channelId: string, hubId: string): void {
  channelToHubCache.set(channelId, hubId);
}

export function subscribeToHubEvents(hubId: string, listener: ChatListener): () => void {
  const listeners = hubListeners.get(hubId) ?? new Set<ChatListener>();
  listeners.add(listener);
  hubListeners.set(hubId, listeners);

  return () => {
    const existing = hubListeners.get(hubId);
    if (!existing) return;
    existing.delete(listener);
    if (existing.size === 0) {
      hubListeners.delete(hubId);
    }
  };
}

export async function publishChannelMessage(message: ChatMessage, event: ChatEvent = "message.created"): Promise<void> {
  // Notify channel subscribers
  const listeners = channelListeners.get(message.channelId);
  if (listeners) {
    for (const listener of listeners) {
      listener(event, message);
    }
  }

  // Also notify hub subscribers.
  // We need to know which hub this channel belongs to.
  let hubId = channelToHubCache.get(message.channelId);

  if (!hubId) {
    // If not in cache, we must perform a lookup.
    // We import withDb lazily to avoid circular dependencies if any, though it should be fine here.
    const { withDb } = await import("../db/client.js");
    hubId = await withDb(async (db) => {
      const row = await db.query<{ hub_id: string }>(
        "select s.hub_id from channels c join servers s on s.id = c.server_id where c.id = $1",
        [message.channelId]
      );
      return row.rows[0]?.hub_id;
    });

    if (hubId) {
      channelToHubCache.set(message.channelId, hubId);
    }
  }

  if (hubId) {
    publishHubEvent(hubId, event, message);
  }
}

export function publishHubEvent(hubId: string, event: ChatEvent, payload: any): void {
  const listeners = hubListeners.get(hubId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener(event, payload);
  }
}
