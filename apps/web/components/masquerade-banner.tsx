"use client";

import React from "react";
import { useChat } from "../context/chat-context";
import { unmasquerade } from "../lib/control-plane";
import { useToast } from "./toast-provider";

export function MasqueradeBanner() {
    const { state } = useChat();
    const { viewer } = state;
    const { showToast } = useToast();

    if (!viewer?.isMasquerading) {
        return null;
    }

    const handleStop = async () => {
        try {
            // Remove token from session storage if present
            if (typeof window !== "undefined") {
                window.sessionStorage.removeItem("masquerade_token");
            }
            await unmasquerade();
            showToast("Masquerade ended. Restoring session...", "success");
            window.location.reload();
        } catch (err) {
            showToast(`Failed to stop masquerade: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
    };

    return (
        <div className="masquerade-banner">
            <div className="masquerade-content">
                <span className="masquerade-icon">🎭</span>
                <span>
                    <strong>Masquerade Active:</strong> 
                    {viewer.masqueradeRole ? (
                        <>
                            {" "}viewing as <span className="masquerade-target">{viewer.masqueradeRole.replace(/_/g, " ")}</span>
                            {viewer.masqueradeServerId && <span> for Server {viewer.masqueradeServerId}</span>}
                            {viewer.masqueradeBadgeIds && viewer.masqueradeBadgeIds.length > 0 && (
                                <span> with {viewer.masqueradeBadgeIds.length} badge(s)</span>
                            )}
                        </>
                    ) : (
                        <>
                            {" "}viewing as <span className="masquerade-target"> {viewer.identity?.displayName || viewer.identity?.preferredUsername || viewer.productUserId}</span>
                        </>
                    )}
                    <span className="masquerade-note"> (Read-only mode)</span>
                </span>
            </div>
            <button className="masquerade-stop-btn" onClick={handleStop}>
                Stop Masquerading
            </button>

            <style jsx>{`
                .masquerade-banner {
                    background: var(--warning);
                    color: #000;
                    padding: 0.5rem 1rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 0.85rem;
                    position: sticky;
                    top: 0;
                    z-index: 10000;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    border-bottom: 1px solid rgba(0,0,0,0.1);
                }
                .masquerade-content {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }
                .masquerade-icon {
                    font-size: 1.25rem;
                }
                .masquerade-target {
                    font-weight: 700;
                    margin-left: 0.25rem;
                }
                .masquerade-note {
                    opacity: 0.8;
                    font-style: italic;
                    margin-left: 0.5rem;
                }
                .masquerade-stop-btn {
                    background: #000;
                    color: #fff;
                    border: none;
                    padding: 0.35rem 0.75rem;
                    border-radius: 4px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: opacity 0.2s;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .masquerade-stop-btn:hover {
                    opacity: 0.8;
                }
            `}</style>
        </div>
    );
}
