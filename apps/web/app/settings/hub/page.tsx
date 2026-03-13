"use client";

import { useEffect, useState } from "react";
import { fetchHubSettings, updateHubSettings, suspendHubOwner, unsuspendHubOwner } from "../../../lib/control-plane";
import { useChat } from "../../../context/chat-context";
import { useToast } from "../../../components/toast-provider";
import { HubSuspension } from "@skerry/shared";

export default function HubSettingsPage() {
    const { state } = useChat();
    const { hubs } = state;
    const { showToast } = useToast();
    const [settings, setSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const hubId = hubs[0]?.id;

    useEffect(() => {
        if (!hubId) return;
        async function load() {
            try {
                const s = await fetchHubSettings(hubId!);
                setSettings(s);
            } catch (err) {
                console.error("Failed to load hub settings", err);
            } finally {
                setLoading(false);
            }
        }
        void load();
    }, [hubId]);

    const handleSave = async () => {
        if (!hubId || !settings) return;
        setSaving(true);
        try {
            await updateHubSettings(hubId, settings);
            showToast("Hub settings saved", "success");
        } catch (err) {
            showToast("Failed to save hub settings", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p>Loading hub settings...</p>;
    if (!hubId) return <p>No hub found.</p>;

    return (
        <div className="settings-section">
            <h2>Hub Settings</h2>
            <p className="settings-description">Global configuration for the entire Hub.</p>

            <div className="settings-grid" style={{ marginTop: '2rem' }}>
                <section className="settings-row">
                    <label>Hub Theme (JSON)</label>
                    <textarea
                        className="filter-input"
                        style={{ minHeight: '150px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                        defaultValue={JSON.stringify(settings.theme || {}, null, 2)}
                        onBlur={(e) => {
                            try {
                                const theme = JSON.parse(e.target.value);
                                setSettings({ ...settings, theme });
                            } catch {
                                showToast("Invalid JSON in Theme field", "error");
                            }
                        }}
                    />
                    <p className="settings-description">Customize the visual appearance of the hub.</p>
                </section>

                <section className="settings-row">
                    <label>Space Customization Limits (JSON)</label>
                    <textarea
                        className="filter-input"
                        style={{ minHeight: '150px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                        defaultValue={JSON.stringify(settings.spaceCustomizationLimits || {}, null, 2)}
                        onBlur={(e) => {
                            try {
                                const limits = JSON.parse(e.target.value);
                                setSettings({ ...settings, spaceCustomizationLimits: limits });
                            } catch {
                                showToast("Invalid JSON in Limits field", "error");
                            }
                        }}
                    />
                </section>

                <section className="settings-row checkbox-row">
                    <label className="checkbox-container">
                        <input 
                            type="checkbox" 
                            checked={settings.allowSpaceDiscordBridge !== false}
                            onChange={(e) => setSettings({ ...settings, allowSpaceDiscordBridge: e.target.checked })}
                        />
                        <span className="checkbox-label">Allow Space Owners to manage Discord Bridge</span>
                    </label>
                    <p className="settings-description">When enabled, individual Space Owners can bridge their rooms to Discord without Hub Admin intervention.</p>
                </section>

                <hr style={{ margin: '1rem 0', borderColor: 'var(--border)' }} />

                <section className="settings-row">
                    <label style={{ color: 'var(--status-danger)' }}>Owner Voluntary Suspension</label>
                    {settings.suspension?.isSuspended ? (
                        <div style={{ backgroundColor: 'rgba(255, 69, 58, 0.1)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--status-danger)' }}>
                            <p style={{ margin: 0, fontWeight: 'bold' }}>Suspension Active</p>
                            <p style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                                Suspended at: {new Date(settings.suspension.suspendedAt).toLocaleString()}
                                {settings.suspension.expiresAt && ` — Expires: ${new Date(settings.suspension.expiresAt).toLocaleString()}`}
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                <input 
                                    className="filter-input" 
                                    placeholder="Enter unlock code" 
                                    style={{ maxWidth: '200px' }}
                                    id="unlock-code"
                                />
                                <button className="btn-secondary" onClick={async () => {
                                    const code = (document.getElementById('unlock-code') as HTMLInputElement).value;
                                    try {
                                        await unsuspendHubOwner(hubId, { unlockCode: code });
                                        showToast("Suspension lifted", "success");
                                        window.location.reload();
                                    } catch (err: any) {
                                        showToast(err.message, "error");
                                    }
                                }}>Lift Suspension</button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <p className="settings-description" style={{ marginBottom: '1rem' }}>
                                You can temporarily suspend your own owner permissions. During suspension, your effective role will be "Member" (or "Visitor" if configured), and you will not have administrative access.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <select className="filter-input" style={{ width: 'auto' }} id="suspend-duration">
                                    <option value="3600">1 Hour</option>
                                    <option value="86400">24 Hours</option>
                                    <option value="604800">1 Week</option>
                                    <option value="0">Indefinite (Requires code)</option>
                                </select>
                                <input 
                                    className="filter-input" 
                                    placeholder="Unlock code (optional)" 
                                    style={{ maxWidth: '200px' }}
                                    id="suspend-code"
                                />
                                <button className="btn-danger" onClick={async () => {
                                    const seconds = parseInt((document.getElementById('suspend-duration') as HTMLSelectElement).value);
                                    const code = (document.getElementById('suspend-code') as HTMLInputElement).value;
                                    if (confirm("Are you sure you want to suspend your owner permissions? You will lose admin access until the suspension expires or you provide the unlock code.")) {
                                        try {
                                            await suspendHubOwner(hubId, { 
                                                durationSeconds: seconds > 0 ? seconds : undefined,
                                                unlockCodeHash: code || undefined 
                                            });
                                            showToast("Permissions suspended", "success");
                                            window.location.reload();
                                        } catch (err: any) {
                                            showToast(err.message, "error");
                                        }
                                    }
                                }}>Suspend My Permissions</button>
                            </div>
                        </div>
                    )}
                </section>


                <button 
                    onClick={handleSave} 
                    disabled={saving}
                    style={{ justifySelf: 'start', marginTop: '1rem' }}
                >
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </div>
        </div>
    );
}
