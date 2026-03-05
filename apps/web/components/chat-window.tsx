"use client";

import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useChat, MessageItem } from "../context/chat-context";
import type { ChatMessage, ModerationActionType } from "@skerry/shared";
import { ContextMenu, ContextMenuItem } from "./context-menu";
import { performModerationAction, createReport, uploadMedia, updateMessage, addReaction, removeReaction, deleteMessage, listChannelMembers, inviteToChannel, updateChannel, searchUsers } from "../lib/control-plane";
import dynamic from "next/dynamic";

// @ts-ignore - emoji-picker-react types mismatch with Next.js dynamic
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false }) as any;
import type { EmojiClickData } from "emoji-picker-react";
import { VoiceRoom } from "./voice-room";

interface ChatWindowProps {
    handleSendMessage: (event: React.FormEvent) => Promise<void>;
    handleUpdateSlowMode: (event: React.FormEvent) => Promise<void>;
    handleSetLock: (locked: boolean) => Promise<void>;
    handleMessageListScroll: (event: React.UIEvent<HTMLOListElement>) => void;
    jumpToLatest: () => void;
    submitDraftMessage: (attachments?: any[]) => Promise<void>;
    sendContentWithOptimistic: (content: string, attachments?: any[], failedId?: string) => Promise<void>;
    handleJoinVoice: () => Promise<void>;
    handleLeaveVoice: () => Promise<void>;
    messagesRef: React.RefObject<HTMLOListElement>;
    messageInputRef: React.RefObject<HTMLTextAreaElement>;
    // UI local states passed down for sync (until moved to context)
    draftMessage: string;
    setDraftMessage: React.Dispatch<React.SetStateAction<string>>;
    sending: boolean;
    voiceConnected: boolean;
    voiceMuted: boolean;
    voiceDeafened: boolean;
    voiceVideoEnabled: boolean;
    voiceGrant: any;
    mentions: any[];
    handleToggleMuteDeafen: (muted: boolean, deafened: boolean) => Promise<void>;
    handleToggleVideo: (enabled: boolean) => Promise<void>;
    handlePerformModerationAction?: (action: ModerationActionType, targetUserId?: string, targetMessageId?: string) => Promise<void>;
    refreshChatState: (serverId?: string, channelId?: string) => Promise<void>;
}

