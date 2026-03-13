"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { 
    listBadges, 
    createBadge, 
    updateBadge, 
    deleteBadge, 
    listServerMembers,
    assignBadge,
    revokeBadge
} from "../../../../../lib/control-plane";
import { useChat } from "../../../../../context/chat-context";
import { useToast } from "../../../../../components/toast-provider";

export default function SpaceBadgesPage() {
    const params = useParams();
    const serverId = params.id as string;
    const { state } = useChat();
    const { hubs } = state;
    const { showToast } = useToast();
    
    const [badges, setBadges] = useState<any[]>([]);
    const [members, setMembers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    
    const hubId = hubs[0]?.id;

    useEffect(() => {
        if (!serverId) return;
        async function load() {
            try {
                const [b, mem] = await Promise.all([
                    listBadges(serverId),
                    listServerMembers(serverId)
                ]);
                setBadges(b);
                setMembers(mem);
            } catch (err) {
                console.error("Failed to load badges", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [serverId]);

    const handleCreateBadge = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const name = formData.get("name") as string;
        const rank = parseInt(formData.get("rank") as string);
        const description = formData.get("description") as string;

        try {
            const newBadge = await createBadge({ hubId: hubId!, serverId, name, rank, description });
            setBadges([...badges, newBadge].sort((a, b) => b.rank - a.rank));
            setIsCreating(false);
            showToast("Badge created", "success");
        } catch (err) {
            showToast("Failed to create badge", "error");
        }
    };

    const handleDeleteBadge = async (badgeId: string) => {
        if (!confirm("Are you sure you want to delete this badge?")) return;
        try {
            await deleteBadge(badgeId);
            setBadges(badges.filter(b => b.id !== badgeId));
            showToast("Badge deleted", "success");
        } catch (err) {
            showToast("Failed to delete badge", "error");
        }
    };

    if (loading) return <p>Loading badges...</p>;

    return (
        <div className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Space Badges</h2>
                <button className="btn-primary" onClick={() => setIsCreating(true)}>Create Badge</button>
            </div>
            <p className="settings-description">
                Badges are used to grant granular permissions. Higher rank badges take precedence.
            </p>

            {isCreating && (
                <form onSubmit={handleCreateBadge} className="settings-grid" style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <h3>New Badge</h3>
                    <section className="settings-row">
                        <label>Name</label>
                        <input name="name" className="filter-input" required placeholder="e.g. VIP, Moderator" />
                    </section>
                    <section className="settings-row">
                        <label>Rank (Highest = Most Powerful)</label>
                        <input name="rank" type="number" className="filter-input" required defaultValue="10" />
                    </section>
                    <section className="settings-row">
                        <label>Description</label>
                        <input name="description" className="filter-input" placeholder="What this badge represents" />
                    </section>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                        <button type="submit" className="btn-primary">Save Badge</button>
                        <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                    </div>
                </form>
            )}

            <div style={{ marginTop: '2rem' }}>
                {badges.length === 0 ? (
                    <p className="settings-description">No badges defined yet.</p>
                ) : (
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        {badges.map(badge => (
                            <BadgeItem 
                                key={badge.id} 
                                badge={badge} 
                                members={members}
                                onDelete={() => handleDeleteBadge(badge.id)} 
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function BadgeItem({ badge, members, onDelete }: { badge: any, members: any[], onDelete: () => void }) {
    const { showToast } = useToast();
    const [isAssigning, setIsAssigning] = useState(false);
    const [assignedUsers, setAssignedUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // In a full implementation we'd fetch assigned users for this badge.
    // For now we'll assume the badge object might have them or we fetch them.
    // Let's add a dummy fetch or use the members list to filter if we had the association.
    
    return (
        <div style={{ border: '1px solid var(--border)', padding: '1.5rem', borderRadius: '8px', backgroundColor: 'var(--panel-bg-lighter)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h3 style={{ margin: 0 }}>{badge.name} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Rank: {badge.rank})</span></h3>
                    <p className="settings-description" style={{ marginTop: '0.3rem' }}>{badge.description || "No description"}</p>
                </div>
                <button className="btn-danger btn-small" onClick={onDelete}>Delete</button>
            </div>
            
            <div style={{ marginTop: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Assigned Members</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {/* Assigned users tags would go here */}
                    <button className="btn-secondary btn-small" onClick={() => setIsAssigning(true)}>+</button>
                </div>
            </div>

            {isAssigning && (
                <div className="modal-overlay" style={{ zIndex: 1000 }}>
                    <div className="modal-content" style={{ maxWidth: '400px' }}>
                        <h3>Assign Badge: {badge.name}</h3>
                        <p className="settings-description">Select a member to grant this badge.</p>
                        <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '1rem' }}>
                            {members.map(m => (
                                <div key={m.productUserId} className="member-row" style={{ padding: '0.5rem', cursor: 'pointer' }} onClick={async () => {
                                    try {
                                        await assignBadge(badge.id, m.productUserId);
                                        showToast(`Assigned to ${m.displayName}`, "success");
                                        setIsAssigning(false);
                                    } catch (err) {
                                        showToast("Failed to assign badge", "error");
                                    }
                                }}>
                                    {m.displayName}
                                </div>
                            ))}
                        </div>
                        <button className="btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => setIsAssigning(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
