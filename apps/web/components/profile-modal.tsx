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

    const [targetUser, setTargetUser] = useState<IdentityMapping | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [customStatus, setCustomStatus] = useState("");
    const [avatarUrl, setAvatarUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

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
            setIsEditing(false);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to update profile", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="profile-header">
                    <div className="banner" style={{
                        backgroundImage: avatarUrl ? `url(${avatarUrl})` : 'none',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(10px) brightness(0.7)'
                    }} />
                    <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
                        ✕
                    </button>

                    <div className="avatar-container">
                        <div className="avatar-ring">
                            {avatarUrl ? (
                                <img src={avatarUrl} alt={displayName} className="profile-avatar" />
                            ) : (
                                <div className="avatar-placeholder">
                                    {(displayName || targetUser?.preferredUsername || viewer?.identity?.preferredUsername || "U").charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="profile-content">
                    <div className="identity-section">
                        <div className="name-row">
                            <h1>{displayName || "User Profile"}</h1>
                            {((targetUser as any)?.isBridged || (isOwnProfile && (viewer?.identity as any)?.isBridged)) && (
                                <span className="badge bridged" title="Bridged from Discord">
                                    󰙯
                                </span>
                            )}
                        </div>
                        <p className="username">@{isOwnProfile ? viewer?.identity?.preferredUsername : targetUser?.preferredUsername}</p>
                    </div>

                    {isEditing ? (
                        <form onSubmit={handleSave} className="edit-form stack">
                            <div className="field">
                                <label>Display Name</label>
                                <input
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="How should people see you?"
                                    disabled={saving}
                                    maxLength={80}
                                />
                            </div>
                            <div className="field">
                                <label>Avatar URL</label>
                                <input
                                    value={avatarUrl}
                                    onChange={(e) => setAvatarUrl(e.target.value)}
                                    placeholder="https://..."
                                    disabled={saving}
                                    type="url"
                                />
                            </div>
                            <div className="field">
                                <label>About Me</label>
                                <textarea
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Tell us about yourself"
                                    disabled={saving}
                                    maxLength={256}
                                    rows={3}
                                />
                            </div>
                            <div className="field">
                                <label>Custom Status</label>
                                <input
                                    value={customStatus}
                                    onChange={(e) => setCustomStatus(e.target.value)}
                                    placeholder="What's happening?"
                                    disabled={saving}
                                    maxLength={128}
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="submit" disabled={saving}>
                                    {saving ? "Saving..." : "Save Changes"}
                                </button>
                                <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => setIsEditing(false)}
                                    disabled={saving}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="view-mode stack">
                            {customStatus && (
                                <div className="status-box">
                                    <span className="status-text">“{customStatus}”</span>
                                </div>
                            )}

                            <div className="info-block">
                                <label>About</label>
                                <p className="bio-text">{bio || "No bio yet."}</p>
                            </div>

                            <div className="info-meta">
                                <div className="meta-item">
                                    <label>Platform</label>
                                    <span>{targetUser?.provider === "discord" || (isOwnProfile && viewer?.identity?.provider === "discord") ? "Discord Bridge" : "Skerry Native"}</span>
                                </div>
                                {!isOwnProfile && targetUser?.id && (
                                    <div className="meta-item">
                                        <label>User ID</label>
                                        <span className="monospace">{targetUser.id}</span>
                                    </div>
                                )}
                            </div>

                            {isOwnProfile && (
                                <div className="modal-actions">
                                    <button onClick={() => setIsEditing(true)}>
                                        Edit Profile
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
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
                    backdrop-filter: blur(8px);
                    padding: 1rem;
                }
                .modal-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    width: 100%;
                    max-width: 440px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                    animation: modal-enter 0.3s ease-out;
                }
                @keyframes modal-enter {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }

                .profile-header {
                    height: 140px;
                    position: relative;
                    background: var(--bg-strong);
                }
                .banner {
                    position: absolute;
                    inset: 0;
                    background-color: var(--accent);
                    opacity: 0.6;
                }
                .close-button {
                    position: absolute;
                    top: 1rem;
                    right: 1rem;
                    background: rgba(0, 0, 0, 0.3);
                    border: none;
                    color: white;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    z-index: 10;
                    transition: background 0.2s;
                }
                .close-button:hover {
                    background: rgba(0, 0, 0, 0.5);
                }

                .avatar-container {
                    position: absolute;
                    bottom: -40px;
                    left: 24px;
                }
                .avatar-ring {
                    width: 100px;
                    height: 100px;
                    border-radius: 50%;
                    background: var(--surface);
                    padding: 6px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                .profile-avatar {
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    object-fit: cover;
                }
                .avatar-placeholder {
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background: var(--accent);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 2.5rem;
                    font-weight: 700;
                }

                .profile-content {
                    padding: 56px 24px 24px;
                }
                .identity-section {
                    margin-bottom: 20px;
                }
                .name-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .name-row h1 {
                    margin: 0;
                    font-size: 1.5rem;
                    font-weight: 700;
                    color: var(--text);
                }
                .username {
                    margin: 2px 0 0;
                    color: var(--text-muted);
                    font-size: 0.93rem;
                    font-weight: 500;
                }

                .badge.bridged {
                    background: #5865F2;
                    color: white;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.875rem;
                }

                .status-box {
                    background: var(--surface-alt);
                    padding: 12px 16px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                    border: 1px solid var(--border);
                }
                .status-text {
                    font-style: italic;
                    color: var(--text);
                    font-size: 0.95rem;
                }

                .info-block {
                    margin-bottom: 20px;
                }
                label {
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 700;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 6px;
                }
                .bio-text {
                    margin: 0;
                    font-size: 0.95rem;
                    line-height: 1.5;
                    color: var(--text);
                    white-space: pre-wrap;
                }

                .info-meta {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    padding-top: 16px;
                    border-top: 1px solid var(--border);
                    margin-bottom: 24px;
                }
                .meta-item span {
                    font-size: 0.9rem;
                    color: var(--text);
                    font-weight: 500;
                }
                .monospace {
                    font-family: monospace;
                    font-size: 0.8rem !important;
                    opacity: 0.8;
                }

                .field {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                }
                input, textarea {
                    padding: 0.75rem;
                    border-radius: 8px;
                    border: 1px solid var(--border);
                    background: var(--bg-input);
                    color: var(--text-main);
                    width: 100%;
                    font-family: inherit;
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
                    padding: 0.65rem 1.25rem;
                    border-radius: 8px;
                    border: none;
                    background: var(--accent);
                    color: white;
                    font-weight: 600;
                    cursor: pointer;
                    transition: filter 0.2s;
                }
                button:hover {
                    filter: brightness(1.1);
                }
                button.secondary {
                    background: transparent;
                    border: 1px solid var(--border);
                    color: var(--text);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
}
