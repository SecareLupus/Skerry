"use client";

import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useChat, MessageItem } from "../context/chat-context";
import { Category, Channel, ChatMessage, MentionMarker, ModerationAction, ModerationActionType, Server, VoiceTokenGrant } from "@skerry/shared";
import { getChannelName } from "../lib/channel-utils";
import { ContextMenu, ContextMenuItem } from "./context-menu";
import { useToast } from "./toast-provider";
import { performModerationAction, createReport, uploadMedia, updateMessage, addReaction, removeReaction, deleteMessage, listChannelMembers, inviteToChannel, updateChannel, searchUsers, formatMessageTime, pinMessage, unpinMessage, sendTypingStatus, getFirstUnreadMessageId } from "../lib/control-plane";
import dynamic from "next/dynamic";

// @ts-ignore - emoji-picker-react types mismatch with Next.js dynamic
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false }) as any;
import type { EmojiClickData } from "emoji-picker-react";
import { VoiceRoom } from "./voice-room";
import { EmbedCard } from "./embed-card";
import DOMPurify from "dompurify";
import { LandingJoinButton } from "./landing-join-button";
import { LandingPageView } from "./landing-page-view";
import { GifPlayer } from "./gif-player";
import { useIntersectionObserver } from "../hooks/use-intersection-observer";



interface ChatWindowProps {
    handleSendMessage: (event: React.FormEvent) => Promise<void>;
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
    voiceScreenShareEnabled: boolean;
    voiceGrant: VoiceTokenGrant | null;
    mentions: any[];
    handleToggleMuteDeafen: (muted: boolean, deafened: boolean) => Promise<void>;
    handleToggleVideo: (enabled: boolean) => Promise<void>;
    handleToggleScreenShare: (enabled: boolean) => Promise<void>;
    handlePerformModerationAction?: (action: ModerationActionType, targetUserId?: string, targetMessageId?: string) => Promise<void>;
    refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
    handleUpdateRoomTopic: (topic: string) => Promise<void>;
    handleUpdateRoomIcon: (iconUrl: string | null) => Promise<void>;
    handleToggleRoomLock: () => Promise<void>;
    handleSetSlowmode: (seconds: number) => Promise<void>;
}

// LandingPageView is now imported from ./landing-page-view


const normalizeMediaUrl = (url: string) => {
    if (!url) return url;
    // Handle Discord external proxy: https://images-ext-1.discordapp.net/external/.../https/media.tenor.com/...
    if (url.includes("images-ext-") && url.includes("/https/")) {
        const parts = url.split("/https/");
        if (parts.length > 1) return "https://" + parts[1];
    }
    
    // Convert media.discordapp.net to cdn.discordapp.com for stickers/emojis
    // media subdomains are often more restricted or intended for dynamic resizing
    if (url.includes("media.discordapp.net") && (url.includes("/stickers/") || url.includes("/emojis/"))) {
        return url.replace("media.discordapp.net", "cdn.discordapp.com");
    }

    return url;
};

const getProxiedUrl = (url: string) => {
    if (!url) return url;
    const normalized = normalizeMediaUrl(url);
    const controlPlaneUrl = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || "";
    
    // Always proxy stickers to avoid CORS/Referer issues
    if (normalized.includes("discordapp.net/stickers/") || normalized.includes("discordapp.com/stickers/")) {
        return `${controlPlaneUrl}/v1/media/proxy?url=${encodeURIComponent(normalized)}`;
    }
    
    // Proxy Discord, Tenor, Giphy assets as they often have strict hotlinking/CORS policies
    if (
        normalized.includes("discordapp.net") || 
        normalized.includes("discordapp.com") ||
        normalized.includes("tenor.com") ||
        normalized.includes("giphy.com")
    ) {
        return `${controlPlaneUrl}/v1/media/proxy?url=${encodeURIComponent(normalized)}`;
    }
    
    return normalized;
};

function ReactionEmoji({ emoji }: { emoji: string }) {
    const customMatch = /^<(a?):([a-zA-Z0-9_-]+):(\d+)>$/.exec(emoji);
    if (customMatch) {
        const animated = customMatch[1] === "a";
        const name = customMatch[2]!;
        const id = customMatch[3]!;
        const ext = animated ? "gif" : "webp";
        return (
            <img
                src={`https://cdn.discordapp.com/emojis/${id}.${ext}?size=32&quality=lossless`}
                alt={`:${name}:`}
                title={`:${name}:`}
                style={{ width: "1.1em", height: "1.1em", verticalAlign: "middle", objectFit: "contain" }}
            />
        );
    }
    return <span>{emoji}</span>;
}

const LottieSticker = React.memo(function LottieSticker({ url }: { url: string }) {
    const controlPlaneUrl = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || "";
    const stickerUrl = `${controlPlaneUrl}/v1/media/sticker?url=${encodeURIComponent(url)}`;

    return (
        <div style={{ width: 160, height: 160, borderRadius: 8, overflow: "hidden", position: "relative", zIndex: 10 }}>
            <img 
                src={stickerUrl} 
                alt="Sticker"
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", position: "relative", zIndex: 11 }}
                onError={(e) => {
                    console.error("[LottieSticker] Failed to load:", stickerUrl);
                    // Fallback to error message if WebP fails
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                        parent.innerHTML = '<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; opacity:0.5; font-size:0.75rem; color: white;">Failed to load sticker</div>';
                    }
                }}
            />
        </div>
    );
});

