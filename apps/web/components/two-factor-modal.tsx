"use client";

import { useState, useCallback } from "react";
import { beginPasskeyAuthentication } from "../lib/control-plane";

interface Props {
  hubId: string;
  onVerify: (token: string) => void;
  onCancel: () => void;
}

export function TwoFactorModal({ hubId, onVerify, onCancel }: Props) {
  const [method, setMethod] = useState<"webauthn" | "totp">("webauthn");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerifyTotp = useCallback(async () => {
    if (!totpCode || totpCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/v1/hubs/${encodeURIComponent(hubId)}/2fa/verify?method=totp&code=${totpCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ method: "totp", code: totpCode }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Verification failed" }));
        setError(body.message);
        return;
      }
      const { token } = await response.json();
      onVerify(token);
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }, [totpCode, hubId, onVerify]);

  const handleVerifyPasskey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const opts = await beginPasskeyAuthentication(hubId);
      const assertion = await navigator.credentials.get({ publicKey: opts });
      if (!assertion) throw new Error("No credential");

      const response = await fetch(`/v1/hubs/${encodeURIComponent(hubId)}/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ method: "webauthn", response: assertion }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Verification failed" }));
        setError(body.message);
        setLoading(false);
        return;
      }
      const { token } = await response.json();
      onVerify(token);
    } catch (err: any) {
      setError(err.message || "Passkey verification failed");
    }
    setLoading(false);
  }, [hubId, onVerify]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--bg-secondary)", borderRadius: "12px",
          padding: "2rem", maxWidth: "400px", width: "100%",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem" }}>Two-Factor Verification</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
          This action requires additional verification.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            onClick={() => setMethod("webauthn")}
            style={{
              flex: 1, padding: "0.5rem", borderRadius: "6px",
              border: method === "webauthn" ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: method === "webauthn" ? "var(--accent)" : "transparent",
              color: method === "webauthn" ? "#fff" : "var(--text-normal)",
              cursor: "pointer",
            }}
          >
            Passkey
          </button>
          <button
            onClick={() => setMethod("totp")}
            style={{
              flex: 1, padding: "0.5rem", borderRadius: "6px",
              border: method === "totp" ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: method === "totp" ? "var(--accent)" : "transparent",
              color: method === "totp" ? "#fff" : "var(--text-normal)",
              cursor: "pointer",
            }}
          >
            TOTP Code
          </button>
        </div>

        {method === "totp" ? (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              style={{ flex: 1 }}
            />
            <button onClick={handleVerifyTotp} disabled={loading || totpCode.length !== 6}>
              {loading ? "..." : "Verify"}
            </button>
          </div>
        ) : (
          <button onClick={handleVerifyPasskey} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Waiting for passkey..." : "Verify with Passkey"}
          </button>
        )}

        {error && (
          <p style={{ marginTop: "0.75rem", color: "var(--danger)", fontSize: "0.85rem" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
