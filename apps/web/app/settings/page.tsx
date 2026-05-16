"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
    fetchAuthProviders,
    fetchViewerSession,
    providerLinkUrl,
    mergeAccounts,
    controlPlaneBaseUrl,
    type AuthProvidersResponse,
    type ViewerSession,
    type MergeAccountsResult
} from "../../lib/control-plane";

export default function UserSettingsPage() {
    const [viewer, setViewer] = useState<ViewerSession | null>(null);
    const [providers, setProviders] = useState<AuthProvidersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mergeSourceId, setMergeSourceId] = useState<string>("");
    const [mergeLoading, setMergeLoading] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);
    const [mergeResult, setMergeResult] = useState<MergeAccountsResult | null>(null);

    const loadSession = useCallback(async () => {
        try {
            const [v, p] = await Promise.all([
                fetchViewerSession(),
                fetchAuthProviders()
            ]);
            setViewer(v);
            setProviders(p);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load settings");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSession();
    }, [loadSession]);

    const enabledLoginProviders = useMemo(
        () => (providers?.providers ?? []).filter((provider) => provider.isEnabled && provider.provider !== "dev"),
        [providers]
    );

    // Identities NOT linked to the active session (potential merge sources)
    const mergeableIdentities = useMemo(() => {
        if (!viewer) return [];
        return viewer.linkedIdentities.filter(
            (identity) => identity.productUserId !== viewer.productUserId
        );
    }, [viewer]);

    const handleMerge = useCallback(async () => {
        if (!mergeSourceId) return;
        setMergeLoading(true);
        setMergeError(null);
        setMergeResult(null);
        try {
            const result = await mergeAccounts(mergeSourceId);
            setMergeResult(result);
            // Refresh the session to pick up any changes
            await loadSession();
        } catch (err) {
            setMergeError(err instanceof Error ? err.message : "Merge failed");
        } finally {
            setMergeLoading(false);
        }
    }, [mergeSourceId, loadSession]);

    if (loading) return <p>Loading your settings...</p>;
    if (!viewer) return <p>Please sign in to access settings.</p>;

    return (
        <div className="settings-section">
            <h2>User Settings</h2>
            {error ? <p className="error">{error}</p> : null}

            <div className="settings-grid">
                <section>
                    <h3>Connected Accounts</h3>
                    <p className="settings-description">
                        Manage your linked identities and authentication methods.
                    </p>
                    <ul className="settings-list" style={{ marginTop: '1rem' }}>
                        {viewer.linkedIdentities.map((identity) => (
                            <li key={`${identity.provider}:${identity.oidcSubject}`}>
                                <div className="identity-info">
                                    <strong>{identity.provider}</strong>
                                    {identity.email ? <span>{identity.email}</span> : null}
                                </div>
                            </li>
                        ))}
                    </ul>

                    <div className="stack" style={{ marginTop: '1.5rem' }}>
                        <h4>Link More Accounts</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                            {enabledLoginProviders
                                .filter(
                                    (provider) =>
                                        !viewer.linkedIdentities.some((identity) => identity.provider === provider.provider)
                                )
                                .map((provider) => (
                                    <a key={provider.provider} className="button-link" href={providerLinkUrl(provider.provider)}>
                                        Link {provider.displayName}
                                    </a>
                                ))}
                        </div>
                        {enabledLoginProviders.filter(
                            (provider) => !viewer.linkedIdentities.some((identity) => identity.provider === provider.provider)
                        ).length === 0 && <p className="muted" style={{ marginTop: '0.5rem' }}>All available providers are already linked.</p>}
                    </div>
                </section>

                <section style={{ marginTop: '2rem' }}>
                    <h3>Merge Accounts</h3>
                    <p className="settings-description">
                        Merge all data from another account (linked via a different identity) into your current account.
                        This transfers messages, memberships, roles, badges, and more. The source account will be consolidated
                        and its identities will point to your current account.
                    </p>

                    {mergeableIdentities.length === 0 ? (
                        <p className="muted" style={{ marginTop: '1rem' }}>
                            No other linked identities available for merging. Link another account first.
                        </p>
                    ) : (
                        <div style={{ marginTop: '1rem' }}>
                            <div className="stack" style={{ gap: '0.75rem' }}>
                                <label htmlFor="merge-source-select" style={{ fontWeight: 500 }}>
                                    Select account to merge from:
                                </label>
                                <select
                                    id="merge-source-select"
                                    value={mergeSourceId}
                                    onChange={(e) => setMergeSourceId(e.target.value)}
                                    style={{ padding: '0.5rem', maxWidth: '400px' }}
                                >
                                    <option value="">-- Choose an identity --</option>
                                    {mergeableIdentities.map((identity) => (
                                        <option key={`${identity.provider}:${identity.oidcSubject}`} value={identity.productUserId}>
                                            {identity.provider}
                                            {identity.email ? ` (${identity.email})` : ""}
                                            {identity.displayName ? ` — ${identity.displayName}` : ""}
                                        </option>
                                    ))}
                                </select>

                                <button
                                    onClick={handleMerge}
                                    disabled={!mergeSourceId || mergeLoading}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        maxWidth: '200px',
                                        cursor: mergeSourceId && !mergeLoading ? 'pointer' : 'not-allowed'
                                    }}
                                >
                                    {mergeLoading ? "Merging..." : "Merge Accounts"}
                                </button>
                            </div>

                            {mergeError && (
                                <p className="error" style={{ marginTop: '0.75rem' }}>{mergeError}</p>
                            )}

                            {mergeResult && (
                                <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border-color, #ccc)', borderRadius: '0.5rem' }}>
                                    <h4 style={{ marginBottom: '0.5rem' }}>Merge Complete</h4>
                                    <ul style={{ listStyle: 'none', padding: 0 }}>
                                        <li>Messages migrated: {mergeResult.migratedMessages}</li>
                                        <li>Server memberships: {mergeResult.migratedServerMembers}</li>
                                        <li>Hub memberships: {mergeResult.migratedHubMembers}</li>
                                        <li>Role bindings: {mergeResult.migratedRoleBindings}</li>
                                        <li>Presence records: {mergeResult.migratedUserPresence}</li>
                                        <li>Voice presence: {mergeResult.migratedVoicePresence}</li>
                                        <li>Badges: {mergeResult.migratedUserBadges}</li>
                                        <li>Identities merged: {mergeResult.mergedIdentities}</li>
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </section>
                <section style={{ marginTop: '2rem' }}>
                    <h3>Export Data</h3>
                    <p className="settings-description">
                        Download all your data in a ZIP archive. Includes messages,
                        DMs, memberships, reactions, and profile info.
                    </p>
                    <button
                        style={{ marginTop: '0.75rem' }}
                        onClick={async () => {
                            try {
                                const response = await fetch(`${controlPlaneBaseUrl}/v1/me/export`, {
                                    method: "POST",
                                    credentials: "include",
                                });
                                if (!response.ok) throw new Error("Export failed");
                                const blob = await response.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = "skerry-export.zip";
                                a.click();
                                URL.revokeObjectURL(url);
                            } catch {
                                alert("Export failed. Please try again.");
                            }
                        }}
                    >
                        Export My Data
                    </button>
                </section>
            </div>
        </div>
    );
}
