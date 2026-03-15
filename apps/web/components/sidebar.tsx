"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useChat, ModalType } from "../context/chat-context";
import { Channel, Server } from "@skerry/shared";
import { getChannelName } from "../lib/channel-utils";
import { ContextMenu, ContextMenuItem } from "./context-menu";
import { upsertChannelReadState, joinServer } from "../lib/control-plane";

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" ");

interface SidebarProps {
    handleServerChange: (serverId: string, channelId?: string) => Promise<void>;
    handleChannelChange: (channelId: string) => Promise<void>;
    handleServerKeyboardNavigation: (event: React.KeyboardEvent, serverId: string) => void;
    handleChannelKeyboardNavigation: (event: React.KeyboardEvent, channelId: string) => void;
    performDeleteSpace: (serverId: string) => Promise<void>;
    performDeleteRoom: (serverId: string, channelId: string) => Promise<void>;
}

export function Sidebar({
    handleServerChange,
    handleChannelChange,
    handleServerKeyboardNavigation,
    handleChannelKeyboardNavigation,
    performDeleteSpace,
    performDeleteRoom
}: SidebarProps) {
    const { state, dispatch } = useChat();
    const {
        viewerRoles,
        servers,
        channels,
        categories,
        selectedServerId,
        selectedChannelId,
        channelFilter,
        isAddMenuOpen,
        messages,
        lastReadByChannel,
        mentionCountByChannel,
        blockedUserIds,
        viewer
    } = state;

    const defaultServers = useMemo(() => servers.filter(s => s.type !== 'dm'), [servers]);
    const dmServer = useMemo(() => servers.find(s => s.type === 'dm'), [servers]);

    const canManageHub = useMemo(
        () => viewerRoles.some((binding) => binding.role === "hub_admin" && (binding.serverId === null || binding.serverId === "" || !binding.serverId)),
        [viewerRoles]
    );

    const canManageCurrentSpace = useMemo(
        () =>
            viewerRoles.some(
                (binding) =>
                    (binding.role === "hub_admin" || binding.role === "space_owner") &&
                    (binding.serverId === selectedServerId || !binding.serverId || binding.serverId === "")
            ),
        [viewerRoles, selectedServerId]
    );

    const unreadCountByChannel = state.unreadCountByChannel;

    const filteredChannels = useMemo(() => {
        const term = channelFilter.trim().toLowerCase();
        if (!term) return channels;
        return channels.filter((channel) => channel.name.toLowerCase().includes(term));
    }, [channels, channelFilter]);

    const groupedChannels = useMemo(() => {
        const byCategory = new Map<string | null, Channel[]>();
        for (const channel of filteredChannels) {
            const key = channel.categoryId ?? null;
            const bucket = byCategory.get(key) ?? [];
            bucket.push(channel);
            byCategory.set(key, bucket);
        }

        const groups: Array<{ id: string | null; name: string; channels: Channel[] }> = [];
        const uncategorized = byCategory.get(null) ?? [];
        if (uncategorized.length > 0 || canManageCurrentSpace) {
            groups.push({ id: null, name: "", channels: uncategorized });
        }

        for (const category of categories) {
            const channelsForCategory = byCategory.get(category.id) ?? [];
            groups.push({
                id: category.id,
                name: category.name,
                channels: channelsForCategory
            });
        }

        return groups;
    }, [categories, filteredChannels, canManageCurrentSpace]);

    const [view, setView] = React.useState<"servers" | "channels">(selectedServerId ? "channels" : "servers");

    // Sync view with selectedServerId if it changes externally
    React.useEffect(() => {
        if (selectedServerId) {
            setView("channels");
        }
    }, [selectedServerId]);

    const activeServer = useMemo(() => servers.find(s => s.id === selectedServerId), [servers, selectedServerId]);
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number, items: ContextMenuItem[] } | null>(null);

    const updateChannelPreference = async (channelId: string, preference: 'all' | 'mentions' | 'none', isMuted?: boolean) => {
        try {
            await upsertChannelReadState(channelId, { notificationPreference: preference, isMuted: isMuted });
            dispatch({ 
                type: "SET_NOTIFICATION_PREFERENCE", 
                payload: { 
                    channelId, 
                    preference, 
                    isMuted: isMuted ?? !!state.muteStatusByChannel[channelId] 
                } 
            });
        } catch (err) {
            console.error("Failed to update channel preference", err);
        }
    };

    const handleChannelContextMenu = (e: React.MouseEvent, channel: Channel) => {
        e.preventDefault();
        const currentPref = state.notificationPreferenceByChannel[channel.id] || 'all';
        const isMuted = !!state.muteStatusByChannel[channel.id];

        const items: ContextMenuItem[] = [
            {
                label: "Notification Settings",
                type: "header"
            },
            {
                type: "separator"
            },
            {
                label: "All Messages",
                onClick: () => updateChannelPreference(channel.id, 'all', false),
                icon: (currentPref === 'all' && !isMuted) ? "✓" : ""
            },
            {
                label: "Mentions Only",
                onClick: () => updateChannelPreference(channel.id, 'mentions', false),
                icon: (currentPref === 'mentions' && !isMuted) ? "✓" : ""
            },
            {
                label: "Muted",
                onClick: () => updateChannelPreference(channel.id, 'none', true),
                icon: isMuted ? "✓" : ""
            }
        ];
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    };

    const handleServerContextMenu = (e: React.MouseEvent, server: Server) => {
        e.preventDefault();
        const serverChannels = channels.filter(c => c.serverId === server.id);
        const items: ContextMenuItem[] = [
            {
                label: "Mute All Channels",
                onClick: () => {
                    serverChannels.forEach(c => updateChannelPreference(c.id, 'none', true));
                }
            },
            {
                label: "Unmute All Channels",
                onClick: () => {
                    serverChannels.forEach(c => updateChannelPreference(c.id, 'all', false));
                }
            }
        ];
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    };


    return (
        <aside className="unified-sidebar panel">
            {view === "servers" ? (
                <nav className="servers" aria-label="Servers">
                    <div className="category-header">
                        <h2>Servers</h2>
                        <div style={{ display: "flex", gap: "4px" }}>
                            {canManageHub && (
                                <>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-label="Masquerade"
                                        title="Masquerade as Role"
                                        onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "masquerade" })}
                                    >
                                        🎭
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-label="Create Space"
                                        onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "create-space" })}
                                    >
                                        +
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <ul>
                        {defaultServers.map((server) => (
                            <li key={server.id}>
                                <div className="list-item-container">
                                    <button
                                        type="button"
                                        className={cn(
                                            "list-item server-entry",
                                            selectedServerId === server.id && "active",
                                            channels.filter(c => c.serverId === server.id).some(c => (unreadCountByChannel[c.id] ?? 0) > 0) && "unread"
                                        )}
                                        aria-current={selectedServerId === server.id ? "true" : undefined}
                                        onClick={() => {
                                            void handleServerChange(server.id);
                                            setView("channels");
                                        }}
                                        onKeyDown={(event) => {
                                            handleServerKeyboardNavigation(event, server.id);
                                        }}
                                        onContextMenu={(e) => handleServerContextMenu(e, server)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                            <span className="server-icon-placeholder">
                                                {(server as any).iconUrl ? (
                                                    <img src={(server as any).iconUrl} alt="" className="server-icon-image" />
                                                ) : (
                                                    server.name.charAt(0).toUpperCase()
                                                )}
                                            </span>
                                            {server.name}
                                        </div>
                                        {(() => {
                                            const hubMentionCount = channels
                                                .filter(c => c.serverId === server.id && !state.muteStatusByChannel[c.id])
                                                .reduce((sum, c) => sum + (mentionCountByChannel[c.id] ?? 0), 0);
                                            return hubMentionCount > 0 ? (
                                                <span className="mention-pill">@{hubMentionCount}</span>
                                            ) : null;
                                        })()}
                                        {canManageCurrentSpace && selectedServerId === server.id && (
                                            <div className="inline-mgmt persistent">
                                                <button
                                                    type="button"
                                                    className="icon-button"
                                                    title="Edit Server"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        dispatch({ type: "SET_RENAME_SPACE", payload: { id: server.id, name: server.name, iconUrl: (server as any).iconUrl } });
                                                        dispatch({ type: "SET_ACTIVE_MODAL", payload: "rename-space" });
                                                    }}
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-button danger"
                                                    title="Delete Server"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`Are you sure you want to delete "${server.name}"? This cannot be undone.`)) {
                                                            dispatch({ type: "SET_ERROR", payload: null });
                                                            void performDeleteSpace(server.id);
                                                        }
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        )}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>

                    <div className="category-header" style={{ marginTop: '1.5rem' }}>
                        <h2>Direct Messages</h2>
                        <button
                            type="button"
                            className="icon-button"
                            aria-label="New Message"
                            onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "dm-picker" })}
                        >
                            +
                        </button>
                    </div>

                    <ul>
                        {state.allDmChannels?.map((dm) => (
                            <li key={dm.id}>
                                <div className="list-item-container">
                                    <button
                                        type="button"
                                        className={cn(
                                            "list-item server-entry",
                                            selectedChannelId === dm.id && "active",
                                            (unreadCountByChannel[dm.id] ?? 0) > 0 && "unread"
                                        )}
                                        onClick={() => {
                                            if (dmServer) {
                                                void handleServerChange(dmServer.id, dm.id);
                                                setView("channels");
                                            }
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, fontSize: '0.9em', overflow: 'hidden' }}>
                                            <span className="server-icon-placeholder" style={{ width: '24px', height: '24px', fontSize: '12px', minWidth: '24px' }}>
                                                {(dm.participants?.[0] as any)?.avatarUrl ? (
                                                    <img src={(dm.participants![0] as any).avatarUrl} alt="" className="server-icon-image" />
                                                ) : "💬"}
                                            </span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {getChannelName(dm, viewer?.productUserId)}
                                            </span>
                                        </div>
                                        {(() => {
                                            const dmntionCount = mentionCountByChannel[dm.id] ?? 0;
                                            return dmntionCount > 0 && !state.muteStatusByChannel[dm.id] ? (
                                                <span className="mention-pill">@{dmntionCount}</span>
                                            ) : (unreadCountByChannel[dm.id] ?? 0) > 0 ? <span className="unread-pill"></span> : null;
                                        })()}
                                    </button>
                                </div>
                            </li>
                        ))}
                        {(!state.allDmChannels || state.allDmChannels.length === 0) && (
                            <p className="no-items-placeholder">No direct messages yet.</p>
                        )}
                    </ul>


                </nav>
            ) : (
                <nav className="channels" aria-label="Channels">
                    <div className="category-header">
                        <div className="header-left">
                            <button
                                type="button"
                                className="back-button"
                                onClick={() => setView("servers")}
                                title="Back to Servers"
                            >
                                ←
                            </button>
                            <h2 className="server-title">{activeServer?.name || "Channels"}</h2>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {activeServer && !(activeServer as any).isMember && activeServer.type !== 'dm' && (
                                <button
                                    type="button"
                                    className="join-space-button"
                                    onClick={async () => {
                                        try {
                                            await joinServer(activeServer.id);
                                            // Refresh server list manually or via parent
                                            await handleServerChange(activeServer.id);
                                        } catch (err) {
                                            console.error("Failed to join server", err);
                                        }
                                    }}
                                >
                                    Join Space
                                </button>
                            )}
                            {canManageCurrentSpace && (
                            <div style={{ position: "relative" }}>
                                <button
                                    type="button"
                                    className="icon-button"
                                    title="Add..."
                                    onClick={() => dispatch({ type: "SET_ADD_MENU_OPEN", payload: !isAddMenuOpen })}
                                >
                                    +
                                </button>
                                {isAddMenuOpen && (
                                    <div className="add-menu-dropdown">
                                        <button type="button" onClick={() => {
                                            dispatch({ type: "SET_SELECTED_CATEGORY_FOR_CREATE", payload: "" });
                                            dispatch({ type: "SET_ACTIVE_MODAL", payload: "create-room" });
                                            dispatch({ type: "SET_ADD_MENU_OPEN", payload: false });
                                        }}>
                                            New Room
                                        </button>
                                        <button type="button" onClick={() => {
                                            dispatch({ type: "SET_ACTIVE_MODAL", payload: "create-category" });
                                            dispatch({ type: "SET_ADD_MENU_OPEN", payload: false });
                                        }}>
                                            New Category
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        </div>
                    </div>

                    <input
                        aria-label="Filter channels"
                        placeholder="Search channels"
                        className="filter-input"
                        value={channelFilter}
                        onChange={(event) => dispatch({ type: "SET_CHANNEL_FILTER", payload: event.target.value })}
                    />

                    <div className="channel-groups-container">
                        <ul>
                            {groupedChannels.map((group) => (
                                <li key={group.id ?? "uncategorized"}>
                                    {group.id && (
                                        <div className="category-header">
                                            <p className="category-heading">{group.name}</p>
                                            {canManageCurrentSpace && (
                                                <div className="inline-mgmt persistent">
                                                    <button
                                                        type="button"
                                                        className="icon-button"
                                                        title="Create Room"
                                                        onClick={() => {
                                                            dispatch({ type: "SET_SELECTED_CATEGORY_FOR_CREATE", payload: group.id ?? "" });
                                                            dispatch({ type: "SET_ACTIVE_MODAL", payload: "create-room" });
                                                        }}
                                                    >
                                                        +
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="icon-button"
                                                        title="Rename Category"
                                                        onClick={() => {
                                                            dispatch({ type: "SET_RENAME_CATEGORY", payload: { id: group.id!, name: group.name } });
                                                            dispatch({ type: "SET_ACTIVE_MODAL", payload: "rename-category" });
                                                        }}
                                                    >
                                                        ✎
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <ul className="nested-channel-list">
                                        {group.channels.map((channel) => (
                                            <li key={channel.id}>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "list-item",
                                                        selectedChannelId === channel.id && "active",
                                                        (unreadCountByChannel[channel.id] ?? 0) > 0 && "unread"
                                                    )}
                                                    aria-current={selectedChannelId === channel.id ? "true" : undefined}
                                                    onClick={() => {
                                                        void handleChannelChange(channel.id);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        handleChannelKeyboardNavigation(event, channel.id);
                                                    }}
                                                    onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                                                >
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: (state.muteStatusByChannel[channel.id] || channel.hubMemberAccess === 'locked' || channel.spaceMemberAccess === 'locked') ? 0.5 : 1 }}>
                                                        {channel.type === 'voice' ? '🔊' : '#'}
                                                        {getChannelName(channel, viewer?.productUserId)}
                                                        {state.muteStatusByChannel[channel.id] && <span title="Muted">🔇</span>}
                                                        {(channel.hubMemberAccess === 'locked' || channel.spaceMemberAccess === 'locked') && <span title="Locked">🔒</span>}
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        {(unreadCountByChannel[channel.id] ?? 0) > 0 ? (
                                                            <span className="unread-pill"></span>
                                                        ) : null}
                                                        {(mentionCountByChannel[channel.id] ?? 0) > 0 ? (
                                                            <span className="mention-pill">@{mentionCountByChannel[channel.id]}</span>
                                                        ) : null}
                                                        {canManageCurrentSpace && selectedChannelId === channel.id && (
                                                            <div className="inline-mgmt">
                                                                <button
                                                                    type="button"
                                                                    className="icon-button"
                                                                    title="Edit Room"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        dispatch({ type: "SET_RENAME_ROOM", payload: { id: channel.id, name: channel.name, type: channel.type, categoryId: channel.categoryId } });
                                                                        dispatch({ type: "SET_ACTIVE_MODAL", payload: "rename-room" });
                                                                    }}
                                                                >
                                                                    ✎
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="icon-button danger"
                                                                    title="Delete Room"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm(`Are you sure you want to delete "#${channel.name}"?`)) {
                                                                            if (selectedServerId) {
                                                                                void performDeleteRoom(selectedServerId, channel.id);
                                                                            }
                                                                        }
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                    </div>
                </nav>
            )}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </aside>
    );
}
