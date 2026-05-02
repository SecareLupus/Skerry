"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchServerSettings, updateServerSettings } from "../../../../lib/control-plane";
import { useChat } from "../../../../context/chat-context";
import { useToast } from "../../../../components/toast-provider";
import BridgeManager from "../../../../components/bridge-manager";
import { SpaceDelegationManager } from "../../../../components/space-delegation-manager";
import { SpaceOwnershipTransfer } from "../../../../components/space-ownership-transfer";
export default function SpaceSettingsPage() {
    const params = useParams();
    const router = useRouter();
    const serverId = params.id as string;
    const { state } = useChat();
    const { servers, channels } = state;
    const { showToast } = useToast();
    const [settings, setSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    const canManageCurrentSpace = useMemo(() => state.viewerRoles.some(
        (binding) =>
          (binding.role === "hub_admin" || binding.role === "space_owner") &&
          (binding.serverId === serverId || !binding.serverId)
      ), [state.viewerRoles, serverId]);


    const server = servers.find(s => s.id === serverId);

    useEffect(() => {
        if (!serverId) return;
        async function load() {
            try {
                const s = await fetchServerSettings(serverId);
                setSettings(s);
            } catch (err) {
                console.error("Failed to load space settings", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [serverId]);

    const handleSave = async () => {
        if (!serverId || !settings) return;
        setSaving(true);
        try {
            await updateServerSettings(serverId, settings);
            showToast("Space settings saved", "success");
        } catch (err) {
            showToast("Failed to save space settings", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleSpaceSwitch = (id: string) => {
        router.push(`/settings/spaces/${id}`);
    };

    if (loading) return <p>Loading space settings...</p>;
    if (!server) return <p>Space not found.</p>;

    if (!canManageCurrentSpace) {
        return (
            <div className="settings-section">
                <h1>Access Denied</h1>
                <p>You do not have permission to manage this space.</p>
            </div>
        );
    }

    return (
        <div className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>Space Settings: {server.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label htmlFor="space-switcher" style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Switch Space:</label>
                    <select
                        id="space-switcher"
                        className="filter-input"
                        style={{ width: 'auto' }}
                        value={serverId}
                        onChange={(e) => handleSpaceSwitch(e.target.value)}
                    >
                        {servers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>
            </div>
            <p className="settings-description">Manage the configuration for this specific space.</p>

            <div className="settings-grid" style={{ marginTop: '2rem' }}>
                <section className="settings-row">
                    <label>Starting Channel</label>
                    <select
                        className="filter-input"
                        value={settings?.startingChannelId || ""}
                        onChange={(e) => setSettings({ ...settings, startingChannelId: e.target.value || null })}
                    >
                        <option value="">None (Default)</option>
                        {channels.filter(c => c.serverId === serverId).map(c => (
                            <option key={c.id} value={c.id}>#{c.name}</option>
                        ))}
                    </select>
                    <p className="settings-description">The channel users will see first when entering this space.</p>
                </section>

                <section className="settings-row">
                    <label>Privacy Tier</label>
                    <select
                        className="filter-input"
                        value={settings?.privacyTier || "public"}
                        onChange={(e) => setSettings({ ...settings, privacyTier: e.target.value })}
                    >
                        <option value="public">Public (Full participation for all hub members)</option>
                        <option value="viewable">Viewable (All members can see, new members default to no voice)</option>
                        <option value="locked">Locked (Visible in list, but rooms require specific join permission)</option>
                        <option value="hidden">Hidden (Entire space is invisible without invitation)</option>
                    </select>
                    <p className="settings-description">Determines the default visibility and access level for this space and its rooms.</p>
                </section>

                <section className="settings-row checkbox-row">
                    <label className="checkbox-container">
                        <input 
                            type="checkbox" 
                            checked={settings?.autoJoinHubMembers !== false}
                            onChange={(e) => setSettings({ ...settings, autoJoinHubMembers: e.target.checked })}
                        />
                        <span className="checkbox-label">Auto-join new hub members</span>
                    </label>
                    <p className="settings-description">When enabled, any user who joins the hub will automatically be added as a member of this space.</p>
                </section>


                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{ justifySelf: 'start', marginTop: '1rem' }}
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </div>

            <hr style={{ margin: '3rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            <SpaceDelegationManager serverId={serverId} />

            <hr style={{ margin: '3rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            <BridgeManager
                serverId={serverId}
                hubId={server.hubId}
                returnTo={`/settings/spaces/${serverId}#discord-bridge`}
            />

            <hr style={{ margin: '3rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            <SpaceOwnershipTransfer serverId={serverId} />
        </div>
    );
}
