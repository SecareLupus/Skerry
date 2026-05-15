"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    transferHubOwnership,
    fetchUser,
} from "../lib/control-plane";
import { useToast } from "./toast-provider";
import { UserSelect } from "./user-select";
import { useChat } from "../context/chat-context";

interface HubOwnershipTransferProps {
    hubId: string;
}

export function HubOwnershipTransfer({ hubId }: HubOwnershipTransferProps) {
    const { state } = useChat();
    const hub = state.hubs.find(h => h.id === hubId);

    const { showToast } = useToast();
    const router = useRouter();
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [transferring, setTransferring] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [currentOwner, setCurrentOwner] = useState<any>(null);

    useEffect(() => {
        if (hub?.ownerUserId) {
            fetchUser(hub.ownerUserId)
                .then(user => setCurrentOwner(user))
                .catch(err => console.error("Could not fetch current owner details", err));
        }
    }, [hub?.ownerUserId]);

    const handleTransfer = async () => {
        if (!selectedUser) return;
        setTransferring(true);
        try {
            await transferHubOwnership({
                hubId,
                newOwnerUserId: selectedUser.productUserId,
            });
            showToast("Hub ownership transferred successfully", "success");
            setShowConfirm(false);
            setSelectedUser(null);
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
                <h3 style={{ color: 'var(--danger, #ff4d4f)', margin: 0 }}>Transfer Hub Ownership</h3>
            </div>
            <p className="settings-description" style={{ marginTop: '0.5rem', marginBottom: '1.5rem', color: 'var(--text-main)' }}>
                Transferring ownership gives full control of the entire Hub to another user. This is a irreversible action that will remove your owner status.
            </p>

            <div style={{ padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Current Owner: </span>
                    <strong style={{ fontSize: '1.1rem' }}>{currentOwner ? (currentOwner.displayName || currentOwner.oidcDisplayName) : hub?.ownerUserId}</strong>
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
                    />
                </div>

                {!showConfirm ? (
                    <button
                        className="btn-danger"
                        onClick={() => setShowConfirm(true)}
                        disabled={!selectedUser}
                        style={{ justifySelf: 'start' }}
                    >
                        Transfer Hub Ownership
                    </button>
                ) : (
                    <div className="confirm-box" style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--danger, #ff4d4f)', borderRadius: '6px', marginTop: '1rem' }}>
                        <p style={{ margin: '0 0 1rem 0', fontWeight: 'bold', color: 'var(--danger, #ff4d4f)' }}>Are you absolutely sure?</p>
                        <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem' }}>You are transferring full ownership of the entire Hub to <strong>{selectedUser.displayName || selectedUser.oidcDisplayName}</strong>. You will lose all administrative rights unless the new owner grants them back.</p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                className="btn-danger"
                                onClick={handleTransfer}
                                disabled={transferring}
                            >
                                {transferring ? "Transferring..." : "Yes, Transfer Ownership"}
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => setShowConfirm(false)}
                                disabled={transferring}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section >
    );
}
