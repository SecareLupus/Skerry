"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "../../../../context/chat-context";
import { useToast } from "../../../../components/toast-provider";
import {
  listHubInvites,
  revokeHubInvite
} from "../../../../lib/control-plane";
import type { HubInvite } from "@skerry/shared";

export default function HubInvitesPage() {
  const { state } = useChat();
  const { hubs, servers } = state;
  const hub = hubs[0];
  const { showToast } = useToast();

  const [invites, setInvites] = useState<HubInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const serverNameById = new Map(servers.map((s) => [s.id, s.name]));

  const load = useCallback(async () => {
    if (!hub?.id) return;
    setLoading(true);
    try {
      const { items } = await listHubInvites(hub.id);
      setInvites(items);
    } catch (err: any) {
      showToast(err?.message || "Failed to load invites", "error");
    } finally {
      setLoading(false);
    }
  }, [hub?.id, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (inviteId: string) => {
    if (!hub?.id) return;
    if (!window.confirm("Revoke this invite link? Already-redeemed users keep their access; the link will stop working immediately.")) {
      return;
    }
    setRevoking(inviteId);
    try {
      await revokeHubInvite(hub.id, inviteId);
      showToast("Invite revoked", "success");
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      showToast(err?.message || "Failed to revoke invite", "error");
    } finally {
      setRevoking(null);
    }
  };

  if (!hub) return <p>Hub not found.</p>;

  return (
    <div className="settings-section">
      <header>
        <h2>Hub Invites</h2>
        <p className="settings-description">
          Active invite links for <strong>{hub.name}</strong>. Revoking
          a link stops it immediately but does not affect users who
          have already joined.
        </p>
      </header>

      {loading ? (
        <p>Loading…</p>
      ) : invites.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No active invites.</p>
      ) : (
        <table className="settings-table" data-testid="hub-invites-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Link</th>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Default role</th>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Default server</th>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Badges</th>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Uses</th>
              <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Created</th>
              <th style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }} />
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => {
              const url = `${typeof window === "undefined" ? "" : window.location.origin}/invite/${invite.id}`;
              return (
                <tr key={invite.id} data-testid="hub-invite-row" data-invite-id={invite.id}>
                  <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
                    <button
                      type="button"
                      className="ghost"
                      title="Copy link"
                      onClick={() => {
                        void navigator.clipboard.writeText(url);
                        showToast("Link copied", "success");
                      }}
                    >
                      {invite.id}
                    </button>
                  </td>
                  <td style={{ padding: "0.5rem" }}>{invite.defaultRole ?? "—"}</td>
                  <td style={{ padding: "0.5rem" }}>
                    {invite.defaultServerId
                      ? serverNameById.get(invite.defaultServerId) ?? invite.defaultServerId
                      : "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {invite.defaultBadgeIds.length > 0
                      ? `${invite.defaultBadgeIds.length} badge${invite.defaultBadgeIds.length === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {invite.usesCount}
                    {invite.maxUses != null ? ` / ${invite.maxUses}` : ""}
                  </td>
                  <td style={{ padding: "0.5rem" }}>{new Date(invite.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "0.5rem", textAlign: "right" }}>
                    <button
                      type="button"
                      className="ghost"
                      data-testid="revoke-invite-button"
                      disabled={revoking === invite.id}
                      onClick={() => handleRevoke(invite.id)}
                    >
                      {revoking === invite.id ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
