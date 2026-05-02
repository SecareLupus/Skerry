"use client";

import React, { useState, useEffect } from "react";
import { useChat, useChatHandlers } from "../context/chat-context";
import { searchUsers, createDirectMessage } from "../lib/control-plane";
import { IdentityMapping } from "../lib/control-plane";

export function DMPickerModal() {
    const { state, dispatch } = useChat();
    const { handleServerChange } = useChatHandlers();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<IdentityMapping[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }

        const timeout = setTimeout(async () => {
            setLoading(true);
            setError(null);
            try {
                const users = await searchUsers(query);
                setResults(users);
            } catch (err) {
                console.error("Search failed:", err);
                setError("Failed to search users.");
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [query]);

    const handleSelectUser = async (user: IdentityMapping) => {
        if (!state.bootstrapStatus?.bootstrapHubId) return;

        setLoading(true);
        try {
            const channel = await createDirectMessage(state.bootstrapStatus.bootstrapHubId, [user.productUserId]);

            // Optimistically seed the DM into local state so the sidebar shows it
            // immediately and refreshChatState's channel-membership check succeeds
            // even if listChannels lags the just-committed write.
            dispatch({ type: "ADD_DM_CHANNEL", payload: channel });
            dispatch({ type: "SET_ACTIVE_MODAL", payload: null });

            const dmServerId = state.servers.find(s => s.type === 'dm')?.id ?? channel.serverId;
            if (dmServerId) {
                await handleServerChange(dmServerId, channel.id);
            }
        } catch (err) {
            console.error("Failed to create DM:", err);
            setError("Failed to start conversation.");
        } finally {
            setLoading(false);
        }
    };

    if (state.activeModal !== "dm-picker") return null;

    return (
        <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div className="modal-content dm-picker-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-header">
                    <h2>New Direct Message</h2>
                    <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>×</button>
                </header>

                <div className="modal-body">
                    <div className="search-input-wrapper">
                        <input
                            type="text"
                            placeholder="Type a username..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                            className="search-input"
                        />
                    </div>

                    {loading && <div className="loading-state">Searching...</div>}
                    {error && <div className="error-message">{error}</div>}

                    <ul className="user-results-list">
                        {results.map((user) => (
                            <li key={user.productUserId} className="user-result-item" onClick={() => handleSelectUser(user)}>
                                <div className="user-avatar-placeholder">
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt="" />
                                    ) : (
                                        (user.displayName ?? "U").charAt(0).toUpperCase()
                                    )}
                                </div>
                                <div className="user-info">
                                    <span className="display-name">{user.displayName ?? "Unknown User"}</span>
                                    {user.matrixUserId && <span className="matrix-id">{user.matrixUserId}</span>}
                                </div>
                            </li>
                        ))}
                        {!loading && query && results.length === 0 && (
                            <li className="no-results">No users found for &quot;{query}&quot;</li>
                        )}
                    </ul>
                </div>
            </div>

            <style jsx>{`
                .modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 3000;
                    padding: 1rem;
                }
                .modal-content {
                    display: flex;
                    flex-direction: column;
                    max-height: 80vh;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                }
                .modal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--border);
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 1rem;
                    color: var(--text);
                }
                .close-button {
                    background: transparent;
                    border: 0;
                    color: var(--text-muted);
                    font-size: 1.25rem;
                    cursor: pointer;
                    padding: 0.25rem 0.5rem;
                }
                .modal-body {
                    overflow-y: auto;
                }
                .dm-picker-modal {
                    width: 100%;
                    max-width: 440px;
                    background: var(--surface);
                    color: var(--text);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    overflow: hidden;
                }
                .search-input-wrapper {
                    padding: 1rem;
                    border-bottom: 1px solid var(--border);
                }
                .search-input {
                    width: 100%;
                    padding: 0.75rem;
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    font-size: 1rem;
                    background: var(--surface-alt);
                    color: var(--text);
                }
                .user-results-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .user-result-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 0.75rem 1rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .user-result-item:hover {
                    background: var(--surface-alt);
                }
                .user-avatar-placeholder {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--accent);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    overflow: hidden;
                    font-size: 14px;
                }
                .user-avatar-placeholder img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .user-info {
                    display: flex;
                    flex-direction: column;
                }
                .display-name {
                    font-weight: 500;
                    color: var(--text);
                }
                .matrix-id {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                }
                .no-results, .loading-state {
                    padding: 2rem;
                    text-align: center;
                    color: var(--text-muted);
                }
                .error-message {
                    padding: 0.5rem 1rem;
                    color: var(--danger);
                    font-size: 0.875rem;
                }
            `}</style>
        </div>
    );
}
