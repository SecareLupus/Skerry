import type { ChatMessage } from "@skerry/shared";

type ChatEvent = "message.created" | "message.updated" | "message.deleted" | "typing.start" | "typing.stop" | "presence.update" | "voice.presence.update";
type ChatListener = (event: ChatEvent, payload: any) => void;

const channelListeners = new Map<string, Set<ChatListener>>();
const hubListeners = new Map<string, Set<ChatListener>>();

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

export function publishChannelMessage(message: ChatMessage, event: ChatEvent = "message.created"): void {
  // Notify channel subscribers
  const listeners = channelListeners.get(message.channelId);
  if (listeners) {
    for (const listener of listeners) {
      listener(event, message);
    }
  }

  // Also notify hub subscribers if we can find the hub context
  // This requires the message to carry hubId or we look it up.
  // For now, most messages flow through routes where we know the hubId or can find it via channel.
  // In domain-routes.ts, we'll need to pass hubId to publish functions or ensure it's in the message object.
}

export function publishHubEvent(hubId: string, event: ChatEvent, payload: any): void {
  const listeners = hubListeners.get(hubId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener(event, payload);
  }
}
