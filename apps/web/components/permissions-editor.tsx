"use client";

import React, { useEffect, useState } from "react";
import { AccessLevel, Badge, ServerBadgeRule, ChannelBadgeRule } from "@skerry/shared";
import { listBadges, setServerBadgeRule, setChannelBadgeRule } from "../lib/control-plane";

interface PermissionsEditorProps {
    serverId: string;
    channelId?: string;
    initialAccess: {
        hubAdminAccess: AccessLevel;
        spaceMemberAccess: AccessLevel;
        hubMemberAccess: AccessLevel;
        visitorAccess: AccessLevel;
    };
    onSaveDefaults: (access: {
        hubAdminAccess: AccessLevel;
        spaceMemberAccess: AccessLevel;
        hubMemberAccess: AccessLevel;
        visitorAccess: AccessLevel;
    }) => Promise<void>;
}

const ACCESS_LEVELS: AccessLevel[] = ["hidden", "locked", "read", "chat"];

export function PermissionsEditor({
    serverId,
    channelId,
    initialAccess,
    onSaveDefaults
}: PermissionsEditorProps) {
    const [access, setAccess] = useState(initialAccess);
    const [badges, setBadges] = useState<Badge[]>([]);
    const [badgeRules, setBadgeRules] = useState<Array<ServerBadgeRule | ChannelBadgeRule>>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const b = await listBadges(serverId);
                setBadges(b);
                // In a real app, we'd also fetch current rules. 
                // For now, let's assume they are passed in or we fetch them.
                // Since I didn't add a 'listBadgeRules' endpoint yet (only for channel/server), 
                // I might need to add one or just handle setting them.
            } catch (err) {
                console.error("Failed to load badges", err);
            }
        };
        void load();
    }, [serverId]);

    const handleSaveDefaults = async () => {
        setLoading(true);
        setError(null);
        try {
            await onSaveDefaults(access);
        } catch (err) {
            setError("Failed to save default permissions");
        } finally {
            setLoading(false);
        }
    };

    const handleSetBadgeRule = async (badgeId: string, level: AccessLevel | null) => {
        try {
            if (channelId) {
                await setChannelBadgeRule(channelId, badgeId, level);
            } else {
                await setServerBadgeRule(serverId, badgeId, level);
            }
            // Update local state if we were tracking list of rules
        } catch (err) {
            setError("Failed to save badge rule");
        }
    };

    return (
        <div className="permissions-editor stack">
            <section className="stack">
                <h3>Default Access Roles</h3>
                <p className="muted">Set the default access level for each role.</p>
                <div className="grid-form">
                    <label>Hub Admins</label>
                    <select 
                        value={access.hubAdminAccess}
                        onChange={(e) => setAccess({ ...access, hubAdminAccess: e.target.value as AccessLevel })}
                    >
                        {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>

                    <label>Space Members</label>
                    <select 
                        value={access.spaceMemberAccess}
                        onChange={(e) => setAccess({ ...access, spaceMemberAccess: e.target.value as AccessLevel })}
                    >
                        {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>

                    <label>Hub Members</label>
                    <select 
                        value={access.hubMemberAccess}
                        onChange={(e) => setAccess({ ...access, hubMemberAccess: e.target.value as AccessLevel })}
                    >
                        {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>

                    <label>Visitors</label>
                    <select 
                        value={access.visitorAccess}
                        onChange={(e) => setAccess({ ...access, visitorAccess: e.target.value as AccessLevel })}
                    >
                        {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>
                <button onClick={handleSaveDefaults} disabled={loading}>Save Defaults</button>
            </section>

            <hr />

            <section className="stack">
                <h3>Badge Overrides</h3>
                <p className="muted">Badges can grant higher or lower access than the default roles.</p>
                {badges.length === 0 ? (
                    <p className="muted">No badges defined for this space yet.</p>
                ) : (
                    <table className="badge-rules-table">
                        <thead>
                            <tr>
                                <th>Badge</th>
                                <th>Access Override</th>
                            </tr>
                        </thead>
                        <tbody>
                            {badges.map(badge => (
                                <tr key={badge.id}>
                                    <td>{badge.name}</td>
                                    <td>
                                        <select 
                                            onChange={(e) => handleSetBadgeRule(badge.id, e.target.value === "none" ? null : e.target.value as AccessLevel)}
                                        >
                                            <option value="none">Default (No Override)</option>
                                            {ACCESS_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {error && <p className="danger">{error}</p>}
        </div>
    );
}
