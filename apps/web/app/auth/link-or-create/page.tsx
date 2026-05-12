"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, Suspense } from "react";

export const dynamic = "force-dynamic";

function LinkOrCreateContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const provider = searchParams.get("provider") ?? "another provider";
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleCreateNew() {
        setSubmitting(true);
        setError(null);
        try {
            const resp = await fetch("/auth/confirm-new-account", {
                method: "POST",
                credentials: "include",
            });
            if (resp.redirected) {
                window.location.href = resp.url;
                return;
            }
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({ message: "Unknown error" }));
                setError((body as any).message ?? "Failed to create account");
            }
        } catch (e: any) {
            setError(e.message ?? "Network error");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <h1>Account Not Found</h1>
                <p>
                    We couldn&apos;t find an existing Skerry account linked
                    to your <strong>{provider}</strong> identity.
                </p>

                <div className="options">
                    <div className="option-card">
                        <h2>Create a New Account</h2>
                        <p>
                            Sign up with <strong>{provider}</strong> as a
                            brand-new Skerry account.
                        </p>
                        <button
                            className="button primary"
                            onClick={handleCreateNew}
                            disabled={submitting}
                        >
                            {submitting ? "Creating..." : `Create Account with ${provider}`}
                        </button>
                    </div>

                    <div className="option-card">
                        <h2>Link to Existing Account</h2>
                        <p>
                            If you already have a Skerry account with a
                            different login method, sign in with that method
                            first, then add {provider} from Settings.
                        </p>
                        <a className="button secondary" href="/login">
                            Go to Login
                        </a>
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}
            </div>

            <style jsx>{`
                .auth-page {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    padding: 2rem;
                    background: var(--bg-primary);
                }
                .auth-card {
                    max-width: 560px;
                    width: 100%;
                    padding: 2rem;
                    border-radius: 12px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                }
                h1 {
                    margin: 0 0 1rem;
                    font-size: 1.5rem;
                }
                p {
                    color: var(--text-muted);
                    margin: 0 0 1.5rem;
                    line-height: 1.5;
                }
                .options {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                    margin-bottom: 1.5rem;
                }
                @media (max-width: 500px) {
                    .options {
                        grid-template-columns: 1fr;
                    }
                }
                .option-card {
                    padding: 1.25rem;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    background: var(--bg-primary);
                }
                .option-card h2 {
                    font-size: 1rem;
                    margin: 0 0 0.5rem;
                }
                .option-card p {
                    font-size: 0.85rem;
                    margin: 0 0 1rem;
                }
                .button {
                    display: inline-block;
                    padding: 0.5rem 1rem;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: 500;
                    cursor: pointer;
                    text-decoration: none;
                    border: none;
                }
                .button.primary {
                    background: var(--accent);
                    color: #fff;
                }
                .button.primary:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .button.secondary {
                    background: transparent;
                    border: 1px solid var(--border);
                    color: var(--text-normal);
                }
                .error-message {
                    padding: 0.75rem;
                    border-radius: 6px;
                    background: rgba(240, 71, 71, 0.1);
                    color: #f04747;
                    font-size: 0.85rem;
                }
            `}</style>
        </div>
    );
}

export default function LinkOrCreatePage() {
    return (
        <Suspense fallback={<div className="auth-page"><div className="auth-card"><p>Loading...</p></div></div>}>
            <LinkOrCreateContent />
        </Suspense>
    );
}
