"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { useChat, MessageItem } from "../context/chat-context";
import { listMessages, sendMessage, uploadMedia, formatMessageTime, connectMessageStream, deleteMessage, performModerationAction, updateMessage, addReaction, removeReaction, pinMessage, unpinMessage } from "../lib/control-plane";
import dynamic from "next/dynamic";

// @ts-ignore - emoji-picker-react types mismatch with Next.js dynamic
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false }) as any;
import type { EmojiClickData } from "emoji-picker-react";
import { useToast } from "./toast-provider";
import { ContextMenu, ContextMenuItem } from "./context-menu";

export function ThreadPanel() {
    const { state, dispatch } = useChat();
    const { threadParentId, selectedChannelId, viewer, theme, selectedServerId } = state;
    const { showToast } = useToast();

    const [parentMessage, setParentMessage] = useState<MessageItem | null>(null);
    const [replies, setReplies] = useState<MessageItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [attachments, setAttachments] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: MessageItem } | null>(null);
    const [userContextMenu, setUserContextMenu] = useState<{ x: number, y: number, userId: string, displayName: string } | null>(null);

    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [reactionTargetMessageId, setReactionTargetMessageId] = useState<string | null>(null);
    const [reactionPickerPos, setReactionPickerPos] = useState<{ x: number; y: number } | null>(null);

    const { allowedActions } = state;

    useEffect(() => {
        if (!threadParentId || !selectedChannelId) {
            setReplies([]);
            return;
        }

        setLoading(true);
        void listMessages(selectedChannelId, threadParentId)
            .then(setReplies)
            .catch(err => {
                console.error("Failed to load replies", err);
                showToast("Failed to load replies", "error");
            })
            .finally(() => setLoading(false));
    }, [threadParentId, selectedChannelId, showToast]);

    useEffect(() => {
        if (!threadParentId) {
            setParentMessage(null);
            return;
        }
        const parent = state.messages.find(m => m.id === threadParentId);
        if (parent) {
            setParentMessage(parent);
        }
    }, [threadParentId, state.messages]);

    useEffect(() => {
        if (!threadParentId || !selectedChannelId) return;

        const disconnect = connectMessageStream(selectedChannelId, {
            onMessageCreated: (message) => {
                if (message.parentId === threadParentId) {
                    setReplies(prev => {
                        if (prev.some(r => r.id === message.id)) return prev;
                        return [...prev, message];
                    });
                }
            },
            onMessageUpdated: (message) => {
                if (message.parentId === threadParentId) {
                    setReplies(prev => prev.map(r => r.id === message.id ? message : r));
                }
            },
            onMessageDeleted: (messageId) => {
                setReplies(prev => prev.filter(r => r.id !== messageId));
            }
        });

        return () => disconnect();
    }, [threadParentId, selectedChannelId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    }, [replies]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (reactionTargetMessageId && !target.closest(".emoji-picker-container") && !target.closest(".hover-action-item") && !target.closest(".interaction-btn")) {
                setReactionTargetMessageId(null);
                setReactionPickerPos(null);
            }
        };

        if (reactionTargetMessageId) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [reactionTargetMessageId]);

    const handleSendReply = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!draft.trim() && attachments.length === 0) return;
        if (!selectedChannelId || !threadParentId) return;

        setSending(true);
        try {
            const sent = await sendMessage(selectedChannelId, draft, attachments, threadParentId);
            setReplies(prev => {
                if (prev.some(r => r.id === sent.id)) return prev;
                return [...prev, sent];
            });
            
            // Optimistically update the parent message's repliesCount in the main store
            dispatch({
                type: "UPDATE_MESSAGES",
                payload: (current: MessageItem[]) => current.map(msg => 
                    msg.id === threadParentId 
                        ? { ...msg, repliesCount: (msg.repliesCount || 0) + 1 } 
                        : msg
                )
            });

            setDraft("");
            setAttachments([]);
        } catch (err) {
            showToast("Failed to send reply", "error");
        } finally {
            setSending(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedServerId) return;

        try {
            const res = await uploadMedia(selectedServerId, file);
            setAttachments(prev => [...prev, {
                id: `att_tmp_${Date.now()}`,
                url: res.url,
                contentType: file.type,
                filename: file.name
            }]);
        } catch (err) {
            showToast("Upload failed", "error");
        }
    };

    const handleUpdateMessage = async (messageId: string) => {
        if (!selectedChannelId || !editContent.trim()) return;
        try {
            const updated = await updateMessage(selectedChannelId, messageId, editContent);
            setReplies(prev => prev.map(m => m.id === messageId ? updated : m));
            if (parentMessage?.id === messageId) {
                setParentMessage(updated);
            }
            setEditingMessageId(null);
        } catch (err) {
            showToast("Failed to update message", "error");
        }
    };

    const handleAddReaction = async (emoji: string) => {
        if (!selectedChannelId || !reactionTargetMessageId) return;
        const targetId = reactionTargetMessageId;
        
        const updateFn = (m: MessageItem) => {
            if (m.id !== targetId) return m;
            const reactions = [...(m.reactions || [])];
            const existingIdx = reactions.findIndex(r => r && r.emoji === emoji);
            if (existingIdx > -1) {
                const r = reactions[existingIdx];
                if (r && !r.me) {
                    reactions[existingIdx] = { ...r, count: r.count + 1, me: true, userIds: r.userIds || [] };
                }
            } else {
                reactions.push({ emoji, count: 1, me: true, userIds: [] });
            }
            return { ...m, reactions };
        };

        setReplies(prev => prev.map(updateFn));
        if (parentMessage?.id === targetId) {
            setParentMessage(updateFn(parentMessage));
        }

        try {
            await addReaction(selectedChannelId, targetId, emoji);
            setReactionTargetMessageId(null);
        } catch (err) {
            showToast("Failed to add reaction", "error");
        }
    };

    const handleContextMenu = (event: React.MouseEvent, message: MessageItem) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, message });
    };

    const handleUserContextMenu = (event: React.MouseEvent, userId: string, displayName: string) => {
        event.preventDefault();
        event.stopPropagation();
        setUserContextMenu({ x: event.clientX, y: event.clientY, userId, displayName });
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
                    setReactionTargetMessageId(contextMenu.message.id);
                    setReactionPickerPos({ x: contextMenu.x, y: contextMenu.y });
                }
            },
            {
                label: "Reply in Thread",
                icon: "🧵",
                onClick: () => {
                    setDraft(prev => prev ? `${prev}\n` : "");
                    // Just focus composer
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
                    setEditingMessageId(contextMenu.message.id);
                    setEditContent(contextMenu.message.content);
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

                                const timeoutId = setTimeout(async () => {
                                    try {
                                        await deleteMessage(channelId, messageId);
                                        setReplies(current => current.filter((m) => m.id !== messageId));
                                        if (parentMessage?.id === messageId) {
                                            setParentMessage(null);
                                        }
                                    } catch (err) {
                                        showToast("Failed to delete message", "error");
                                    }
                                }, 5000);

                                showToast("Message deleted", "info", {
                                    label: "Undo",
                                    onClick: () => {
                                        clearTimeout(timeoutId);
                                        showToast("Deletion cancelled", "success");
                                    }
                                }, 5500);
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
                label: "Timeout User",
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
                        targetUserId: contextMenu.message.authorUserId,
                        timeoutSeconds: 3600,
                        reason: "Shadow mute requested via thread message"
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
                        serverId: selectedServerId || "",
                        targetUserId: contextMenu.message.authorUserId,
                        reason: "Kick requested via thread message"
                    });
                }
            });
        }

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
                        await unpinMessage(contextMenu.message.channelId, contextMenu.message.id);
                        const updateFn = (m: MessageItem) => m.id === contextMenu.message.id ? { ...m, isPinned: false } : m;
                        setReplies(prev => prev.map(updateFn));
                        if (parentMessage?.id === contextMenu.message.id) setParentMessage(updateFn(parentMessage));
                        showToast("Message unpinned", "success");
                    } else {
                        await pinMessage(contextMenu.message.channelId, contextMenu.message.id);
                        const updateFn = (m: MessageItem) => m.id === contextMenu.message.id ? { ...m, isPinned: true } : m;
                        setReplies(prev => prev.map(updateFn));
                        if (parentMessage?.id === contextMenu.message.id) setParentMessage(updateFn(parentMessage));
                        showToast("Message pinned", "success");
                    }
                } catch (e) {
                    showToast("Failed to update pin status", "error");
                }
            }
        });

        return items;
    }, [contextMenu, viewer, allowedActions, dispatch, showToast, parentMessage?.id, selectedServerId]);

    const userContextMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!userContextMenu) return [];
        const isSelf = userContextMenu.userId === viewer?.productUserId;
        const isModerator = allowedActions.includes("moderation.kick") || 
                           allowedActions.includes("moderation.ban");

        const items: ContextMenuItem[] = [
            {
                label: `Profile: ${userContextMenu.displayName}`,
                type: "header"
            },
            {
                label: "Mention",
                icon: "@",
                onClick: () => {
                    setDraft(prev => `${prev}@${userContextMenu.displayName} `);
                }
            }
        ];

        if (isModerator && !isSelf) {
            items.push({
                label: "Timeout User",
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
                        reason: "Shadow mute requested via thread user"
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
                        serverId: selectedServerId || "",
                        targetUserId: userContextMenu.userId,
                        reason: "Kick requested via thread user"
                    });
                }
            });
        }

        return items;
    }, [userContextMenu, viewer, allowedActions, selectedServerId, showToast]);

    if (!threadParentId) return null;

    return (
        <aside className="thread-panel panel">
            <header className="panel-header">
                <h2>Thread</h2>
                <button
                    type="button"
                    className="close-button"
                    onClick={() => dispatch({ type: "SET_THREAD_PARENT_ID", payload: null })}
                    aria-label="Close thread"
                >
                    &times;
                </button>
            </header>

            <div className="thread-content scrollable-pane" ref={scrollRef}>
                {parentMessage && (
                    <div className="thread-parent">
                        <article 
                            className="message parent-message"
                            onContextMenu={(e) => handleContextMenu(e, parentMessage)}
                        >
                            <header>
                                <strong 
                                    onClick={(e) => handleUserContextMenu(e, parentMessage.authorUserId, parentMessage.authorDisplayName)}
                                    style={{ cursor: "pointer" }}
                                >
                                    {parentMessage.externalAuthorName || parentMessage.authorDisplayName}
                                </strong>
                            <time>{formatMessageTime(parentMessage.createdAt)}</time>
                            </header>
                            {editingMessageId === parentMessage.id ? (
                                <div className="edit-composer" style={{ marginTop: "0.5rem" }}>
                                    <textarea 
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text)", padding: "0.5rem" }}
                                    />
                                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                                        <button onClick={() => handleUpdateMessage(parentMessage.id)} style={{ background: "var(--accent)", color: "white", border: "none", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>Save</button>
                                        <button onClick={() => setEditingMessageId(null)} style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <p className="message-content">
                                    <ReactMarkdown>{parentMessage.content}</ReactMarkdown>
                                </p>
                            )}
                            {parentMessage.isPinned && (
                                <div className="pinned-badge" style={{ fontSize: "0.7rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "0.25rem" }}>
                                    <span>📌</span> Pinned
                                </div>
                            )}
                            {parentMessage.attachments?.map(att => (
                                <div key={att.id} className="attachment" style={{ marginTop: "0.5rem" }}>
                                    {att.contentType.startsWith("video/") ? (
                                        <video src={att.url} controls style={{ maxWidth: "100%", borderRadius: "8px" }} />
                                    ) : (
                                        <img src={att.url} alt={att.filename} style={{ maxWidth: "100%", borderRadius: "8px" }} />
                                    )}
                                </div>
                            ))}
                            {parentMessage.reactions && parentMessage.reactions.length > 0 && (
                                <div className="reactions" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.5rem" }}>
                                    {parentMessage.reactions.map((r: any) => (
                                        <button
                                            key={r.emoji}
                                            className={`interaction-btn ${r.me ? "active" : ""}`}
                                            onClick={() => r.me ? removeReaction(parentMessage.channelId, parentMessage.id, r.emoji) : addReaction(parentMessage.channelId, parentMessage.id, r.emoji)}
                                        >
                                            <span>{r.emoji}</span>
                                            <span style={{ fontWeight: 600, opacity: 0.8 }}>{r.count}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </article>
                    </div>
                )}

                <div className="thread-divider">Replies</div>

                {loading ? (
                    <div className="loading" style={{ textAlign: "center", opacity: 0.5, padding: "2rem" }}>Loading replies...</div>
                ) : (
                    <ol className="replies-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {replies.filter(r => !state.pendingActionIds.has(r.id)).map(reply => (
                            <li key={reply.id}>
                                <article 
                                    className="message"
                                    onContextMenu={(e) => handleContextMenu(e, reply)}
                                >
                                    <header>
                                        <strong 
                                            onClick={(e) => handleUserContextMenu(e, reply.authorUserId, reply.authorDisplayName)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            {reply.externalAuthorName || reply.authorDisplayName}
                                        </strong>
                                        <time>{formatMessageTime(reply.createdAt)}</time>
                                    </header>
                                    {editingMessageId === reply.id ? (
                                        <div className="edit-composer" style={{ marginTop: "0.5rem" }}>
                                            <textarea 
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text)", padding: "0.5rem" }}
                                            />
                                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                                                <button onClick={() => handleUpdateMessage(reply.id)} style={{ background: "var(--accent)", color: "white", border: "none", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>Save</button>
                                                <button onClick={() => setEditingMessageId(null)} style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="message-content">
                                            <ReactMarkdown>{reply.content}</ReactMarkdown>
                                        </p>
                                    )}
                                    {reply.isPinned && (
                                        <div className="pinned-badge" style={{ fontSize: "0.7rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "0.25rem" }}>
                                            <span>📌</span> Pinned
                                        </div>
                                    )}
                                    {reply.attachments?.map(att => (
                                        <div key={att.id} className="attachment" style={{ marginTop: "0.5rem" }}>
                                            {att.contentType.startsWith("video/") ? (
                                                <video src={att.url} controls style={{ maxWidth: "100%", borderRadius: "8px" }} />
                                            ) : (
                                                <img src={att.url} alt={att.filename} style={{ maxWidth: "100%", borderRadius: "8px" }} />
                                            )}
                                        </div>
                                    ))}
                                    {reply.reactions && reply.reactions.length > 0 && (
                                        <div className="reactions" style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.5rem" }}>
                                            {reply.reactions.map((r: any) => (
                                                <button
                                                    key={r.emoji}
                                                    className={`interaction-btn ${r.me ? "active" : ""}`}
                                                    onClick={() => {
                                                        const emoji = r.emoji;
                                                        const isMe = r.me;
                                                        const updateFn = (m: MessageItem) => {
                                                            if (m.id !== reply.id) return m;
                                                            const newReactions = (m.reactions || []).map(react => {
                                                                if (react.emoji !== emoji) return react;
                                                                return {
                                                                    ...react,
                                                                    count: isMe ? Math.max(0, react.count - 1) : react.count + 1,
                                                                    me: !isMe
                                                                };
                                                            }).filter(react => react.count > 0);
                                                            return { ...m, reactions: newReactions };
                                                        };
                                                        
                                                        setReplies(prev => prev.map(updateFn));
                                                        if (parentMessage?.id === reply.id) setParentMessage(updateFn(parentMessage));

                                                        if (isMe) {
                                                            void removeReaction(reply.channelId, reply.id, emoji);
                                                        } else {
                                                            void addReaction(reply.channelId, reply.id, emoji);
                                                        }
                                                    }}
                                                >
                                                    <span>{r.emoji}</span>
                                                    <span style={{ fontWeight: 600, opacity: 0.8 }}>{r.count}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </article>
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            <form className="thread-composer" onSubmit={handleSendReply}>
                <div className="thread-input-wrapper">
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder="Reply to thread..."
                        onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleSendReply();
                            }
                        }}
                    />
                    <div className="thread-composer-actions">
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: "none" }}
                            onChange={handleFileUpload}
                            accept="image/*"
                        />
                        <button type="button" className="thread-icon-button" onClick={() => fileInputRef.current?.click()}>
                            📎
                        </button>
                        <button type="submit" className="thread-send-button" disabled={sending || (!draft.trim() && attachments.length === 0)}>
                            {sending ? "..." : "Send"}
                        </button>
                    </div>
                </div>
                {attachments.length > 0 && (
                    <div className="attachments-preview">
                        {attachments.map(att => (
                            <div key={att.id} className="attachment-preview">
                                <img src={att.url} alt="preview" />
                                <button type="button" onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}>×</button>
                            </div>
                        ))}
                    </div>
                )}
            </form>

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

            {reactionTargetMessageId && reactionPickerPos && (
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
                        theme={theme}
                        onEmojiClick={(data: EmojiClickData) => handleAddReaction(data.emoji)} 
                    />
                    <div 
                        className="emoji-picker-backdrop"
                        onClick={() => setReactionTargetMessageId(null)}
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }}
                    />
                </div>
            )}

            <style jsx>{`
                .thread-panel {
                    display: flex;
                    flex-direction: column;
                    background: var(--surface);
                    border-left: 1px solid var(--border);
                    overflow: hidden;
                    height: 100%;
                }
                .panel-header {
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--surface-alt);
                }
                .panel-header h2 {
                    margin: 0;
                    font-size: 1rem;
                    font-weight: 600;
                }
                .close-button {
                    background: transparent;
                    border: none;
                    font-size: 1.25rem;
                    cursor: pointer;
                    color: var(--text-muted);
                    padding: 0.25rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    transition: background 0.2s;
                }
                .close-button:hover {
                    background: var(--border);
                    color: var(--text);
                }
                .thread-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1rem;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .thread-parent {
                    padding-bottom: 1rem;
                    border-bottom: 1px solid var(--border);
                }
                .thread-divider {
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    margin: 0.5rem 0;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    font-weight: 600;
                }
                .thread-divider::after {
                    content: "";
                    flex: 1;
                    height: 1px;
                    background: var(--border);
                }
                .replies-list {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .message {
                    background: var(--surface-alt);
                    padding: 0.75rem;
                    border-radius: 0.75rem;
                    border: 1px solid var(--border);
                }
                .message header {
                    display: flex;
                    gap: 0.5rem;
                    align-items: baseline;
                    margin-bottom: 0.25rem;
                }
                .message header strong {
                    font-size: 0.9rem;
                    color: var(--text);
                }
                .message time {
                    font-size: 0.7rem;
                    color: var(--text-muted);
                }
                .message p {
                    margin: 0;
                    font-size: 0.95rem;
                    line-height: 1.4;
                    color: var(--text);
                    word-break: break-word;
                }
                .thread-composer {
                    padding: 1rem;
                    border-top: 1px solid var(--border);
                    background: var(--surface-alt);
                }
                .thread-input-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 0.75rem;
                    padding: 0.5rem;
                }
                .thread-input-wrapper textarea {
                    width: 100%;
                    background: transparent;
                    border: none;
                    padding: 0.25rem;
                    color: var(--text);
                    resize: none;
                    min-height: 60px;
                    font-family: inherit;
                    font-size: 0.9rem;
                }
                .thread-input-wrapper textarea:focus {
                    outline: none;
                }
                .thread-composer-actions {
                    display: flex;
                    flex-direction: row;
                    justify-content: flex-end;
                    align-items: center;
                    gap: 0.5rem;
                }
                .thread-icon-button {
                    background: transparent;
                    border: none;
                    font-size: 1.1rem;
                    cursor: pointer;
                    padding: 0.25rem;
                    border-radius: 4px;
                    transition: background 0.2s;
                }
                .thread-icon-button:hover {
                    background: var(--surface-alt);
                }
                .thread-send-button {
                    background: var(--accent);
                    color: white;
                    border: none;
                    padding: 0.4rem 1rem;
                    border-radius: 0.5rem;
                    font-weight: 600;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .thread-send-button:hover:not(:disabled) {
                    background: var(--accent-strong);
                }
                .thread-send-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .attachments-preview {
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.5rem;
                    flex-wrap: wrap;
                }
                .attachment-preview {
                    position: relative;
                    width: 60px;
                    height: 60px;
                }
                .attachment-preview img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 0.5rem;
                    border: 1px solid var(--border);
                }
                .attachment-preview button {
                    position: absolute;
                    top: -6px;
                    right: -6px;
                    background: var(--danger);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 18px;
                    height: 18px;
                    font-size: 10px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
            `}</style>
        </aside>
    );
}