function MessageContent({ message, hiddenUrls = [] }: { message: MessageItem; hiddenUrls?: string[] }) {
    const { state } = useChat();
    let content = message.content;

    // Hide URLs that are already rendered as media/embeds
    if (hiddenUrls.length > 0) {
        for (const url of hiddenUrls) {
            // Use a regex to match the URL only if it's not part of another word
            const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(escapedUrl, 'g'), "").trim();
        }
    }

    const quoteRegex = /^> @([^:]+):\s*([\s\S]*?)(?:\n\n|\n?$)/m;
    const match = content.match(quoteRegex);

    // Helper to render markdown with emoji support
    const renderMarkdown = (text: string) => {
        // Pre-process raw shortcodes to markdown images
        let processedText = text;

        // 1. Handle Discord-style tags: <:name:id> or <a:name:id>
        processedText = processedText.replace(/<(a?):([a-zA-Z0-9_-]+):(\d+)>/g, (match, animated, name, id) => {
            const query = animated ? "?size=160&quality=lossless&animated=true" : "?size=160&quality=lossless";
            return `![:${name}:](https://cdn.discordapp.com/emojis/${id}.webp${query})`;
        });

        // 2. Handle common standard shortcodes (minimal set for demo, or could use a library)
        const commonShortcodes: Record<string, string> = {
            ":smile:": "🙂",
            ":smiley:": "😃",
            ":grinning:": "😀",
            ":blush:": "😊",
            ":wink:": "😉",
            ":heart:": "❤️",
            ":thumbsup:": "👍",
            ":ok_hand:": "👌",
            ":fire:": "🔥",
            ":rocket:": "🚀"
        };
        
        // We only convert these to Unicode if they are standalone
        Object.entries(commonShortcodes).forEach(([code, unicode]) => {
            const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            processedText = processedText.replace(new RegExp(escapedCode, 'g'), unicode);
        });

        return (
            <ReactMarkdown
                components={{
                    img: ({ src, alt, ...props }) => {
                        const isEmoji = alt?.startsWith(":") && alt?.endsWith(":");
                        const proxiedSrc = src ? getProxiedUrl(src) : src;
                        return (
                            <img
                                src={proxiedSrc}
                                alt={alt}
                                className={isEmoji ? "emoji-inline" : ""}
                                style={isEmoji ? { 
                                    height: "1.375em", 
                                    width: "auto",
                                    verticalAlign: "bottom", 
                                    margin: "0 0.05em 0 0.1em",
                                    display: "inline-block"
                                } : {}}
                                {...props}
                            />
                        );
                    }
                }}
            >
                {processedText}
            </ReactMarkdown>
        );
    };

    return (
        <div className="message-text" data-testid="message-content">
            {match ? (
                <>
                    <blockquote className="message-quote">
                        <strong className="quote-author">@{match[1]}</strong>
                        <p>{match[2]}</p>
                    </blockquote>
                    <div className="markdown-content">
                        {renderMarkdown(content.replace(quoteRegex, "").trim())}
                    </div>
                </>
            ) : (
                <div className="markdown-content">
                    {renderMarkdown(content)}
                </div>
            )}
        </div>
    );
}

