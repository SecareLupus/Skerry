"use client";

import { useEffect, useState, useCallback } from "react";
import { useChat } from "../../../context/chat-context";
import { useToast } from "../../../components/toast-provider";
import {
  beginPasskeyRegistration,
  completePasskeyRegistration,
  listPasskeyCredentials,
  removePasskeyCredential,
  beginTotpEnrollment as apiBeginTotpEnrollment,
  verifyTotpEnrollment,
  removeTotp,
} from "../../../lib/control-plane";

export default function SecuritySettingsPage() {
  const { state } = useChat();
  const { hubs } = state;
  const hub = hubs[0];
  const { showToast } = useToast();

  const [credentials, setCredentials] = useState<any[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [hasTotp, setHasTotp] = useState(false);

  const loadCredentials = useCallback(async () => {
    if (!hub?.id) return;
    try {
      const { items } = await listPasskeyCredentials(hub.id);
      setCredentials(items);
    } catch { /* ignore */ }
    setLoading(false);
  }, [hub?.id]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleRegisterPasskey = async () => {
    if (!hub?.id) return;
    setRegistering(true);
    try {
      const opts = await beginPasskeyRegistration(hub.id);
      const cred = await navigator.credentials.create({ publicKey: opts });
      if (!cred) throw new Error("No credential returned");

      const result = await completePasskeyRegistration(
        hub.id,
        cred,
        prompt("Label for this passkey (e.g. YubiKey)?") || undefined
      );

      if (result.recoveryCodes) {
        setRecoveryCodes(result.recoveryCodes);
      }

      showToast("Passkey registered", "success");
      await loadCredentials();
    } catch (err: any) {
      showToast(err.message || "Registration failed", "error");
    }
    setRegistering(false);
  };

  const handleRemoveCredential = async (id: string) => {
    if (!hub?.id) return;
    try {
      await removePasskeyCredential(hub.id, id);
      showToast("Passkey removed", "success");
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch {
      showToast("Failed to remove", "error");
    }
  };

  const handleEnrollTotp = async () => {
    if (!hub?.id) return;
    try {
      const { secret, uri } = await apiBeginTotpEnrollment(hub.id);
      setTotpSecret(secret);
      setTotpUri(uri);
    } catch {
      showToast("TOTP enrollment failed", "error");
    }
  };

  const handleVerifyTotp = async () => {
    if (!hub?.id || !totpCode) return;
    try {
      await verifyTotpEnrollment(hub.id, totpCode);
      showToast("TOTP enabled", "success");
      setTotpSecret(null);
      setTotpUri(null);
      setTotpCode("");
      setHasTotp(true);
    } catch {
      showToast("Invalid code", "error");
    }
  };

  if (!hub) return <p>Hub not found.</p>;
  if (loading) return <p>Loading...</p>;

  return (
    <div className="settings-section">
      <h2>Security</h2>

      <section style={{ marginTop: "1.5rem" }}>
        <h3>Passkeys</h3>
        <p className="settings-description">
          Passkeys allow passwordless login and 2FA verification using your
          device biometrics or security key.
        </p>

        {credentials.length > 0 && (
          <table className="settings-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Label</th>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>PIN</th>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Last used</th>
                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }} />
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: "0.5rem" }}>{c.label || "Unnamed"}</td>
                  <td style={{ padding: "0.5rem" }}>{c.hasPin ? "Yes" : "No"}</td>
                  <td style={{ padding: "0.5rem" }}>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString() : "Never"}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <button className="ghost" onClick={() => handleRemoveCredential(c.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          onClick={handleRegisterPasskey}
          disabled={registering}
          style={{ marginTop: "0.75rem" }}
        >
          {registering ? "Registering..." : "Add Passkey"}
        </button>
      </section>

      {recoveryCodes && (
        <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--accent)", borderRadius: "8px", background: "var(--bg-input)" }}>
          <h3>Recovery Codes</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Save these codes in a safe place. Each code can be used once to
            recover access if you lose all your passkeys and authenticators.
          </p>
          <pre style={{ fontFamily: "monospace", fontSize: "0.9rem", padding: "0.5rem", background: "var(--bg-surface)", borderRadius: "4px" }}>
            {recoveryCodes.join("\n")}
          </pre>
          <button className="ghost" onClick={() => setRecoveryCodes(null)}>Dismiss</button>
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h3>TOTP (Authenticator App)</h3>
        <p className="settings-description">
          Use a TOTP app like Google Authenticator or Authy to generate
          verification codes.
        </p>

        {totpSecret ? (
          <div style={{ marginTop: "0.75rem" }}>
            <p>Scan this QR code or enter the secret manually:</p>
            <pre style={{ fontFamily: "monospace", padding: "0.5rem", background: "var(--bg-surface)", borderRadius: "4px", wordBreak: "break-all" }}>
              {totpSecret}
            </pre>
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code"
                maxLength={6}
                style={{ width: "120px" }}
              />
              <button onClick={handleVerifyTotp} disabled={totpCode.length !== 6}>Verify</button>
            </div>
          </div>
        ) : hasTotp ? (
          <div style={{ marginTop: "0.75rem" }}>
            <p>TOTP is enabled. <button className="ghost" onClick={handleEnrollTotp}>Reconfigure</button></p>
          </div>
        ) : (
          <button onClick={handleEnrollTotp} style={{ marginTop: "0.75rem" }}>
            Enroll TOTP
          </button>
        )}
      </section>
    </div>
  );
}
