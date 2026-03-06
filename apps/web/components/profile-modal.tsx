"use client";

import React, { useState, useEffect } from "react";
import { useChat } from "../context/chat-context";
import { updateUserProfile, fetchViewerSession, controlPlaneBaseUrl, fetchUser } from "../lib/control-plane";
import { useToast } from "./toast-provider";
import type { IdentityMapping } from "@skerry/shared";

export function ProfileModal() {
    const { state, dispatch } = useChat();
    const { viewer, profileUserId } = state;
    const { showToast } = useToast();

    const isOwnProfile = profileUserId === viewer?.productUserId || !profileUserId;

    // For now, if it's not our own profile, we'll just show the info.
    // In a full implementation, we might fetch another user's profile.
    // Given the current architecture, we'll focus on the viewer's profile for editing.

    const [targetUser, setTargetUser] = useState<IdentityMapping | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [customStatus, setCustomStatus] = useState("");
    const [avatarUrl, setAvatarUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!profileUserId) {
            setTargetUser(null);
            return;
        }

        if (isOwnProfile) {
            if (viewer?.identity) {
                setDisplayName(viewer.identity.displayName || "");
                setBio(viewer.identity.bio || "");
                setCustomStatus(viewer.identity.customStatus || "");
                setAvatarUrl(viewer.identity.avatarUrl || "");
            }
        } else {
            setLoading(true);
            fetchUser(profileUserId)
                .then(user => {
                    setTargetUser(user);
                    setDisplayName(user.displayName || "");
                    setBio(user.bio || "");
                    setCustomStatus(user.customStatus || "");
                    setAvatarUrl(user.avatarUrl || "");
                })
                .catch(err => {
                    showToast("Failed to fetch user profile", "error");
                    console.error(err);
                })
                .finally(() => setLoading(false));
        }
    }, [profileUserId, isOwnProfile, viewer]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isOwnProfile) return;

        setSaving(true);
        try {
            await updateUserProfile({
                displayName: displayName || null,
                bio: bio || null,
                customStatus: customStatus || null,
                avatarUrl: avatarUrl || null
            });
            const nextViewer = await fetchViewerSession();
            dispatch({ type: "SET_VIEWER", payload: nextViewer });
            showToast("Profile updated successfully", "success");
            dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="stack">
                        <h2>{isOwnProfile ? "Edit Your Profile" : (targetUser?.displayName || "User Profile")}</h2>
                        {targetUser?.isBridged && (
                            <span className="badge bridged">
                                󰙯 Bridged from Discord
                            </span>
                        )}
                    </div>
                    <button className="icon-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
                        ✕
                    </button>
                </div>
                <form onSubmit={handleSave} className="stack">
                    <div className="field">
                        <label>Display Name</label>
                        <input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="How should people see you?"
                            disabled={!isOwnProfile || saving}
                            maxLength={80}
                        />
                    </div>
                    <div className="field">
                        <label>Avatar URL</label>
                        <input
                            value={avatarUrl}
                            onChange={(e) => setAvatarUrl(e.target.value)}
                            placeholder="https://..."
                            disabled={!isOwnProfile || saving}
                            type="url"
                        />
                    </div>
                    <div className="field">
                        <label>About Me</label>
                        <textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            placeholder="Tell us about yourself"
                            disabled={!isOwnProfile || saving}
                            maxLength={256}
                            rows={3}
                        />
                    </div>
                    <div className="field">
                        <label>Custom Status</label>
                        <input
                            value={customStatus}
                            onChange={(e) => setCustomStatus(e.target.value)}
                            placeholder={isOwnProfile ? "What's happening?" : ""}
                            disabled={!isOwnProfile || saving}
                            maxLength={128}
                        />
                    </div>

                    {!isOwnProfile && !loading && (
                        <div className="field">
                            <label>Provider</label>
                            <div className="provider-info">
                                {targetUser?.provider === "discord" ? "Discord" : "Skerry"}
                            </div>
                        </div>
                    )}

                    {isOwnProfile && (
                        <div className="modal-actions" style={{ marginTop: "1rem" }}>
                            <button type="submit" disabled={saving}>
                                {saving ? "Saving..." : "Save Changes"}
                            </button>
                            <button
                                type="button"
                                className="secondary"
                                onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </form>
            </div>
            <style jsx>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    backdrop-filter: blur(4px);
                }
                .modal-card {
                    background: var(--bg-surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 2rem;
                    width: 100%;
                    max-width: 480px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                }
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1.5rem;
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 1.5rem;
                }
                .field {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                }
                label {
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: var(--text-muted);
                }
                .badge {
                    font-size: 0.75rem;
                    padding: 0.25rem 0.5rem;
                    border-radius: 4px;
                    font-weight: 700;
                    text-transform: uppercase;
                }
                .badge.bridged {
                    background: #5865F2;
                    color: white;
                }
                .provider-info {
                    color: var(--text-muted);
                    font-size: 0.875rem;
                }
                input, textarea {
                    padding: 0.75rem;
                    border-radius: 6px;
                    border: 1px solid var(--border);
                    background: var(--bg-input);
                    color: var(--text-main);
                    width: 100%;
                }
                textarea {
                    resize: vertical;
                }
                .modal-actions {
                    display: flex;
                    gap: 1rem;
                    justify-content: flex-end;
                }
                button {
                    padding: 0.75rem 1.5rem;
                    border-radius: 6px;
                    border: none;
                    background: var(--primary);
                    color: white;
                    font-weight: 600;
                    cursor: pointer;
                }
                button.secondary {
                    background: transparent;
                    border: 1px solid var(--border);
                    color: var(--text-main);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .icon-button {
                    background: transparent;
                    border: none;
                    color: var(--text-muted);
                    font-size: 1.25rem;
                    padding: 0.5rem;
                }
            `}</style>
        </div>
    );
}
