"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
    ControlPlaneApiError,
    fetchAuthProviders,
    fetchHubInvite,
    joinHubByInvite,
    providerLoginUrl
} from "../../../lib/control-plane";
import type { HubInvite } from "@skerry/shared";
import { useToast } from "../../../components/toast-provider";

export default function InvitePage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const inviteId = params.inviteId as string;
    const autojoin = searchParams.get("autojoin") === "1";
    const { showToast } = useToast();

    const [invite, setInvite] = useState<HubInvite | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);
    const autojoinTriggeredRef = useRef(false);

    useEffect(() => {
        if (!inviteId) return;

        void fetchHubInvite(inviteId)
            .then(setInvite)
            .catch((err) => {
                setError(err.message || "Failed to load invite");
            })
            .finally(() => setLoading(false));
    }, [inviteId]);

    const handleJoin = useCallback(async () => {
        setJoining(true);
        try {
            await joinHubByInvite(inviteId);
            showToast("Joined successfully!", "success");
            // Wait a moment for the toast to be seen and for state to stabilize
            setTimeout(() => {
                window.location.href = "/";
            }, 500);
        } catch (err: any) {
            if (err instanceof ControlPlaneApiError && err.statusCode === 401) {
                try {
                    const { primaryProvider } = await fetchAuthProviders();
                    const returnTo = `${window.location.origin}/invite/${encodeURIComponent(inviteId)}?autojoin=1`;
                    window.location.href = providerLoginUrl(primaryProvider, { returnTo });
                    return;
                } catch (providerErr: any) {
                    showToast(providerErr?.message || "Failed to start sign-in", "error");
                    setJoining(false);
                    return;
                }
            }
            showToast(err.message || "Failed to join", "error");
            setJoining(false);
        }
    }, [inviteId, showToast]);

    useEffect(() => {
        if (!autojoin || loading || error || !invite) return;
        if (autojoinTriggeredRef.current) return;
        autojoinTriggeredRef.current = true;
        void handleJoin();
    }, [autojoin, loading, error, invite, handleJoin]);

    if (loading) {
        return (
            <div className="invite-loading">
                <p>Loading invite details...</p>
                <style jsx>{`
                    .invite-loading {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        font-family: inherit;
                        color: var(--text-muted);
                    }
                `}</style>
            </div>
        );
    }

    if (error || !invite) {
        return (
            <div className="invite-error">
                <h1>Invite Not Found</h1>
                <p>{error || "This invite may have expired or reached its usage limit."}</p>
                <button onClick={() => router.push("/")}>Go Home</button>
                <style jsx>{`
                    .invite-error {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        gap: 1rem;
                        text-align: center;
                    }
                    h1 { margin: 0; }
                    button {
                        padding: 0.5rem 1.5rem;
                        border-radius: 4px;
                        border: 1px solid var(--border);
                        background: var(--surface);
                        cursor: pointer;
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className="invite-page">
            <div className="invite-card">
                <header>
                    <div className="hub-avatar">H</div>
                    <h1>You&apos;ve been invited to join!</h1>
                </header>
                <p className="invite-meta">
                    This invite was created on {new Date(invite.createdAt).toLocaleDateString()}.
                    {invite.expiresAt && ` It expires on ${new Date(invite.expiresAt).toLocaleDateString()}.`}
                </p>
                <div className="actions">
                    <button
                        className="join-button"
                        onClick={handleJoin}
                        disabled={joining}
                    >
                        {joining ? "Joining..." : "Accept Invite & Join Hub"}
                    </button>
                    <button className="cancel-button" onClick={() => router.push("/")}>
                        Decline
                    </button>
                </div>
            </div>

            <style jsx>{`
                .invite-page {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    background: var(--background);
                }
                .invite-card {
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: 12px;
                    padding: 2.5rem;
                    width: 100%;
                    max-width: 450px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                    text-align: center;
                }
                header {
                    margin-bottom: 2rem;
                }
                .hub-avatar {
                    width: 80px;
                    height: 80px;
                    background: var(--accent);
                    color: white;
                    font-size: 2.5rem;
                    font-weight: bold;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 20px;
                    margin: 0 auto 1.5rem;
                }
                h1 {
                    font-size: 1.5rem;
                    margin: 0;
                    color: var(--text);
                }
                .invite-meta {
                    color: var(--text-muted);
                    font-size: 0.9rem;
                    margin-bottom: 2.5rem;
                    line-height: 1.5;
                }
                .actions {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .join-button {
                    background: var(--accent);
                    color: white;
                    border: none;
                    padding: 0.8rem;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 1rem;
                    cursor: pointer;
                    transition: filter 0.2s;
                }
                .join-button:hover:not(:disabled) {
                    filter: brightness(1.1);
                }
                .join-button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .cancel-button {
                    background: transparent;
                    color: var(--text-muted);
                    border: none;
                    font-size: 0.9rem;
                    cursor: pointer;
                }
                .cancel-button:hover {
                    color: var(--text);
                    text-decoration: underline;
                }
            `}</style>
        </div>
    );
}
