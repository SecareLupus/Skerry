"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "../context/chat-context";
import { searchMessages } from "../lib/control-plane";
import type { ChatMessage } from "@skerry/shared";

export function SearchModal() {
    const { state, dispatch } = useChat();
    const { searchQuery, searchResults, isSearching, selectedChannelId, selectedServerId } = state;
    const [scope, setScope] = useState<"channel" | "server">("channel");

    const handleSearch = useCallback(async (query: string, currentScope: "channel" | "server") => {
        if (!query.trim()) {
            dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
            return;
        }

        dispatch({ type: "SET_IS_SEARCHING", payload: true });
        try {
            const results = await searchMessages({
                query,
                channelId: currentScope === "channel" ? selectedChannelId ?? undefined : undefined,
                serverId: currentScope === "server" ? selectedServerId ?? undefined : undefined,
                limit: 20
            });
            dispatch({ type: "SET_SEARCH_RESULTS", payload: results });
        } catch (err) {
            console.error("Search failed:", err);
        } finally {
            dispatch({ type: "SET_IS_SEARCHING", payload: false });
        }
    }, [selectedChannelId, selectedServerId, dispatch]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            if (state.activeModal === "search") {
                handleSearch(searchQuery, scope);
            }
        }, 300);
        return () => clearTimeout(timeout);
    }, [searchQuery, scope, handleSearch, state.activeModal]);

    const handleJump = (msg: ChatMessage) => {
        // Close search
        dispatch({ type: "SET_ACTIVE_MODAL", payload: null });

        // Trigger navigation/highlighting
        // This will be handled by ChatClient watching the URL or a separate effect
        const next = new URLSearchParams(window.location.search);
        next.set("channel", msg.channelId);
        next.set("message", msg.id);

        // We might need to find the server ID for the channel if it's different from current
        // For now assume same server if it was channel search, or we might need a lookup.
        window.history.pushState({}, "", `${window.location.pathname}?${next.toString()}`);

        // Trigger a custom event or just let ChatClient's searchParams effect handle it
        window.dispatchEvent(new Event("popstate"));
    };

    if (state.activeModal !== "search") return null;

    return (
        <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div className="modal-content search-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-header">
                    <h2>Search Messages</h2>
                    <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>×</button>
                </header>

                <div className="modal-body">
                    <div className="search-controls">
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                placeholder="Search for messages..."
                                value={searchQuery}
                                onChange={(e) => dispatch({ type: "SET_SEARCH_QUERY", payload: e.target.value })}
                                autoFocus
                                className="search-input"
                            />
                        </div>
                        <div className="scope-selector">
                            <button
                                className={`scope-button ${scope === "channel" ? "active" : ""}`}
                                onClick={() => setScope("channel")}
                            >
                                This Channel
                            </button>
                            <button
                                className={`scope-button ${scope === "server" ? "active" : ""}`}
                                onClick={() => setScope("server")}
                            >
                                Entire Space
                            </button>
                        </div>
                    </div>

                    {isSearching && <div className="loading-state">Searching...</div>}

                    <div className="results-container">
                        {searchResults.map((msg) => (
                            <div key={msg.id} className="search-result-item" onClick={() => handleJump(msg)}>
                                <div className="result-meta">
                                    <span className="author">{msg.authorDisplayName}</span>
                                    <span className="date">{new Date(msg.createdAt).toLocaleDateString()}</span>
                                </div>
                                <div className="result-content">
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {!isSearching && searchQuery && searchResults.length === 0 && (
                            <div className="no-results">No messages found for &quot;{searchQuery}&quot;</div>
                        )}
                    </div>
                </div>
            </div>

            <style jsx>{`
                .modal-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 3000;
                    backdrop-filter: blur(8px);
                    padding: 1rem;
                }
                .search-modal {
                    width: 100%;
                    max-width: 600px;
                    background: var(--surface, #ffffff);
                    border: 1px solid var(--border, #ccc);
                    border-radius: 12px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    max-height: 80vh;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    animation: modal-enter 0.2s ease-out;
                }
                @keyframes modal-enter {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .modal-header {
                    padding: 1rem;
                    background: var(--surface-alt, #f9f9f9);
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    color: var(--text);
                }
                .close-button {
                    background: transparent;
                    border: none;
                    color: var(--text-muted);
                    font-size: 1.5rem;
                    cursor: pointer;
                    line-height: 1;
                }
                .modal-body {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    overflow: hidden;
                }
                .search-controls {
                    padding: 1rem;
                    border-bottom: 1px solid var(--border-color, #eee);
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .search-input-wrapper {
                    position: relative;
                }
                .search-input {
                    width: 100%;
                    padding: 0.75rem;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    font-size: 1rem;
                    background: var(--surface-alt, #fff);
                    color: var(--text, #333);
                }
                .scope-selector {
                    display: flex;
                    gap: 0.5rem;
                }
                .scope-button {
                    padding: 0.4rem 0.8rem;
                    border-radius: 6px;
                    border: 1px solid var(--border);
                    background: transparent;
                    cursor: pointer;
                    font-size: 0.85rem;
                    color: var(--text-muted, #666);
                    transition: all 0.2s;
                }
                .scope-button:hover {
                    background: var(--surface-alt);
                }
                .scope-button.active {
                    background: var(--accent, #5865f2);
                    color: white;
                    border-color: var(--accent);
                }
                .results-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0.5rem;
                }
                .search-result-item {
                    padding: 0.75rem 1rem;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.2s;
                    border-bottom: 1px solid var(--border);
                }
                .search-result-item:hover {
                    background: var(--surface-alt);
                }
                .result-meta {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.75rem;
                    color: var(--text-muted, #888);
                    margin-bottom: 0.25rem;
                }
                .author {
                    font-weight: 600;
                    color: var(--text);
                }
                .result-content {
                    font-size: 0.9rem;
                    color: var(--text);
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                .loading-state, .no-results {
                    padding: 2rem;
                    text-align: center;
                    color: var(--text-muted, #666);
                }
            `}</style>
        </div>
    );
}
