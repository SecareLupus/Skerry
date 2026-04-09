"use client";

import React, { useState, useEffect } from "react";
import { useChat } from "../context/chat-context";
import {
    providerLoginUrl,
    completeUsernameOnboarding,
    bootstrapAdmin,
    fetchViewerSession,
    fetchBootstrapStatus
} from "../lib/control-plane";

export function AuthOverlay() {
    const { state, dispatch } = useChat();
    const { viewer, providers, bootstrapStatus, error } = state;

    const [devUsername, setDevUsername] = useState("local-admin");
    const [onboardingUsername, setOnboardingUsername] = useState("");
    const [hubName, setHubName] = useState("Local Creator Hub");
    const [setupToken, setSetupToken] = useState("");
    const [savingOnboarding, setSavingOnboarding] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const suggested = params.get("suggestedUsername");
        if (suggested) {
            setOnboardingUsername(suggested);
        }
    }, []);

    const handleOnboardingUsername = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingOnboarding(true);
        try {
            await completeUsernameOnboarding(onboardingUsername);
            const nextViewer = await fetchViewerSession();
            dispatch({ type: "SET_VIEWER", payload: nextViewer });
        } catch (err) {
            dispatch({ type: "SET_ERROR", payload: err instanceof Error ? err.message : String(err) });
        } finally {
            setSavingOnboarding(false);
        }
    };

    const handleBootstrap = async (event: React.FormEvent) => {
        event.preventDefault();
        setBootstrapping(true);
        try {
            await bootstrapAdmin({ hubName, setupToken });
            const nextStatus = await fetchBootstrapStatus();
            dispatch({ type: "SET_BOOTSTRAP_STATUS", payload: nextStatus });
        } catch (err) {
            dispatch({ type: "SET_ERROR", payload: err instanceof Error ? err.message : String(err) });
        } finally {
            setBootstrapping(false);
        }
    };

    if (!viewer) {
        const enabledLoginProviders = providers?.providers.filter((p) => p.isEnabled) ?? [];
        return (
            <div className="login-container">
                <div className="login-card">
                    <h2>Skerry</h2>
                    <p>Log in to access your workspace</p>
                    <div className="stack">
                        {enabledLoginProviders.length > 0 ? (
                            enabledLoginProviders.map((provider) => {
                                let btnClass = "provider-button";
                                if (provider.provider === "discord") btnClass += " discord";
                                if (provider.provider === "twitch") btnClass += " twitch";
                                if (provider.provider === "google") btnClass += " google";
                                if (provider.provider === "dev") btnClass += " dev";

                                if (provider.provider === "dev") {
                                    return (
                                        <form
                                            key={provider.provider}
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                window.location.href = providerLoginUrl("dev", devUsername);
                                            }}
                                            className="stack"
                                            style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}
                                        >
                                            <p style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Or use developer login:</p>
                                            <label htmlFor="dev-username" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem", display: "block", textAlign: "left" }}>
                                                Developer Username
                                            </label>
                                            <input
                                                id="dev-username"
                                                value={devUsername}
                                                onChange={(event) => setDevUsername(event.target.value)}
                                                minLength={3}
                                                maxLength={40}
                                                className="input"
                                                placeholder="Dev Username"
                                                aria-label="Developer Username"
                                                required
                                            />
                                            <button type="submit" className={btnClass}>
                                                Dev Login
                                            </button>
                                        </form>
                                    );
                                }

                                return (
                                    <a key={provider.provider} className={btnClass} href={providerLoginUrl(provider.provider)}>
                                        {provider.provider === "discord" && (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037 13.48 13.48 0 0 0-.59 1.227 18.3 18.3 0 0 0-5.526 0 13.483 13.483 0 0 0-.59-1.227.073.073 0 0 0-.079-.037 19.792 19.792 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                            </svg>
                                        )}
                                        {provider.provider === "twitch" && (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                                            </svg>
                                        )}
                                        Continue with {provider.displayName}
                                    </a>
                                );
                            })
                        ) : (
                            <p>No OAuth providers are enabled.</p>
                        )}
                    </div>
                    {!providers?.providers.some((provider) => provider.isEnabled) ? (
                        <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "var(--danger)" }}>
                            Configure providers in .env
                        </p>
                    ) : null}
                </div>
            </div>
        );
    }

    if (viewer.needsOnboarding) {
        return (
            <section className="panel">
                <h2>Choose Username</h2>
                <p>Complete onboarding by picking your handle. This is used for mentions and display.</p>
                <form onSubmit={handleOnboardingUsername} className="stack">
                    <label htmlFor="onboarding-username">Username</label>
                    <input
                        id="onboarding-username"
                        autoFocus
                        value={onboardingUsername}
                        onChange={(e) => setOnboardingUsername(e.target.value)}
                        minLength={3}
                        maxLength={40}
                        required
                        className="onboarding-input"
                        placeholder="e.g. jamie_smith"
                    />
                    <button type="submit" disabled={savingOnboarding}>
                        {savingOnboarding ? "Saving..." : "Save Username"}
                    </button>
                </form>
            </section>
        );
    }

    if (!bootstrapStatus?.initialized) {
        return (
            <section className="panel">
                <h2>Initialize Workspace</h2>
                <p>First login must bootstrap the hub and default channel.</p>
                <form onSubmit={handleBootstrap} className="stack">
                    <label htmlFor="hub-name">Hub Name</label>
                    <input
                        id="hub-name"
                        value={hubName}
                        onChange={(event) => setHubName(event.target.value)}
                        minLength={2}
                        maxLength={80}
                        required
                    />
                    <label htmlFor="setup-token">Setup Token</label>
                    <input
                        id="setup-token"
                        value={setupToken}
                        onChange={(event) => setSetupToken(event.target.value)}
                        minLength={1}
                        required
                    />
                    <button type="submit" disabled={bootstrapping}>
                        {bootstrapping ? "Bootstrapping..." : "Bootstrap Admin + Hub"}
                    </button>
                </form>
            </section>
        );
    }

    return null;
}
