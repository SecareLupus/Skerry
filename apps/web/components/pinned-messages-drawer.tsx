"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@skerry/shared";
import { listPins } from "../lib/control-plane";
import { applyPinUpdate } from "../lib/pins";
import { useChat } from "../context/chat-context";
import { formatMessageTime } from "../lib/control-plane";

interface Props {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

export function PinnedMessagesDrawer({ channelId, channelName, onClose, onJumpToMessage }: Props) {
  const { state } = useChat();
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastPinStateRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listPins(channelId)
      .then((items) => {
        if (cancelled) return;
        setPins(items);
        const initial = new Map<string, boolean>();
        for (const m of items) initial.set(m.id, true);
        lastPinStateRef.current = initial;
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load pinned messages.");
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  // Keep the list in sync with optimistic local pin/unpin events. We watch
  // `state.messages` for entries whose `isPinned` flipped since the last
  // tick and feed them through the same merge that handles the SSE path.
  useEffect(() => {
    let next = pins;
    for (const m of state.messages) {
      if (m.channelId !== channelId) continue;
      const prevPinned = lastPinStateRef.current.get(m.id);
      const currentPinned = !!m.isPinned;
      if (prevPinned !== currentPinned) {
        next = applyPinUpdate(next, m);
        lastPinStateRef.current.set(m.id, currentPinned);
      }
    }
    if (next !== pins) setPins(next);
  }, [state.messages, channelId, pins]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="pinned-backdrop"
        onClick={onClose}
        data-testid="pinned-drawer-backdrop"
      />

      {/* Drawer */}
      <aside
        className="pinned-drawer"
        aria-label={`Pinned messages in ${channelName}`}
        data-testid="pinned-messages-drawer"
      >
        <header className="pinned-drawer__header">
          <h2>📌 Pinned in #{channelName}</h2>
          <button
            type="button"
            className="pinned-drawer__close"
            onClick={onClose}
            aria-label="Close pinned messages"
          >
            ✕
          </button>
        </header>

        {isLoading && <p className="pinned-drawer__status">Loading…</p>}
        {error && <p className="pinned-drawer__status pinned-drawer__status--error">{error}</p>}
        {!isLoading && !error && pins.length === 0 && (
          <p className="pinned-drawer__status">No messages pinned in this channel yet.</p>
        )}

        <ul className="pinned-drawer__list">
          {pins.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="pinned-drawer__item"
                onClick={() => onJumpToMessage(m.id)}
                data-testid="pinned-message-item"
              >
                <div className="pinned-drawer__item-header">
                  <strong>{m.externalAuthorName ?? m.authorDisplayName}</strong>
                  <time dateTime={m.createdAt}>{formatMessageTime(m.createdAt)}</time>
                </div>
                <p className="pinned-drawer__item-content">{m.content}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