function formatMessageTime(value: string): string {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatWindow({
    handleSendMessage,
    handleUpdateSlowMode,
    handleSetLock,
    handleMessageListScroll,
    jumpToLatest,
    submitDraftMessage,
    sendContentWithOptimistic,
    handleJoinVoice,
    handleLeaveVoice,
    messagesRef,
    messageInputRef,
    draftMessage,
    setDraftMessage,
    sending,
    voiceConnected,
    voiceMuted,
    voiceDeafened,
    voiceVideoEnabled,
    voiceGrant,
    mentions,
    handleToggleMuteDeafen,
    handleToggleVideo,
    handlePerformModerationAction,
    refreshChatState
}: ChatWindowProps) {
    const { state, dispatch } = useChat();
    const {
        viewer,
        servers,
        channels,
        selectedServerId,
        selectedChannelId,
        activeChannelData,
        messages,
        isNearBottom,
        pendingNewMessageCount,
        isDetailsOpen,
        theme,
        allowedActions,
        discordMappings,
        discordConnection
    } = state;

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: MessageItem | null } | null>(null);
    const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number; userId: string; displayName: string } | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [reactionTargetMessageId, setReactionTargetMessageId] = useState<string | null>(null);
    const [channelMembers, setChannelMembers] = useState<{ productUserId: string; displayName: string }[]>([]);
    const [isEditingTopic, setIsEditingTopic] = useState(false);
    const [attachments, setAttachments] = useState<any[]>([]);
    const [newTopic, setNewTopic] = useState("");
    const [isInviting, setIsInviting] = useState(false);
    const [userSearchQuery, setUserSearchQuery] = useState("");
    const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const activeChannel = activeChannelData;

    const activeServer = useMemo(
        () => servers.find((s) => s.id === (activeChannel?.serverId ?? selectedServerId)),
        [servers, selectedServerId, activeChannel?.serverId]
    );

    const activeDiscordMapping = useMemo(
        () => discordMappings.find((m) => m.matrixChannelId === selectedChannelId && m.enabled),
        [discordMappings, selectedChannelId]
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (showEmojiPicker && !target.closest(".emoji-picker-container") && !target.closest(".composer-trigger")) {
                setShowEmojiPicker(false);
            }
        };

        if (showEmojiPicker) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showEmojiPicker]);

    const canManageChannel = useMemo(
        () =>
            allowedActions.includes("channel.lock") ||
            allowedActions.includes("channel.unlock") ||
            allowedActions.includes("channel.slowmode"),
        [allowedActions]
    );

    const renderedMessages = useMemo(() => {
        const grouped: Array<{
            message: MessageItem;
            showHeader: boolean;
            showDateDivider: boolean;
        }> = [];

        for (let index = 0; index < messages.length; index += 1) {
            const message = messages[index]!;
            const previous = messages[index - 1];
            const currentTime = new Date(message.createdAt).getTime();
            const previousTime = previous ? new Date(previous.createdAt).getTime() : null;
            const showHeader =
                !previous ||
                previous.authorUserId !== message.authorUserId ||
                Boolean(previous.isRelay) !== Boolean(message.isRelay) ||
                previousTime === null ||
                currentTime - previousTime > 5 * 60 * 1000;

            const showDateDivider =
                !previous ||
                new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();

            grouped.push({
                message,
                showHeader,
                showDateDivider
            });
        }

        return grouped;
    }, [messages]);

    useEffect(() => {
        if (selectedChannelId && activeChannelData?.type === "dm") {
            void listChannelMembers(selectedChannelId).then(setChannelMembers);
        } else {
            setChannelMembers([]);
        }
        setIsEditingTopic(false);
        setIsInviting(false);
    }, [selectedChannelId, activeChannelData?.type]);

    const dmTitle = useMemo(() => {
        if (!activeChannelData || activeChannelData.type !== "dm") return null;
        if (activeChannelData.topic) return activeChannelData.topic;
        const others = channelMembers.filter((m) => m.productUserId !== viewer?.productUserId);
        if (others.length === 0) return "Direct Message";
        return others.map((m) => m.displayName).join(", ");
    }, [activeChannelData, channelMembers, viewer]);

    const dmSubtitle = useMemo(() => {
        if (!activeChannelData || activeChannelData.type !== "dm" || !activeChannelData.topic) return null;
        return `${channelMembers.length} members`;
    }, [activeChannelData, channelMembers]);

    const handleInviteUser = async (userId: string) => {
        if (!selectedChannelId) return;
        try {
            await inviteToChannel(selectedChannelId, userId);
            const members = await listChannelMembers(selectedChannelId);
            setChannelMembers(members);
            await refreshChatState(activeServer?.id, selectedChannelId);
            setIsInviting(false);
        } catch (error) {
            console.error("Invite failed", error);
            alert("Failed to invite user.");
        }
    };

    const handleSaveTopic = async () => {
        if (!selectedChannelId || !activeServer?.id) return;
        try {
            await updateChannel(selectedChannelId, {
                serverId: activeServer.id,
                topic: newTopic.trim() || null
            });
            await refreshChatState(activeServer.id, selectedChannelId);
            setIsEditingTopic(false);
        } catch (error) {
            console.error("Topic update failed", error);
            alert("Failed to update topic.");
        }
    };

    useEffect(() => {
        if (userSearchQuery.length > 1) {
            const timer = setTimeout(() => {
                void searchUsers(userSearchQuery).then(setUserSearchResults);
            }, 300);
            return () => clearTimeout(timer);
        } else {
            setUserSearchResults([]);
        }
    }, [userSearchQuery]);

    const handleContextMenu = (event: React.MouseEvent, message: MessageItem) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, message });
    };

    const isMediaUrl = (url: string) => {
        return (
            /\.(jpeg|jpg|gif|png|webp|svg)$/i.test(url) ||
            url.includes("/_matrix/media/v3/download/") ||
            /media\.giphy\.com|tenor\.com\/view/i.test(url)
        );
    };

    const extractMediaUrls = (content: string) => {
        // Detect URLs, stopping at a trailing parenthesis which is common in markdown image syntax
        const urlRegex = /(https?:\/\/[^\s)]+)/g;
        return content.match(urlRegex)?.filter(isMediaUrl) || [];
    };

    const messageContextMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!contextMenu?.message) return [];
        const isAuthor = contextMenu.message.authorUserId === viewer?.productUserId;
        const isModerator = allowedActions.includes("moderation.kick") || allowedActions.includes("moderation.ban");

        const items: ContextMenuItem[] = [
            {
                label: "Add Reaction",
                icon: "😀",
                onClick: () => {
                    setReactionTargetMessageId(contextMenu.message?.id || null);
                }
            },
            {
                label: "Copy Text",
                icon: "📋",
                onClick: () => {
                    void navigator.clipboard.writeText(contextMenu.message?.content || "");
                }
            }
        ];

        if (isAuthor) {
            items.push({
                label: "Edit Message",
                icon: "✏️",
                onClick: () => {
                    setEditingMessageId(contextMenu.message?.id || null);
                    setEditContent(contextMenu.message?.content || "");
                }
            });
        }

        if (isModerator || isAuthor) {
            items.push({
                label: "Delete Message",
                icon: "🗑️",
                danger: true,
                onClick: () => {
                    if (confirm("Are you sure you want to delete this message?")) {
                        void deleteMessage(contextMenu.message?.channelId || "", contextMenu.message?.id || "");
                    }
                }
            });
        }

        if (isModerator && !isAuthor) {
            items.push({
                label: "Timeout User (Shadow Mute)",
                icon: "⏳",
                danger: true,
                onClick: () => {
                    void performModerationAction({
                        action: "timeout",
                        serverId: selectedServerId || "",
                        targetUserId: contextMenu.message?.authorUserId,
                        timeoutSeconds: 3600,
                        reason: "Shadow mute requested"
                    });
                }
            });
            items.push({
                label: "Kick User",
                icon: "👢",
                danger: true,
                onClick: () => {
                    void performModerationAction({
                        action: "kick",
                        serverId: selectedServerId || "",
                        targetUserId: contextMenu.message?.authorUserId,
                        reason: "Kick requested via message context"
                    });
                }
            });
        }

        return items;
    }, [contextMenu, viewer, allowedActions, selectedServerId, selectedChannelId]);

    const userContextMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!userContextMenu) return [];
        const isModerator = allowedActions.includes("moderation.kick") || allowedActions.includes("moderation.ban");
        const isSelf = userContextMenu.userId === viewer?.productUserId;

        const items: ContextMenuItem[] = [
            {
                label: "View Profile",
                icon: "👤",
                onClick: () => {
                    // TODO: Implement profile modal
                    console.log("View profile", userContextMenu.userId);
                }
            },
            {
                label: "Direct Message",
                icon: "💬",
                onClick: () => {
                    console.log("DM user", userContextMenu.userId);
                }
            }
        ];

        if (!isSelf) {
            items.push({
                label: "Ignore / Block",
                icon: "🚫",
                onClick: () => {
                    console.log("Block user", userContextMenu.userId);
                }
            });
        }

        if (isModerator && !isSelf) {
            items.push({
                label: "Timeout (Shadow Mute)",
                icon: "⏳",
                danger: true,
                onClick: () => {
                    void performModerationAction({
                        action: "timeout",
                        serverId: selectedServerId || "",
                        targetUserId: userContextMenu.userId,
                        timeoutSeconds: 3600,
                        reason: "Shadow mute requested via message user"
                    });
                }
            });
            items.push({
                label: "Kick",
                icon: "👢",
                danger: true,
                onClick: () => {
                    void performModerationAction({
                        action: "kick",
                        serverId: selectedServerId || "",
                        targetUserId: userContextMenu.userId,
                        reason: "Kick requested via message user"
                    });
                }
            });
        }

        return items;
    }, [userContextMenu, viewer, allowedActions, selectedServerId]);

    const handleUserContextMenu = (event: React.MouseEvent, userId: string, displayName: string) => {
        event.preventDefault();
        event.stopPropagation();
        setUserContextMenu({ x: event.clientX, y: event.clientY, userId, displayName });
    };

    const handleFileUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const file = files.item(0);
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            alert("Only images are supported.");
            return;
        }
        if (!activeServer?.id) {
            alert("Please select a server first.");
            return;
        }

        setIsUploading(true);
        try {
            const res = await uploadMedia(activeServer.id, file);
            setAttachments((prev) => [...prev, {
                id: `att_tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                url: res.url,
                contentType: file.type,
                filename: file.name
            }]);
        } catch (error) {
            console.error("Upload failed", error);
            alert("Failed to upload image.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            e.preventDefault();
            void handleFileUpload(e.clipboardData.files);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            const hasImage = Array.from(e.dataTransfer.files).some((f) => f.type.startsWith("image/"));
            if (hasImage) {
                void handleFileUpload(e.dataTransfer.files);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // needed to allow drop
    };

    return (
        <section
            className="timeline panel"
            aria-label="Messages"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            <header className="channel-header">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <button
                        type="button"
                        className="icon-button mobile-only"
                        onClick={() => dispatch({ type: "SET_SIDEBAR_OPEN", payload: !state.isSidebarOpen })}
                        aria-label="Toggle Sidebar"
                        style={{ display: "none" }} /* Hidden by CSS for desktop */
                    >
                        ☰
                    </button>
                    <div>
                        <h2>
                            {activeChannel?.type === "dm"
                                ? dmTitle
                                : `${activeServer ? `${activeServer.name} - ` : ""}${activeChannel ? `#${activeChannel.name}` : "No channel selected"}`}
                        </h2>
                        <p>
                            {activeChannel?.type === "dm"
                                ? dmSubtitle || `${channelMembers.length} members`
                                : activeChannel
                                    ? `${messages.length} messages · slow mode ${activeChannel.slowModeSeconds}s`
                                    : "Select a channel to start chatting"}
                        </p>
                    </div>
                </div>
                <div className="channel-actions">
                    {activeDiscordMapping && (
                        <div
                            className="discord-badge-container"
                            title={`Bridged to ${discordConnection?.guildName ?? 'Discord'} #${activeDiscordMapping.discordChannelName}`}
                        >
                            <div className="discord-badge">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z" />
                                </svg>
                            </div>
                        </div>
                    )}
                    {activeChannel?.type === "dm" && (
                        <div className="dm-controls inline-buttons">
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => {
                                    setNewTopic(activeChannel.topic || "");
                                    setIsEditingTopic(true);
                                }}
                                title="Set DM Topic"
                            >
                                📝
                            </button>
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => setIsInviting(true)}
                                title="Invite Participants"
                            >
                                👤+
                            </button>
                        </div>
                    )}
                    <span className="channel-badge">{activeChannel?.type ?? "none"}</span>

                    {activeChannel?.type === "voice" && voiceConnected && (
                        <div className="voice-controls inline-buttons">
                            <button
                                type="button"
                                className={`icon-button ${voiceMuted ? "active-toggle" : ""}`}
                                onClick={() => handleToggleMuteDeafen(!voiceMuted, voiceDeafened)}
                                title={voiceMuted ? "Unmute" : "Mute"}
                            >
                                {voiceMuted ? "🔇" : "🎤"}
                            </button>
                            <button
                                type="button"
                                className={`icon-button ${voiceDeafened ? "active-toggle" : ""}`}
                                onClick={() => handleToggleMuteDeafen(voiceMuted, !voiceDeafened)}
                                title={voiceDeafened ? "Undeafen" : "Deafen"}
                            >
                                {voiceDeafened ? "🔈" : "🎧"}
                            </button>
                            <button
                                type="button"
                                className={`icon-button ${voiceVideoEnabled ? "active-toggle" : ""}`}
                                onClick={() => handleToggleVideo(!voiceVideoEnabled)}
                                title={voiceVideoEnabled ? "Disable Video" : "Enable Video"}
                            >
                                {voiceVideoEnabled ? "📹" : "📷"}
                            </button>
                            <button
                                type="button"
                                className="icon-button danger"
                                onClick={() => handleLeaveVoice()}
                                title="Leave Voice"
                            >
                                📞
                            </button>
                        </div>
                    )}

                    <button
                        type="button"
                        className="ghost"
                        title={isDetailsOpen ? "Hide Details" : "Show Details"}
                        onClick={() => dispatch({ type: "SET_DETAILS_OPEN", payload: !isDetailsOpen })}
                    >
                        {isDetailsOpen ? "→" : "←"}
                    </button>
                </div>
            </header>

            {activeChannel?.type === "voice" && voiceConnected && voiceGrant && (
                <VoiceRoom
                    grant={voiceGrant}
                    muted={voiceMuted}
                    deafened={voiceDeafened}
                    videoEnabled={voiceVideoEnabled}
                    onDisconnect={handleLeaveVoice}
                />
            )}


            <ol className="messages" ref={messagesRef} onScroll={handleMessageListScroll}>
                {renderedMessages.map(({ message, showHeader, showDateDivider }, index) => {
                    const mediaUrls = extractMediaUrls(message.content);
                    const isNearBottomIndex = index >= renderedMessages.length - 2;
                    const pickerPositionStyle = isNearBottomIndex
                        ? { bottom: "100%", left: 0, marginBottom: "0.5rem" }
                        : { top: "100%", left: 0, marginTop: "0.5rem" };

                    return (
                        <li key={message.id}>
                            {showDateDivider ? (
                                <div className="date-divider">
                                    <span>{new Date(message.createdAt).toLocaleDateString()}</span>
                                </div>
                            ) : null}
                            <article onContextMenu={(e) => handleContextMenu(e, message)}>
                                {showHeader ? (
                                    <header>
                                        <strong
                                            className="author-name"
                                            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem" }}
                                            onClick={(e) => handleUserContextMenu(e, message.authorUserId, message.authorDisplayName)}
                                            onContextMenu={(e) => handleUserContextMenu(e, message.authorUserId, message.authorDisplayName)}
                                        >
                                            {message.isRelay && (
                                                <div className="discord-relay-badge" title="Relayed from Discord" style={{ color: "#5865F2", display: "flex", alignItems: "center" }}>
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z" />
                                                    </svg>
                                                </div>
                                            )}
                                            {message.authorDisplayName}
                                        </strong>
                                        <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                                    </header>
                                ) : null}
                                <div className="message-content-wrapper" style={{ position: "relative" }}>
                                    {editingMessageId === message.id ? (
                                        <div className="message-edit-inline" style={{ marginTop: "0.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                            <textarea
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && !e.shiftKey) {
                                                        e.preventDefault();
                                                        if (editContent.trim()) {
                                                            void updateMessage(message.channelId, message.id, editContent).then(() => setEditingMessageId(null));
                                                        }
                                                    } else if (e.key === "Escape") {
                                                        setEditingMessageId(null);
                                                    }
                                                }}
                                                className="edit-textarea"
                                                autoFocus
                                            />
                                            <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem" }}>
                                                <small>escape to cancel, enter to save</small>
                                                <button type="button" className="inline-action" onClick={() => setEditingMessageId(null)}>Cancel</button>
                                                <button type="button" className="inline-action" onClick={() => {
                                                    if (editContent.trim()) {
                                                        void updateMessage(message.channelId, message.id, editContent).then(() => setEditingMessageId(null));
                                                    }
                                                }}>Save</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p>{message.content.replace(/!\[image\]\(https?:\/\/[^\s)]+\)/g, "").trim()}</p>
                                            {message.updatedAt && <small className="message-meta-edited" style={{ fontSize: "0.75rem", opacity: 0.6 }}>(edited)</small>}
                                        </>
                                    )}

                                    {/* Attachments rendering */}
                                    {message.attachments && message.attachments.length > 0 && (
                                        <div className="message-attachments-container" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                                            {message.attachments.map((att) => (
                                                <div key={att.id} className="attachment" style={{ maxWidth: "300px" }}>
                                                    <a href={att.sourceUrl || att.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}>
                                                        {att.contentType.startsWith("image/") ? (
                                                            <img src={att.url} alt={att.filename} loading="lazy" style={{ maxWidth: "100%", borderRadius: "4px", display: "block", cursor: "pointer" }} />
                                                        ) : att.contentType.startsWith("video/") ? (
                                                            <video src={att.url} autoPlay loop muted playsInline style={{ maxWidth: "100%", borderRadius: "4px", display: "block", cursor: "pointer" }} />
                                                        ) : (
                                                            <div className="attachment-link" style={{ background: "var(--bg-accent)", padding: "0.5rem", borderRadius: "4px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                                                <span style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>{att.filename}</span>
                                                            </div>
                                                        )}
                                                    </a>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Legacy media urls (from content) */}
                                    {(!message.attachments || message.attachments.length === 0) && mediaUrls.length > 0 && (
                                        <div className="message-attachments-container" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                                            {mediaUrls.map((url, i) => (
                                                <div key={i} className="attachment" style={{ maxWidth: "300px" }}>
                                                    <img src={url} alt="Attached media" loading="lazy" style={{ maxWidth: "100%", borderRadius: "4px" }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Reactions rendering */}
                                    {message.reactions && message.reactions.length > 0 && (
                                        <div className="message-reactions-container" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
                                            {message.reactions.map((r: any) => (
                                                <button
                                                    key={r.emoji}
                                                    title={r.displayNames ? r.displayNames.join(', ') : ''}
                                                    type="button"
                                                    className={`interaction-btn ${r.me ? "active" : ""}`}
                                                    style={{ padding: "1px 6px", borderRadius: "12px", border: "1px solid var(--border-color)", background: r.me ? "var(--accent-color-transparent)" : "var(--surface-color)", fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem" }}
                                                    onClick={() => r.me ? removeReaction(message.channelId, message.id, r.emoji) : addReaction(message.channelId, message.id, r.emoji)}
                                                >
                                                    <span>{r.emoji}</span>
                                                    <span style={{ fontWeight: 600, opacity: 0.8 }}>{r.count}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Emoji Picker for adding a reaction */}
                                    {reactionTargetMessageId === message.id && (
                                        <div className="reaction-picker-overlay" style={{ position: "absolute", zIndex: 50, ...pickerPositionStyle }}>
                                            <div className="picker-backdrop" style={{ position: "fixed", inset: 0 }} onClick={() => setReactionTargetMessageId(null)} />
                                            <div className="emoji-picker-container" style={{ position: "relative", zIndex: 100 }}>
                                                <EmojiPicker
                                                    onEmojiClick={async (emojiData: EmojiClickData) => {
                                                        await addReaction(message.channelId, message.id, emojiData.emoji);
                                                        setReactionTargetMessageId(null);
                                                    }}
                                                    theme={theme as any}
                                                    width={350}
                                                    height={400}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {message.clientState === "sending" ? <small className="message-meta">Sending...</small> : null}
                                {message.clientState === "failed" ? (
                                    <small className="message-meta message-meta-error">
                                        Failed to send.
                                        <button
                                            type="button"
                                            className="inline-action"
                                            onClick={() => {
                                                void sendContentWithOptimistic(message.content, message.attachments, message.id);
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </small>
                                ) : null}
                            </article>
                        </li>
                    );
                })}
            </ol>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={messageContextMenuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {userContextMenu && (
                <ContextMenu
                    x={userContextMenu.x}
                    y={userContextMenu.y}
                    items={userContextMenuItems}
                    onClose={() => setUserContextMenu(null)}
                />
            )}

            {!isNearBottom && pendingNewMessageCount > 0 ? (
                <div className="jump-latest">
                    <button type="button" onClick={jumpToLatest}>
                        Jump to latest ({pendingNewMessageCount})
                    </button>
                </div>
            ) : null}

            <form onSubmit={(e) => {
                e.preventDefault();
                if (draftMessage.trim() || attachments.length > 0) {
                    void submitDraftMessage(attachments);
                    setAttachments([]);
                }
            }} className="composer">
                <label htmlFor="message-input" className="sr-only">
                    Message
                </label>
                <div className="input-wrapper">
                    {attachments.length > 0 && (
                        <div className="composer-attachments-preview" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.5rem", borderBottom: "1px solid var(--border-color)" }}>
                            {attachments.map((att) => (
                                <div key={att.id} className="attachment-preview" style={{ position: "relative", width: "60px", height: "60px" }}>
                                    <img src={att.url} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }} />
                                    <button 
                                        type="button" 
                                        onClick={() => setAttachments(prev => prev.filter(p => p.id !== att.id))}
                                        style={{ position: "absolute", top: "-5px", right: "-5px", background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: "18px", height: "18px", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <textarea
                        id="message-input"
                        ref={messageInputRef}
                        value={draftMessage}
                        onChange={(event) => setDraftMessage(event.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                if (draftMessage.trim() || attachments.length > 0) {
                                    void submitDraftMessage(attachments);
                                    setAttachments([]);
                                }
                            }
                        }}
                        maxLength={2000}
                        placeholder={activeChannel ? `Message #${activeChannel.name}` : "Select a channel first"}
                        aria-label={activeChannel ? `Message #${activeChannel.name}` : "Message channel"}
                        disabled={!activeChannel || isUploading}
                    />
                    {showEmojiPicker && (
                        <div className="emoji-picker-container composer-emoji-picker">
                            <EmojiPicker
                                onEmojiClick={(emojiData: EmojiClickData) => {
                                    setDraftMessage(prev => prev + emojiData.emoji);
                                    setShowEmojiPicker(false);
                                }}
                                width={350}
                                height={400}
                                theme={theme as any}
                            />
                        </div>
                    )}
                    <div className="composer-trigger overlay">
                        <button
                            type="button"
                            className="composer-trigger"
                            title="Insert emoji"
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            disabled={!activeChannel || sending || isUploading}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                                <line x1="9" y1="9" x2="9.01" y2="9" />
                                <line x1="15" y1="9" x2="15.01" y2="9" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            className="composer-trigger"
                            title="Attach image"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!activeChannel || isUploading}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                        </button>
                    </div>
                    <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        ref={fileInputRef}
                        onChange={(e) => handleFileUpload(e.target.files)}
                    />
                </div>
                <div className="composer-actions">
                    <small className="char-count">{draftMessage.length}/2000</small>
                    <button type="submit" disabled={!activeChannel || sending || isUploading || (!draftMessage.trim() && attachments.length === 0)}>
                        {sending ? "Sending..." : isUploading ? "Uploading..." : "Send"}
                    </button>
                </div>
            </form>
            {/* Topic Edit Modal */}
            {isEditingTopic && (
                <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
                    <div className="modal-content panel" style={{ width: "400px", padding: "1.5rem", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
                        <h3>Edit DM Topic</h3>
                        <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1rem" }}>Set a topic for this conversation. It will be shown as the title.</p>
                        <input
                            type="text"
                            className="input"
                            value={newTopic}
                            onChange={(e) => setNewTopic(e.target.value)}
                            placeholder="e.g. Project Planning"
                            autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleSaveTopic()}
                            style={{ width: "100%", marginBottom: "1rem" }}
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                            <button className="ghost" onClick={() => setIsEditingTopic(false)}>Cancel</button>
                            <button className="primary" onClick={handleSaveTopic}>Save Topic</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invite Modal */}
            {isInviting && (
                <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
                    <div className="modal-content panel" style={{ width: "400px", minHeight: "300px", padding: "1.5rem", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>
                        <h3>Invite to DM</h3>
                        <input
                            type="text"
                            className="input"
                            value={userSearchQuery}
                            onChange={(e) => setUserSearchQuery(e.target.value)}
                            placeholder="Search by username..."
                            autoFocus
                            style={{ width: "100%", marginBottom: "1rem" }}
                        />
                        <div className="search-results" style={{ flex: 1, overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "4px" }}>
                            {userSearchResults.length > 0 ? (
                                userSearchResults.map((user) => (
                                    <div key={user.productUserId} style={{ padding: "0.5rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <span>{user.preferredUsername}</span>
                                        <button className="inline-action" onClick={() => handleInviteUser(user.productUserId)}>Invite</button>
                                    </div>
                                ))
                            ) : (
                                <p style={{ padding: "1rem", textAlign: "center", opacity: 0.6 }}>No users found</p>
                            )}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                            <button className="ghost" onClick={() => setIsInviting(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
