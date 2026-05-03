"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { useChat, useChatHandlers } from "../context/chat-context";
import { getChannelName } from "../lib/channel-utils";

interface NotificationItem {
    channelId: string;
    serverId: string;
    label: string;
    kind: "dm" | "mention" | "unread";
    count: number;
}

export function NotificationsPanel() {
    const { state, dispatch } = useChat();
    const { handleServerChange } = useChatHandlers();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);

    const items = useMemo<NotificationItem[]>(() => {
        const result: NotificationItem[] = [];
        const dmIds = new Set(state.allDmChannels.map((c) => c.id));

        for (const dm of state.allDmChannels) {
            const unread = state.unreadCountByChannel[dm.id] ?? 0;
            const mentions = state.mentionCountByChannel[dm.id] ?? 0;
            if (unread === 0 && mentions === 0) continue;
            if (state.muteStatusByChannel[dm.id]) continue;
            result.push({
                channelId: dm.id,
                serverId: dm.serverId,
                label: getChannelName(dm, state.viewer?.productUserId),
                kind: "dm",
                count: mentions || unread
            });
        }

        for (const [channelId, mentions] of Object.entries(state.mentionCountByChannel)) {
            if (mentions <= 0) continue;
            if (dmIds.has(channelId)) continue;
            if (state.muteStatusByChannel[channelId]) continue;
            const channel = state.channels.find((c) => c.id === channelId);
            if (!channel) continue;
            result.push({
                channelId,
                serverId: channel.serverId,
                label: getChannelName(channel, state.viewer?.productUserId),
                kind: "mention",
                count: mentions
            });
        }

        return result;
    }, [
        state.allDmChannels,
        state.channels,
        state.unreadCountByChannel,
        state.mentionCountByChannel,
        state.muteStatusByChannel,
        state.viewer?.productUserId
    ]);

    const totalCount = items.reduce((sum, n) => sum + n.count, 0);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [open]);

    const handleSelect = async (item: NotificationItem) => {
        setOpen(false);
        await handleServerChange(item.serverId, item.channelId);
    };

    return (
        <div className="notifications-anchor" ref={ref}>
            <button
                type="button"
                className="icon-button"
                aria-label="Notifications"
                aria-expanded={open}
                title={totalCount > 0 ? `${totalCount} unread notification${totalCount === 1 ? "" : "s"}` : "Notifications"}
                onClick={() => setOpen((v) => !v)}
                data-testid="notifications-bell"
            >
                <span className="bell-glyph">🔔</span>
                {totalCount > 0 && <span className="notif-badge" data-testid="notifications-badge">{totalCount > 99 ? "99+" : totalCount}</span>}
            </button>

            {open && (
                <div className="notifications-panel" role="dialog" aria-label="Notifications" data-testid="notifications-panel">
                    <header className="notifications-header">
                        <h3>Notifications</h3>
                        <button type="button" className="close-button" aria-label="Close notifications" onClick={() => setOpen(false)}>×</button>
                    </header>
                    {items.length === 0 ? (
                        <p className="notifications-empty">You&apos;re all caught up.</p>
                    ) : (
                        <ul className="notifications-list">
                            {items.map((item) => (
                                <li key={item.channelId}>
                                    <button
                                        type="button"
                                        className="notif-item"
                                        onClick={() => handleSelect(item)}
                                    >
                                        <span className={`notif-kind notif-kind-${item.kind}`}>
                                            {item.kind === "dm" ? "💬" : item.kind === "mention" ? "@" : "•"}
                                        </span>
                                        <span className="notif-label">{item.label}</span>
                                        <span className="notif-count">{item.count}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <style jsx>{`
                .notifications-anchor {
                    position: relative;
                    display: inline-flex;
                }
                .bell-glyph {
                    font-size: 1rem;
                }
                .notif-badge {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: var(--danger);
                    color: white;
                    font-size: 0.65rem;
                    font-weight: 700;
                    padding: 2px 5px;
                    border-radius: 10px;
                    min-width: 16px;
                    text-align: center;
                    line-height: 1;
                }
                .notifications-panel {
                    position: absolute;
                    top: calc(100% + 6px);
                    right: 0;
                    width: 320px;
                    max-height: 60vh;
                    overflow-y: auto;
                    background: var(--surface);
                    color: var(--text);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
                    z-index: 4000;
                }
                .notifications-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--border);
                }
                .notifications-header h3 {
                    margin: 0;
                    font-size: 0.95rem;
                }
                .close-button {
                    background: transparent;
                    border: 0;
                    color: var(--text-muted);
                    font-size: 1.25rem;
                    cursor: pointer;
                    padding: 0 0.25rem;
                }
                .notifications-empty {
                    padding: 1.5rem 1rem;
                    text-align: center;
                    color: var(--text-muted);
                    font-size: 0.875rem;
                }
                .notifications-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .notif-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    width: 100%;
                    padding: 0.6rem 1rem;
                    background: transparent;
                    border: 0;
                    color: var(--text);
                    cursor: pointer;
                    text-align: left;
                    font-size: 0.875rem;
                }
                .notif-item:hover {
                    background: var(--surface-alt);
                }
                .notif-kind {
                    width: 22px;
                    text-align: center;
                    color: var(--text-muted);
                }
                .notif-kind-mention {
                    color: var(--accent);
                    font-weight: 700;
                }
                .notif-label {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .notif-count {
                    background: var(--accent-soft, var(--surface-alt));
                    color: var(--text);
                    border-radius: 10px;
                    padding: 2px 8px;
                    font-size: 0.75rem;
                    font-weight: 600;
                }
            `}</style>
        </div>
    );
}
