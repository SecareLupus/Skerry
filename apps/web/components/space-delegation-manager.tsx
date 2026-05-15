"use client";

import React, { useState, useEffect } from "react";
import {
    listSpaceOwnerAssignments,
    assignSpaceOwner,
    revokeSpaceOwnerAssignment,
    fetchUser,
} from "../lib/control-plane";
import { useToast } from "./toast-provider";
import { UserSelect } from "./user-select";

interface SpaceDelegationManagerProps {
    serverId: string;
}

export function SpaceDelegationManager({ serverId }: SpaceDelegationManagerProps) {
    const { showToast } = useToast();
    const [assignments, setAssignments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [assigning, setAssigning] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);

    const loadAssignments = async () => {
        try {
            const allAssignments = await listSpaceOwnerAssignments(serverId);
            const data = allAssignments.filter((a: any) => a.status === 'active');
            // Resolve the assigned users to display their names
            const withUsers = await Promise.all(data.map(async (a) => {
                try {
                    const user = await fetchUser(a.assignedUserId);
                    return { ...a, assignedUser: user };
                } catch (e) {
                    return a;
                }
            }));
            setAssignments(withUsers);
        } catch (err) {
            console.error("Failed to load space owner assignments", err);
            showToast("Failed to load delegated admins", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (serverId) {
            loadAssignments();
        }
    }, [serverId]);



    const handleAssign = async () => {
        if (!selectedUser) return;
        setAssigning(true);
        try {
            await assignSpaceOwner({
                serverId,
                productUserId: selectedUser.productUserId,
            });
            showToast("Admin assigned successfully", "success");
            setSelectedUser(null);
            await loadAssignments();
        } catch (err: any) {
            showToast(err.message || "Failed to assign admin", "error");
        } finally {
            setAssigning(false);
        }
    };

    const handleRevoke = async (assignmentId: string) => {
        setRevoking(assignmentId);
        try {
            await revokeSpaceOwnerAssignment({ serverId, assignmentId });
            showToast("Admin access revoked", "success");
            await loadAssignments();
        } catch (err: any) {
            showToast(err.message || "Failed to revoke admin access", "error");
        } finally {
            setRevoking(null);
        }
    };

    return (
        <section className="settings-section" style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Delegated Space Admins</h3>
            </div>
            <p className="settings-description">
                Admins have full control over this space, including moderation and settings, but cannot transfer its ownership.
            </p>

            <div className="delegation-list" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
                {loading ? (
                    <p>Loading admins...</p>
                ) : assignments.length === 0 ? (
                    <p className="no-assignments">No delegated admins found.</p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {assignments.map(a => (
                            <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-input)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{a.assignedUser ? (a.assignedUser.displayName || a.assignedUser.oidcDisplayName) : a.assignedUserId}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Assigned by {a.actorUserId} on {new Date(a.createdAt).toLocaleDateString()}</div>
                                </div>
                                <button
                                    className="secondary"
                                    onClick={() => handleRevoke(a.id)}
                                    disabled={revoking === a.id}
                                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                >
                                    {revoking === a.id ? "Revoking..." : "Revoke"}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="assign-form" style={{ background: 'var(--bg-surface-hover)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <h4 style={{ margin: '0 0 1rem 0' }}>Assign New Admin</h4>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <UserSelect
                        value={selectedUser}
                        onChange={setSelectedUser}
                        placeholder="Search users to assign..."
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                    />
                </div>

                <button
                    onClick={handleAssign}
                    disabled={!selectedUser || assigning}
                    style={{ justifySelf: 'start', padding: '0.6rem 1.2rem' }}
                >
                    {assigning ? "Assigning..." : "Assign Admin Role"}
                </button>
            </div>
            <style jsx>{`
                .search-result-item:hover {
                    background: var(--bg-surface-hover);
                }
                .no-assignments {
                    color: var(--text-muted);
                    font-style: italic;
                    padding: 1rem;
                    text-align: center;
                    background: var(--bg-surface-hover);
                    border-radius: 6px;
                    border: 1px dashed var(--border);
                }
                button.secondary {
                    background: transparent;
                    border: 1px solid var(--danger, #ff4d4f);
                    color: var(--danger, #ff4d4f);
                }
                button.secondary:hover:not(:disabled) {
                    background: rgba(255, 77, 79, 0.1);
                }
            `}</style>
        </section>
    );
}
