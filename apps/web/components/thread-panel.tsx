"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useChat, MessageItem } from "../context/chat-context";
import { listMessages, sendMessage, uploadMedia, formatMessageTime, connectMessageStream } from "../lib/control-plane";
import { useToast } from "./toast-provider";

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

    useEffect(() => {
        if (!threadParentId || !selectedChannelId) {
            setParentMessage(null);
            setReplies([]);
            return;
        }

        setLoading(true);
        // Find parent in existing messages or fetch it? 
        // For now, let's assume it's in the state's messages list
        const parent = state.messages.find(m => m.id === threadParentId);
        setParentMessage(parent || null);

        void listMessages(selectedChannelId, threadParentId)
            .then(setReplies)
            .catch(err => {
                console.error("Failed to load replies", err);
                showToast("Failed to load replies", "error");
            })
            .finally(() => setLoading(false));
    }, [threadParentId, selectedChannelId, state.messages]);

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
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [replies]);

    const handleSendReply = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!draft.trim() && attachments.length === 0) return;
        if (!selectedChannelId || !threadParentId) return;

        setSending(true);
        try {
            const sent = await sendMessage(selectedChannelId, draft, attachments, threadParentId);
            setReplies(prev => [...prev, sent]);
            setDraft("");
            setAttachments([]);
            // Also update parent repliesCount in main state if possible? 
            // Better to let realtime handle it, but for immediate feedback:
            dispatch({
                type: "UPDATE_MESSAGES",
                payload: (current) => current.map(m =>
                    m.id === threadParentId ? { ...m, repliesCount: (m.repliesCount || 0) + 1 } : m
                )
            });
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

    if (!threadParentId) return null;

    return (
        <aside className="thread-panel panel">
            <header className="panel-header">
                <h3>Thread</h3>
                <button
                    type="button"
                    className="icon-button"
                    onClick={() => dispatch({ type: "SET_THREAD_PARENT_ID", payload: null })}
                >
                    ×
                </button>
            </header>

            <div className="thread-content" ref={scrollRef}>
                {parentMessage && (
                    <div className="thread-parent">
                        <article className="message parent-message">
                            <header>
                                <strong>{parentMessage.externalAuthorName || parentMessage.authorDisplayName}</strong>
                                <time>{formatMessageTime(parentMessage.createdAt)}</time>
                            </header>
                            <p>{parentMessage.content}</p>
                        </article>
                        <div className="thread-divider">Replies</div>
                    </div>
                )}

                {loading ? (
                    <div className="loading">Loading replies...</div>
                ) : (
                    <ol className="replies-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {replies.map(reply => (
                            <li key={reply.id} style={{ marginBottom: "1rem" }}>
                                <article className="message">
                                    <header>
                                        <strong>{reply.externalAuthorName || reply.authorDisplayName}</strong>
                                        <time>{formatMessageTime(reply.createdAt)}</time>
                                    </header>
                                    <p>{reply.content}</p>
                                    {reply.attachments?.map(att => (
                                        <div key={att.id} className="attachment">
                                            <img src={att.url} alt={att.filename} style={{ maxWidth: "100%", borderRadius: "4px" }} />
                                        </div>
                                    ))}
                                </article>
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            <form className="thread-composer composer" onSubmit={handleSendReply}>
                <div className="input-wrapper">
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
                    <div className="composer-actions">
                        <button type="button" className="icon-button" onClick={() => fileInputRef.current?.click()}>
                            📎
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: "none" }}
                            onChange={handleFileUpload}
                            accept="image/*"
                        />
                        <button type="submit" disabled={sending || (!draft.trim() && attachments.length === 0)}>
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

            <style jsx>{`
                .thread-panel {
                    flex: 0 0 350px;
                    border-left: 1px solid var(--border-color);
                    display: flex;
                    flex-direction: column;
                    background: var(--bg-primary);
                }
                .panel-header {
                    padding: 1rem;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .thread-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1rem;
                }
                .thread-parent {
                    margin-bottom: 1.5rem;
                    padding-bottom: 1rem;
                    border-bottom: 1px solid var(--border-color);
                }
                .thread-divider {
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    opacity: 0.6;
                    margin: 1rem 0;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                }
                .thread-divider::after {
                    content: "";
                    flex: 1;
                    height: 1px;
                    background: var(--border-color);
                }
                .message header {
                    display: flex;
                    gap: 0.5rem;
                    align-items: baseline;
                    margin-bottom: 0.25rem;
                }
                .message time {
                    font-size: 0.75rem;
                    opacity: 0.6;
                }
                .thread-composer {
                    padding: 1rem;
                    border-top: 1px solid var(--border-color);
                }
                .input-wrapper textarea {
                    width: 100%;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    padding: 0.5rem;
                    color: var(--text-primary);
                    resize: none;
                    min-height: 60px;
                }
                .composer-actions {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 0.5rem;
                }
                .attachments-preview {
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.5rem;
                }
                .attachment-preview {
                    position: relative;
                    width: 50px;
                    height: 50px;
                }
                .attachment-preview img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 4px;
                }
                .attachment-preview button {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: rgba(0,0,0,0.5);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 15px;
                    height: 15px;
                    font-size: 10px;
                    cursor: pointer;
                }
            `}</style>
        </aside>
    );
}