function TypingIndicator({ channelId }: { channelId: string }) {
    const { state } = useChat();
    const typingUsers = state.typingUsersByChannel[channelId] || {};
    const viewerId = state.viewer?.productUserId;
    const userNames = Object.entries(typingUsers)
        .filter(([userId]) => userId !== viewerId)
        .map(([, data]) => data.displayName);

    if (userNames.length === 0) return null;

    let text = "";
    if (userNames.length === 1) {
        text = `${userNames[0]} is typing...`;
    } else if (userNames.length === 2) {
        text = `${userNames[0]} and ${userNames[1]} are typing...`;
    } else {
        text = "Several people are typing...";
    }

    return (
        <div className="typing-indicator">
            <span className="typing-dots">
                <span>.</span><span>.</span><span>.</span>
            </span>
            {text}
            <style jsx>{`
                .typing-indicator {
                    padding: 0.5rem 1rem;
                    font-size: 0.8rem;
                    color: var(--text-muted);
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    animation: fadeIn 0.2s ease-out;
                }
                .typing-dots span {
                    animation: blink 1.4s infinite both;
                }
                .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
                .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
                @keyframes blink {
                    0% { opacity: 0.2; }
                    20% { opacity: 1; }
                    100% { opacity: 0.2; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}


export function ChatWindow({
    handleSendMessage,
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
    voiceScreenShareEnabled,
    voiceGrant,
    mentions,
    handleToggleMuteDeafen,
    handleToggleVideo,
    handleToggleScreenShare,
    handlePerformModerationAction,
    refreshChatState,
    handleUpdateRoomTopic,
    handleUpdateRoomIcon,
    handleToggleRoomLock,
    handleSetSlowmode
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
        discordConnection,
        quotingMessage,
        members
    } = state;

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: MessageItem | null } | null>(null);
    const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number; userId: string; displayName: string } | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const [isUploading, setIsUploading] = useState(false);
    const [reactionTargetMessageId, setReactionTargetMessageId] = useState<string | null>(null);
    const [reactionPickerPos, setReactionPickerPos] = useState<{ x: number; y: number } | null>(null);

    const [isEditingTopic, setIsEditingTopic] = useState(false);
    const [attachments, setAttachments] = useState<any[]>([]);
    const [lastTypingSentAt, setLastTypingSentAt] = useState<number>(0);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [newTopic, setNewTopic] = useState("");
    const [isInviting, setIsInviting] = useState(false);
    const { showToast } = useToast();

    const handleQuoteReply = useCallback((message: MessageItem) => {
        dispatch({ type: "SET_QUOTING_MESSAGE", payload: message });
        messageInputRef.current?.focus();
    }, [dispatch, messageInputRef]);
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
            // Handle main emoji picker (for composer/replies)
            if (showEmojiPicker && !target.closest(".emoji-picker-container") && !target.closest(".composer-trigger")) {
                setShowEmojiPicker(false);
            }
            // Handle reaction picker
            if (reactionTargetMessageId && !target.closest(".emoji-picker-container") && !target.closest(".hover-action-item") && !target.closest(".interaction-btn")) {
                setReactionTargetMessageId(null);
                setReactionPickerPos(null);
            }
        };

        if (showEmojiPicker || reactionTargetMessageId) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showEmojiPicker, reactionTargetMessageId]);

    useEffect(() => {
        const messagesList = messagesRef.current;
        if (reactionTargetMessageId) {
            if (messagesList) {
                messagesList.style.overflow = "hidden";
            }
        } else {
            if (messagesList) {
                messagesList.style.overflow = "auto";
            }
        }
        return () => {
            if (messagesList) {
                messagesList.style.overflow = "auto";
            }
        };
    }, [reactionTargetMessageId]);
    useEffect(() => {
        if (state.highlightedMessageId && messagesRef.current) {
            // Use a small timeout to ensure DOM is settled/rendered
            const timeoutId = setTimeout(() => {
                const el = document.getElementById(`message-${state.highlightedMessageId}`);
                if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            }, 100);
            return () => clearTimeout(timeoutId);
        }
    }, [state.highlightedMessageId, messages, messagesRef]);

    const handleJumpToUnread = useCallback(async () => {
        if (!selectedChannelId) return;
        const messageId = await getFirstUnreadMessageId(selectedChannelId);
        if (messageId) {
            void refreshChatState(selectedServerId ?? undefined, selectedChannelId, messageId, true);
        }
    }, [selectedChannelId, selectedServerId, refreshChatState]);

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

        // Only show root messages in the main window
        const rootMessages = messages.filter(m => !m.parentId && !state.pendingActionIds.has(m.id));

        for (let index = 0; index < rootMessages.length; index += 1) {
            const message = rootMessages[index]!
            const previous = rootMessages[index - 1];
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
    }, [messages, state.pendingActionIds]);

    useEffect(() => {
        setIsEditingTopic(false);
        setIsInviting(false);
    }, [selectedChannelId]);

    const dmTitle = useMemo(() => {
        if (!activeChannelData || activeChannelData.type !== "dm") return null;
        return getChannelName(activeChannelData, viewer?.productUserId, members);
    }, [activeChannelData, members, viewer]);

    const dmSubtitle = useMemo(() => {
        if (!activeChannelData || activeChannelData.type !== "dm" || !activeChannelData.topic) return null;
        return `${members.length} members`;
    }, [activeChannelData, members]);

    const handleInviteUser = async (userId: string) => {
        if (!selectedChannelId) return;
        try {
            await inviteToChannel(selectedChannelId, userId);
            await refreshChatState(activeServer?.id, selectedChannelId, undefined, true);
            setIsInviting(false);
        } catch (error) {
            console.error("Invite failed", error);
            alert("Failed to invite user.");
        }
    };

    const handleSaveTopic = async () => {
        if (!newTopic.trim()) return;
        await handleUpdateRoomTopic(newTopic.trim());
        setIsEditingTopic(false);
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
        // Exclude Discord emojis from being treated as standard media attachments
        if (url.includes("cdn.discordapp.com/emojis/")) return false;
        
        return (
            /\.(jpeg|jpg|gif|png|webp|svg|json|mp4|webm|mov)(\?.*)?$/i.test(url) ||
            url.includes("/_matrix/media/v3/download/") ||
            /media\d*\.giphy\.com\/media\/|giphy\.com\/gifs|giphy\.com\/clips|tenor\.com\/view|c\.tenor\.com\//i.test(url) ||
            url.includes("cdn.discordapp.com/stickers/") ||
            url.includes("media.discordapp.net/stickers/")
        );
    };

    const extractMediaUrls = (content: string) => {
        // Detect URLs, stopping at a trailing parenthesis which is common in markdown image syntax
        const urlRegex = /(https?:\/\/[^\s)]+)/g;
        const matches = content.match(urlRegex) || [];
        // Deduplicate
        return Array.from(new Set(matches.filter(isMediaUrl)));
    };

    const messageContextMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!contextMenu?.message) return [];
        const isAuthor = contextMenu.message.authorUserId === viewer?.productUserId;
        const isModerator = allowedActions.includes("moderation.kick") || 
                           allowedActions.includes("moderation.ban") ||
                           allowedActions.includes("moderation.warn") ||
                           allowedActions.includes("moderation.strike");

        const items: ContextMenuItem[] = [
            {
                label: "Add Reaction",
                icon: "😀",
                onClick: () => {
                    if (contextMenu.message) {
                        setReactionPickerPos({ x: contextMenu.x, y: contextMenu.y });
                        setReactionTargetMessageId(contextMenu.message.id);
                    }
                }
            },
            {
                label: "Copy Text",
                icon: "📋",
                onClick: () => {
                    const rawContent = contextMenu.message?.content || "";
                    // Transform ![:name:](url) -> :name: for clipboard
                    const clipboardContent = rawContent.replace(/!\[(:.+?:)\]\(https?:\/\/[^\)]+\)/g, "$1");
                    void navigator.clipboard.writeText(clipboardContent);
                }
            },
            {
                label: "Reply in Thread",
                icon: "💬",
                onClick: () => {
                    if (contextMenu.message) {
                        dispatch({ type: "SET_THREAD_PARENT_ID", payload: contextMenu.message.id });
                    }
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
                    dispatch({
                        type: "SET_CONFIRMATION",
                        payload: {
                            title: "Delete Message",
                            message: "Are you sure you want to delete this message? This action is permanent, but you have 5 seconds to undo it.",
                            confirmLabel: "Delete",
                            danger: true,
                            onConfirm: () => {
                                const messageId = contextMenu.message?.id;
                                const channelId = contextMenu.message?.channelId;
                                if (!messageId || !channelId) return;

                                // Optimistic hide
                                dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id: messageId, active: true } });

                                const timeoutId = setTimeout(async () => {
                                    try {
                                        await deleteMessage(channelId, messageId);
                                        // Remove the message from state and clear the pending marker.
                                        // The SSE message.deleted event also does this but may be missed
                                        // if the connection is in polling mode or drops.
                                        dispatch({
                                            type: "UPDATE_MESSAGES",
                                            payload: (current) => current.filter((m) => m.id !== messageId)
                                        });
                                        dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id: messageId, active: false } });
                                    } catch (err) {
                                        showToast("Failed to delete message", "error");
                                        dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id: messageId, active: false } });
                                    }
                                }, 5000);

                                showToast("Message deleted", "info", {
                                    label: "Undo",
                                    onClick: () => {
                                        clearTimeout(timeoutId);
                                        dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id: messageId, active: false } });
                                        showToast("Deletion cancelled", "success");
                                    }
                                }, 5500); // Pulse slightly longer than the delay
                            }
                        }
                    });
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: "confirmation" });
                }
            });
        }

        if (isModerator && !isAuthor) {
            items.push({
                label: "Moderate User...",
                icon: "🛡️",
                danger: true,
                onClick: () => {
                    dispatch({
                        type: "SET_MODERATION_TARGET",
                        payload: {
                            userId: contextMenu.message?.authorUserId || "",
                            displayName: contextMenu.message?.authorDisplayName || "User",
                            messageId: contextMenu.message?.id
                        }
                    });
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: "moderation" });
                }
            });
            items.push({
                label: "Timeout User (Shadow Mute)",
                icon: "⏳",
                danger: true,
                onClick: () => {
                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                    if (isMasquerade) {
                        showToast("Masquerade: Moderation is blocked.", "error");
                        return;
                    }
                    void performModerationAction({
                        action: "timeout",
                        hubId: undefined,
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
                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                    if (isMasquerade) {
                        showToast("Masquerade: Moderation is blocked.", "error");
                        return;
                    }
                    void performModerationAction({
                        action: "kick",
                        hubId: undefined,
                        serverId: selectedServerId || "",
                        targetUserId: contextMenu.message?.authorUserId,
                        reason: "Kick requested via message context"
                    });
                }
            });
        }

        if (contextMenu.message) {
            const isPinned = contextMenu.message.isPinned;
            items.push({
                label: isPinned ? "Unpin Message" : "Pin Message",
                icon: "📌",
                onClick: async () => {
                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                    if (isMasquerade) {
                        showToast(`Masquerade: Cannot ${isPinned ? "unpin" : "pin"} message.`, "error");
                        return;
                    }
                    try {
                        if (isPinned) {
                            const msg = contextMenu.message!;
                            await unpinMessage(msg.channelId, msg.id);
                            dispatch({
                                type: "UPDATE_MESSAGES",
                                payload: (current) => current.map(m => m.id === msg.id ? { ...m, isPinned: false } : m)
                            });
                            showToast("Message unpinned", "success");
                        } else {
                            const msg = contextMenu.message!;
                            await pinMessage(msg.channelId, msg.id);
                            dispatch({
                                type: "UPDATE_MESSAGES",
                                payload: (current) => current.map(m => m.id === msg.id ? { ...m, isPinned: true } : m)
                            });
                            showToast("Message pinned", "success");
                        }
                    } catch (e) {
                        showToast("Failed to update pin status", "error");
                    }
                }
            });
        }

        return items;
    }, [contextMenu, viewer, allowedActions, selectedServerId, showToast, dispatch]);

    const userContextMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!userContextMenu) return [];
        const isModerator = allowedActions.includes("moderation.kick") || allowedActions.includes("moderation.ban");
        const isSelf = userContextMenu.userId === viewer?.productUserId;

        const items: ContextMenuItem[] = [
            {
                label: "View Profile",
                icon: "👤",
                onClick: () => {
                    dispatch({ type: "SET_PROFILE_USER_ID", payload: userContextMenu.userId });
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: "profile" });
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
                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                    if (isMasquerade) {
                        showToast("Masquerade: Moderation is blocked.", "error");
                        return;
                    }
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
                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                    if (isMasquerade) {
                        showToast("Masquerade: Moderation is blocked.", "error");
                        return;
                    }
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
    }, [userContextMenu, viewer, allowedActions, selectedServerId, dispatch, showToast]);


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
            const isMasquerade = !!sessionStorage.getItem("masquerade_token");
            if (isMasquerade) {
                showToast("Masquerade: File uploads are local-only.", "error");
                throw new Error("Masquerade upload blocked");
            }
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
                                ? dmSubtitle || `${members.length} members`
                                : activeChannel
                                    ? `${messages.length} messages · slow mode ${activeChannel.slowModeSeconds}s`
                                    : "Select a channel to start chatting"}
                        </p>
                    </div>
                </div>
                <div className="channel-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
                        </div>
                    )}
                    {activeChannel?.type === "voice" && !voiceConnected && (
                        <button
                            type="button"
                            data-testid="join-voice-btn"
                            className="primary join-voice-btn"
                            style={{ padding: "0.3rem 0.8rem", fontSize: "0.85rem", height: "32px", marginLeft: "0.5rem" }}
                            onClick={() => handleJoinVoice()}
                        >
                            Join Voice Room
                        </button>
                    )}
                    <div 
                        data-testid="debug-voice-state" 
                        data-type={activeChannel?.type} 
                        data-voice-connected={String(voiceConnected)} 
                        data-error={state.error || 'none'}
                        style={{ opacity: 0, position: 'absolute', pointerEvents: 'none' }} 
                    />

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
                                className={`icon-button ${voiceScreenShareEnabled ? "active-toggle" : ""}`}
                                onClick={() => handleToggleScreenShare(!voiceScreenShareEnabled)}
                                title={voiceScreenShareEnabled ? "Stop Sharing" : "Share Screen"}
                            >
                                📺
                            </button>
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "voice-settings" })}
                                title="Voice Settings"
                            >
                                ⚙️
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
                        data-testid="toggle-member-list"
                        className={`icon-button ${isDetailsOpen ? "active-toggle" : ""}`}
                        title={isDetailsOpen ? "Hide Member List" : "Show Member List"}
                        onClick={() => dispatch({ type: "SET_DETAILS_OPEN", payload: !isDetailsOpen })}
                    >
                        👥
                    </button>
                </div>
            </header>

            <div className="chat-main-section">
                {selectedChannelId && (state.unreadCountByChannel[selectedChannelId] || 0) > 0 && !isNearBottom && (
                    <div className="unread-banner" onClick={handleJumpToUnread}>
                        You have unread messages. Click to jump to the first unread.
                    </div>
                )}

            {activeChannel?.type === "landing" ? (
                <LandingPageView channel={activeChannel} />
            ) : (
                <>
                    {activeChannel?.type === "voice" && voiceConnected && voiceGrant && (
                        <div className="voice-room-container">
                            <VoiceRoom
                                grant={voiceGrant}
                                muted={voiceMuted}
                                deafened={voiceDeafened}
                                videoEnabled={voiceVideoEnabled}
                                screenShareEnabled={voiceScreenShareEnabled}
                                onDisconnect={handleLeaveVoice}
                            />
                        </div>
                    )}


                    <ol className="messages" ref={messagesRef} onScroll={handleMessageListScroll}>
                        {[...renderedMessages].reverse().map(({ message, showHeader, showDateDivider }, index) => {
                            const mediaUrls = extractMediaUrls(message.content);

                            return (
                                <li key={message.id} id={`message-${message.id}`} className={state.highlightedMessageId === message.id ? "highlighted-message" : ""}>
                            {showDateDivider ? (
                                <div className="date-divider">
                                    <span>{new Date(message.createdAt).toLocaleDateString()}</span>
                                </div>
                            ) : null}

                            {message.replyToId && (
                                <div className="message-reply-indicator">
                                    <div className="reply-spine" />
                                    <span className="reply-prefix">Replying to</span>
                                    <span className="reply-author">
                                        @{messages.find(m => m.id === message.replyToId)?.authorDisplayName || 'deleted message'}
                                    </span>
                                    <span className="reply-preview">
                                        {messages.find(m => m.id === message.replyToId)?.content.slice(0, 50)}...
                                    </span>
                                </div>
                            )}

                            <article data-testid="message-item" className="message-item-container" onContextMenu={(e) => handleContextMenu(e, message)}>
                                {showHeader ? (
                                    <header>
                                        <strong
                                            className="author-name"
                                            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem" }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                dispatch({ type: "SET_PROFILE_USER_ID", payload: message.authorUserId });
                                                dispatch({ type: "SET_ACTIVE_MODAL", payload: "profile" });
                                            }}
                                            onContextMenu={(e) => handleUserContextMenu(e, message.authorUserId, message.externalAuthorName || message.authorDisplayName)}
                                        >
                                            {message.isRelay && (
                                                <div className="discord-relay-badge" title="Relayed from Discord" style={{ color: "#5865F2", display: "flex", alignItems: "center" }}>
                                                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z" />
                                                    </svg>
                                                </div>
                                            )}
                                            {message.externalAuthorName || message.authorDisplayName}
                                        </strong>
                                        <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                                        {message.isPinned && (
                                            <span className="pinned-indicator" title="Pinned Message" style={{ marginLeft: "0.5rem", fontSize: "0.8rem", opacity: 0.6 }}>
                                                📌
                                            </span>
                                        )}
                                    </header>
                                ) : null}
                                <div className="message-content-wrapper" style={{ position: "relative" }}>
                                    {/* Hover action bar */}
                                    <div className="message-hover-actions">
                                        <button
                                            type="button"
                                            className="hover-action-item"
                                            onClick={(e) => {
                                                const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                                                if (isMasquerade) {
                                                    showToast("Masquerade: Reactions are local-only.", "success");
                                                    return;
                                                }
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setReactionPickerPos({ x: rect.left, y: rect.bottom });
                                                setReactionTargetMessageId(message.id);
                                            }}
                                            title="Add Reaction"
                                        >
                                            😀
                                        </button>
                                        <button
                                            type="button"
                                            className="hover-action-item"
                                            onClick={() => {
                                                if ((activeChannelData?.type as string) === "forum") {
                                                    dispatch({ type: "SET_THREAD_PARENT_ID", payload: message.id });
                                                } else {
                                                    handleQuoteReply(message);
                                                }
                                            }}
                                            title="Reply"
                                        >
                                            ↩️
                                        </button>
                                        {message.authorUserId === viewer?.productUserId && (
                                            <button
                                                type="button"
                                                className="hover-action-item"
                                                onClick={() => {
                                                    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                                                    if (isMasquerade) {
                                                        showToast("Masquerade: Edits are local-only.", "success");
                                                        return;
                                                    }
                                                    setEditingMessageId(message.id);
                                                    setEditContent(message.content);
                                                }}
                                                title="Edit"
                                            >
                                                ✏️
                                            </button>
                                        )}
                                    </div>

                                    {editingMessageId === message.id ? (
                                        <div className="message-edit-inline" style={{ marginTop: "0.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                            <textarea
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && !e.shiftKey) {
                                                        e.preventDefault();
                                                        if (editContent.trim()) {
                                                            const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                                                            if (isMasquerade) {
                                                                showToast("Masquerade: Edit is local-only.", "success");
                                                                setEditingMessageId(null);
                                                                return;
                                                            }
                                                            void updateMessage(message.channelId, message.id, editContent).then(() => {
                                                                dispatch({
                                                                    type: "UPDATE_MESSAGES",
                                                                    payload: (current) => current.map(m => m.id === message.id ? { ...m, content: editContent, updatedAt: new Date().toISOString() } : m)
                                                                });
                                                                setEditingMessageId(null);
                                                            });
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
                                                        const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                                                        if (isMasquerade) {
                                                            showToast("Masquerade: Edit is local-only.", "success");
                                                            setEditingMessageId(null);
                                                            return;
                                                        }
                                                        void updateMessage(message.channelId, message.id, editContent).then(() => setEditingMessageId(null));
                                                    }
                                                }}>Save</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <MessageContent message={message} hiddenUrls={mediaUrls} />
                                            {message.updatedAt && <small className="message-meta-edited" style={{ fontSize: "0.75rem", opacity: 0.6 }}>(edited)</small>}
                                            {message.embeds && message.embeds.length > 0 && (
                                                <div className="message-embeds-container">
                                                    {message.embeds
                                                        .filter(embed => 
                                                            !mediaUrls.includes(embed.url) && 
                                                            !embed.url.includes("discordapp.com/emojis/") && 
                                                            !embed.url.includes("discordapp.net/emojis/")
                                                        )
                                                        .map((embed, i) => (
                                                            <EmbedCard key={i} embed={embed} />
                                                        ))
                                                    }
                                                </div>
                                            )}

                                            {/* Attachments rendering */}
                                            {message.attachments && message.attachments.length > 0 && (
                                                <div className="message-attachments-container">
                                                    {message.attachments.map((att) => {
                                                        const normalizedUrl = normalizeMediaUrl(att.url);
                                                        const finalUrl = getProxiedUrl(normalizedUrl);
                                                        const isActuallySticker = att.isSticker || normalizedUrl.includes("/stickers/");
                                                        const isLottie = normalizedUrl.endsWith(".json") || (att.sourceUrl?.split('?')[0]?.endsWith(".json") ?? false);
                                                        

                                                        
                                                        return (
                                                            <div key={att.id} className={`attachment ${isActuallySticker ? 'sticker' : ''}`}>
                                                                {isActuallySticker ? (
                                                                    <div className="sticker-container" style={{ 
                                                                        width: "160px", 
                                                                        height: "160px"
                                                                    }}>
                                                                        {isLottie ? (
                                                                            <LottieSticker url={normalizedUrl} />
                                                                        ) : (
                                                                            <GifPlayer 
                                                                                src={finalUrl} 
                                                                                alt={att.filename} 
                                                                                className="sticker-image"
                                                                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                                                                onClick={() => setLightboxUrl(finalUrl)}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="attachment-preview" style={{ cursor: "pointer" }} onClick={() => setLightboxUrl(finalUrl)}>
                                                                        {att.contentType?.startsWith("video") ? (
                                                                            <video src={finalUrl} controls style={{ maxWidth: "300px", maxHeight: "300px" }} />
                                                                        ) : (
                                                                            <GifPlayer 
                                                                                src={finalUrl} 
                                                                                alt={att.filename} 
                                                                                style={{ maxWidth: "300px", maxHeight: "300px" }} 
                                                                                onClick={() => setLightboxUrl(finalUrl)}
                                                                            />
                                                                        )}
                                                                        {!att.contentType?.startsWith("image/") && !att.contentType?.startsWith("video/") && (
                                                                            <div className="attachment-overlay">
                                                                                <span>{att.filename}</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Legacy media urls (from content) */}
                                            {mediaUrls.length > 0 && (
                                                <div className="message-attachments-container" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                                                    {mediaUrls.map((url, i) => {
                                                        const normalized = normalizeMediaUrl(url);
                                                        const isTenorView = normalized.includes("tenor.com/view");
                                                        const isGiphyView = normalized.includes("giphy.com/gifs");
                                                        
                                                        if (isTenorView || isGiphyView) {
                                                            const urlParts = normalized.split("/");
                                                            const lastPart = urlParts[urlParts.length - 1] || "";
                                                            const lastPartWithoutExt = lastPart.replace(/\.[^.]+$/, "");
                                                            const idMatch = lastPartWithoutExt.match(/-([a-zA-Z0-9]+)$|([a-zA-Z0-9]+)$/);
                                                            const id = idMatch ? (idMatch[1] || idMatch[2]) : lastPartWithoutExt;
                                                            
                                                            const embedUrl = isTenorView 
                                                                ? `https://tenor.com/embed/${id}`
                                                                : `https://giphy.com/embed/${id}`;
                                                            return (
                                                                <div key={i} className="attachment legacy-media" style={{ width: "100%", maxWidth: "400px" }}>
                                                                    <div className="embed-video-container" style={{ borderRadius: "8px", overflow: "hidden" }}>
                                                                        <iframe
                                                                            src={embedUrl}
                                                                            frameBorder="0"
                                                                            width="100%"
                                                                            height="300"
                                                                            allow="autoplay; encrypted-media"
                                                                            allowFullScreen
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        const finalUrl = getProxiedUrl(normalized);
                                                        return (
                                                            <div key={i} className="attachment legacy-media" style={{ maxWidth: "300px" }}>
                                                                <GifPlayer 
                                                                    src={finalUrl} 
                                                                    alt="Attachment" 
                                                                    style={{ maxWidth: "100%", maxHeight: "300px", borderRadius: "8px", cursor: "pointer" }} 
                                                                    onClick={() => setLightboxUrl(finalUrl)}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </>
                                    )}


                                    {/* Reactions rendering */}
                                    {message.reactions && message.reactions.length > 0 && (
                                        <div className="message-reactions-container" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
                                            {message.reactions.map((r: any) => (
                                                <button
                                                    key={r.emoji}
                                                    data-testid="reaction-badge"
                                                    title={r.displayNames ? r.displayNames.join(', ') : ''}
                                                    type="button"
                                                    className={`interaction-btn ${r.me ? "active" : ""}`}
                                                    style={{ padding: "1px 6px", borderRadius: "12px", border: "1px solid var(--border-color)", background: r.me ? "var(--accent-color-transparent)" : "var(--surface-color)", fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem" }}
                                                    onClick={() => {
                                                        const emoji = r.emoji;
                                                        const isMe = r.me;
                                                        
                                                        // Optimistic update
                                                        dispatch({
                                                            type: "UPDATE_MESSAGES",
                                                            payload: (current) => current.map(m => {
                                                                if (m.id !== message.id) return m;
                                                                const newReactions = (m.reactions || []).map(react => {
                                                                    if (react.emoji !== emoji) return react;
                                                                    return {
                                                                        ...react,
                                                                        count: isMe ? Math.max(0, react.count - 1) : react.count + 1,
                                                                        me: !isMe
                                                                    };
                                                                }).filter(react => react.count > 0);
                                                                return { ...m, reactions: newReactions };
                                                            })
                                                        });

                                                        if (isMe) {
                                                            void removeReaction(message.channelId, message.id, emoji);
                                                        } else {
                                                            void addReaction(message.channelId, message.id, emoji);
                                                        }
                                                    }}
                                                >
                                                    <ReactionEmoji emoji={r.emoji} />
                                                    <span style={{ fontWeight: 600, opacity: 0.8 }}>{r.count}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}


                                    {message.repliesCount ? (
                                        <button
                                            type="button"
                                            className="thread-trigger-btn"
                                            onClick={() => dispatch({ type: "SET_THREAD_PARENT_ID", payload: message.id })}
                                            style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--accent-color)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem", padding: 0 }}
                                        >
                                            <span style={{ opacity: 0.8 }}>💬</span>
                                            <span style={{ fontWeight: 600 }}>{message.repliesCount} {message.repliesCount === 1 ? 'reply' : 'replies'}</span>
                                        </button>
                                    ) : null}
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
            <TypingIndicator channelId={selectedChannelId!} />
        </>
    )}
</div>



            {
                contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        items={messageContextMenuItems}
                        onClose={() => setContextMenu(null)}
                    />
                )
            }

            {
                userContextMenu && (
                    <ContextMenu
                        x={userContextMenu.x}
                        y={userContextMenu.y}
                        items={userContextMenuItems}
                        onClose={() => setUserContextMenu(null)}
                    />
                )
            }

            {
                !isNearBottom && (
                    <div className="jump-latest">
                        <button type="button" onClick={jumpToLatest}>
                            {pendingNewMessageCount > 0 ? `Jump to latest (${pendingNewMessageCount})` : "Scroll to Present"}
                        </button>
                    </div>
                )
            }



            {activeChannel?.type !== "landing" && (
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
                    {quotingMessage && (
                        <div className="composer-quote-preview">
                            <div className="quote-info">
                                <strong>Replying to @{quotingMessage.externalAuthorName || quotingMessage.authorDisplayName}</strong>
                                <p>{quotingMessage.content.slice(0, 100)}{quotingMessage.content.length > 100 ? "..." : ""}</p>
                            </div>
                            <button
                                type="button"
                                className="close-button"
                                onClick={() => dispatch({ type: "SET_QUOTING_MESSAGE", payload: null })}
                            >
                                ×
                            </button>
                        </div>
                    )}
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
                                    // Clear typing immediately
                                    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                    void sendTypingStatus(selectedChannelId!, false);
                                    setLastTypingSentAt(0);
                                }
                            } else {
                                // Typing logic
                                const now = Date.now();
                                if (now - lastTypingSentAt > 8000) {
                                    void sendTypingStatus(selectedChannelId!, true);
                                    setLastTypingSentAt(now);
                                }
                                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                typingTimeoutRef.current = setTimeout(() => {
                                    void sendTypingStatus(selectedChannelId!, false);
                                    setLastTypingSentAt(0);
                                }, 5000);
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
            )}
            {/* Topic Edit Modal */}
            {
                isEditingTopic && (
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
                )
            }

            {/* Invite Modal */}
            {
                isInviting && (
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
                )
            }

            {lightboxUrl && (
                <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
                    <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>×</button>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <GifPlayer src={lightboxUrl} className="lightbox-image" alt="Full size" style={{ maxWidth: "90vw", maxHeight: "90vh" }} />
                    </div>
                </div>
            )}

            <style jsx>{`
            .highlighted-message {
                background: rgba(255, 255, 0, 0.15);
                transition: background 1.5s ease-out;
            }
            .unread-banner {
                background: #5865f2;
                color: white;
                padding: 0.5rem;
                text-align: center;
                cursor: pointer;
                font-size: 0.85rem;
                font-weight: 500;
                z-index: 10;
            }
            .unread-banner:hover {
                background: #4752c4;
            }
            .lightbox-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
                cursor: zoom-out;
                animation: fadeIn 0.2s ease-out;
                backdrop-filter: blur(4px);
            }
            .lightbox-image {
                max-width: 95vw;
                max-height: 95vh;
                object-fit: contain;
                box-shadow: 0 0 40px rgba(0,0,0,0.5);
                border-radius: 4px;
            }
            .lightbox-close {
                position: absolute;
                top: 2rem;
                right: 2rem;
                background: none;
                border: none;
                color: white;
                font-size: 2.5rem;
                cursor: pointer;
                opacity: 0.7;
                transition: opacity 0.2s;
            }
            .lightbox-close:hover {
                opacity: 1;
            }
            .message-reply-indicator {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-left: 36px;
                margin-bottom: 2px;
                font-size: 0.8rem;
                opacity: 0.6;
                position: relative;
            }
            .reply-spine {
                position: absolute;
                left: -18px;
                top: 0.6rem;
                width: 16px;
                height: 10px;
                border: 2px solid var(--border-color);
                border-right: none;
                border-bottom: none;
                border-top-left-radius: 4px;
            }
            .reply-prefix {
                font-style: italic;
            }
            .reply-author {
                font-weight: 600;
                color: var(--accent-color);
            }
            .reply-preview {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 300px;
            }
            .jump-latest {
                position: absolute;
                bottom: 5.5rem;
                left: 50%;
                transform: translateX(-50%);
                z-index: 20;
                animation: slide-up 0.2s ease-out;
            }
            .jump-latest button {
                background: var(--accent, #5865f2);
                color: white;
                border: none;
                border-radius: 20px;
                padding: 0.5rem 1rem;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: all 0.2s;
            }
            .jump-latest button:hover {
                background: var(--accent-hover, #4752c4);
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
            }
            @keyframes slide-up {
                from { transform: translate(-50%, 10px); opacity: 0; }
                to { transform: translate(-50%, 0); opacity: 1; }
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            `}</style>

            {
                reactionTargetMessageId && reactionPickerPos && (
                    <div
                        className="emoji-picker-container"
                        style={{
                            position: "fixed",
                            top: Math.min(reactionPickerPos.y, window.innerHeight - 450),
                            left: Math.min(reactionPickerPos.x, window.innerWidth - 350),
                            zIndex: 2000
                        }}
                    >
                        <EmojiPicker
                            theme={theme as any}
                            onEmojiClick={(data: EmojiClickData) => {
                                const emoji = data.emoji;
                                const targetId = reactionTargetMessageId;
                                
                                dispatch({
                                    type: "UPDATE_MESSAGES",
                                    payload: (current) => current.map(m => {
                                        if (m.id !== targetId) return m;
                                        const reactions = [...(m.reactions || [])];
                                        const existingIdx = reactions.findIndex(react => react && react.emoji === emoji);
                                        if (existingIdx > -1) {
                                            const react = reactions[existingIdx];
                                            if (react && !react.me) {
                                                reactions[existingIdx] = { ...react, count: react.count + 1, me: true, userIds: react.userIds || [], displayNames: react.displayNames || [] };
                                            }
                                        } else {
                                            reactions.push({ emoji, count: 1, me: true, userIds: [], displayNames: [] });
                                        }
                                        return { ...m, reactions };
                                    })
                                });

                                void addReaction(selectedChannelId!, targetId, emoji);
                                setReactionTargetMessageId(null);
                                setReactionPickerPos(null);
                            }}
                        />
                    </div>
                )
            }
        </section >
    );
}
