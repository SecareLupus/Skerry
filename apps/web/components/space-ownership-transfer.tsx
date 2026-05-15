"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    transferSpaceOwnership,
    searchUsers,
    fetchUser,
} from "../lib/control-plane";
import { useToast } from "./toast-provider";
import { UserSelect } from "./user-select";
import { useChat } from "../context/chat-context";

interface SpaceOwnershipTransferProps {
    serverId: string;
}

export function SpaceOwnershipTransfer({ serverId }: SpaceOwnershipTransferProps) {
    const { state } = useChat();
    const server = state.servers.find(s => s.id === serverId);

    const { showToast } = useToast();
    const router = useRouter();
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [transferring, setTransferring] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [currentOwner, setCurrentOwner] = useState<any>(null);

    useEffect(() => {
        if (server?.ownerUserId) {
            fetchUser(server.ownerUserId)
                .then(user => setCurrentOwner(user))
                .catch(err => console.error("Could not fetch current owner details", err));
        }
    }, [server?.ownerUserId]);

    const handleTransfer = async () => {
        if (!selectedUser) return;
        setTransferring(true);
        try {
            await transferSpaceOwnership({
                serverId,
                newOwnerUserId: selectedUser.productUserId,
            });
            showToast("Space ownership transferred successfully", "success");
            setShowConfirm(false);
            setSelectedUser(null);
            // Reload the page or redirect, as they might have lost access
            router.refresh();
        } catch (err: any) {
            showToast(err.message || "Failed to transfer ownership", "error");
            setShowConfirm(false);
        } finally {
            setTransferring(false);
        }
    };

    return (
        <section className="settings-section danger-zone" style={{ marginTop: '3rem', padding: '1.5rem', border: '1px solid var(--danger, #ff4d4f)', borderRadius: '8px', background: 'rgba(255, 77, 79, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ color: 'var(--danger, #ff4d4f)', margin: 0 }}>Transfer Ownership</h3>
            </div>
            <p className="settings-description" style={{ marginTop: '0.5rem', marginBottom: '1.5rem', color: 'var(--text-main)' }}>
                Transferring ownership gives full control of this space to another user. You will lose permanent ownership rights, but the new owner may choose to keep you as a delegated admin.
            </p>

            <div style={{ padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Current Owner: </span>
                    <strong style={{ fontSize: '1.1rem' }}>{currentOwner ? (currentOwner.displayName || currentOwner.oidcDisplayName) : server?.ownerUserId}</strong>
                </div>
            </div>

            <div className="transfer-form">
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <UserSelect
                        value={selectedUser}
                        onChange={(user) => {
                            setSelectedUser(user);
                            setShowConfirm(false);
                        }}
                        placeholder="Search users to transfer ownership to..."
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--danger, #ff4d4f)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                    />
                </div>

                {!showConfirm ? (
                    <button
                        className="danger-button"
                        onClick={() => setShowConfirm(true)}
                        disabled={!selectedUser}
                        style={{ justifySelf: 'start', padding: '0.6rem 1.2rem' }}
                    >
                        Transfer Ownership
                    </button>
                ) : (
                    <div className="confirm-box" style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--danger, #ff4d4f)', borderRadius: '6px', marginTop: '1rem' }}>
                        <p style={{ margin: '0 0 1rem 0', fontWeight: 'bold', color: 'var(--danger, #ff4d4f)' }}>Are you absolutely sure?</p>
                        <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem' }}>This action cannot be undone. You are transferring full ownership to <strong>{selectedUser.displayName || selectedUser.oidcDisplayName}</strong>.</p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                className="danger-button"
                                onClick={handleTransfer}
                                disabled={transferring}
                                style={{ padding: '0.6rem 1.2rem' }}
                            >
                                {transferring ? "Transferring..." : "Yes, Transfer Ownership"}
                            </button>
                            <button
                                onClick={() => setShowConfirm(false)}
                                disabled={transferring}
                                style={{ padding: '0.6rem 1.2rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-main)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <style jsx>{`
                button.danger-button {
                    background: var(--danger, #ff4d4f);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 600;
                }
                button.danger-button:hover:not(:disabled) {
                    background: #ff7875;
                }
                button.danger-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `}</style>
        </section >
    );
}
