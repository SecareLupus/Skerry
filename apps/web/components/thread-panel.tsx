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
                        <article className="message parent-message">
                            <header>
                                <strong>{parentMessage.externalAuthorName || parentMessage.authorDisplayName}</strong>
                                <time>{formatMessageTime(parentMessage.createdAt)}</time>
                            </header>
                            <p>{parentMessage.content}</p>
                            {parentMessage.attachments?.map(att => (
                                <div key={att.id} className="attachment">
                                    <img src={att.url} alt={att.filename} style={{ maxWidth: "100%", borderRadius: "8px", marginTop: "0.5rem" }} />
                                </div>
                            ))}
                        </article>
                    </div>
                )}

                <div className="thread-divider">Replies</div>

                {loading ? (
                    <div className="loading" style={{ textAlign: "center", opacity: 0.5, padding: "2rem" }}>Loading replies...</div>
                ) : (
                    <ol className="replies-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {replies.map(reply => (
                            <li key={reply.id}>
                                <article className="message">
                                    <header>
                                        <strong>{reply.externalAuthorName || reply.authorDisplayName}</strong>
                                        <time>{formatMessageTime(reply.createdAt)}</time>
                                    </header>
                                    <p>{reply.content}</p>
                                    {reply.attachments?.map(att => (
                                        <div key={att.id} className="attachment">
                                            <img src={att.url} alt={att.filename} style={{ maxWidth: "100%", borderRadius: "8px", marginTop: "0.5rem" }} />
                                        </div>
                                    ))}
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
