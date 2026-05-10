"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useChat } from "../context/chat-context";
import { getMasqueradeToken, fetchBadges } from "../lib/control-plane";
import { useToast } from "./toast-provider";
import type { Role, Badge } from "@skerry/shared";

const HUB_ROLES: { value: Role; label: string; description: string }[] = [
  { value: "hub_owner", label: "Hub Owner", description: "Full hub control including suspension." },
  { value: "hub_admin",  label: "Hub Admin",  description: "Full hub control excluding suspension." },
];

const SERVER_ROLES: { value: Role; label: string; description: string }[] = [
  { value: "space_owner",     label: "Space Owner",     description: "Full server control: channels, badges, moderation." },
  { value: "space_admin",     label: "Space Admin",     description: "Same as Space Owner." },
  { value: "space_moderator", label: "Space Moderator", description: "Kick, ban, timeout, reports. No channel/badge management." },
];

// "Member" and "Visitor" tiers used to be selectable here. P1 of the
// permissions sprint removed them from the Role enum because they are
// derived from membership state, not from granted role bindings. To
// preview the Member experience, the operator should join the relevant
// hub/server with a regular account; to preview the Visitor experience,
// they should browse signed-out.

function isHubRole(role: Role) {
  return role === "hub_owner" || role === "hub_admin";
}

function needsServer(role: Role) {
  return !isHubRole(role);
}

export function MasqueradeDrawer() {
  const { state, dispatch } = useChat();
  const isDark = state.theme !== "light";
  const { servers, viewerRoles } = state;
  const { showToast } = useToast();

  const [role, setRole] = useState<Role>("space_moderator");
  const [serverId, setServerId] = useState<string>("");
  const [availableBadges, setAvailableBadges] = useState<Badge[]>([]);
  const [selectedBadgeIds, setSelectedBadgeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Determine if the acting user is a hub-level admin (can see hub roles and all servers)
  const isHubAdmin = useMemo(
    () => viewerRoles.some(r => r.role === "hub_owner" || r.role === "hub_admin"),
    [viewerRoles]
  );

  // Servers this user may masquerade within
  const allowedServers = useMemo(() => {
    if (isHubAdmin) return servers;
    const adminServerIds = new Set(
      viewerRoles
        .filter(r => r.role === "space_owner" || r.role === "space_admin")
        .map(r => r.serverId)
        .filter(Boolean) as string[]
    );
    return servers.filter(s => adminServerIds.has(s.id));
  }, [isHubAdmin, servers, viewerRoles]);

  // When role changes to a hub role, clear server selection
  useEffect(() => {
    if (isHubRole(role)) {
      setServerId("");
      setSelectedBadgeIds([]);
    }
  }, [role]);

  // Fetch badges whenever the selected server changes
  useEffect(() => {
    setSelectedBadgeIds([]);
    if (serverId) {
      fetchBadges(serverId)
        .then(setAvailableBadges)
        .catch(() => setAvailableBadges([]));
    } else {
      setAvailableBadges([]);
    }
  }, [serverId]);

  const selectedServer = allowedServers.find(s => s.id === serverId);

  const previewLine = useMemo(() => {
    const roleLabel =
      [...HUB_ROLES, ...SERVER_ROLES].find(r => r.value === role)?.label ?? role;
    const parts: string[] = [roleLabel];
    if (selectedServer) parts.push(selectedServer.name);
    if (selectedBadgeIds.length > 0)
      parts.push(`${selectedBadgeIds.length} badge${selectedBadgeIds.length > 1 ? "s" : ""}`);
    return parts.join(" · ");
  }, [role, selectedServer, selectedBadgeIds]);

  const canLaunch = !submitting && (isHubRole(role) || !!serverId);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { token } = await getMasqueradeToken({
        role,
        serverId: serverId || undefined,
        badgeIds: selectedBadgeIds.length > 0 ? selectedBadgeIds : undefined,
      });
      const url = new URL(window.location.origin);
      url.searchParams.set("masqueradeToken", token);
      window.open(url.toString(), "_blank");
      showToast("Preview session opened in a new tab.", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to start masquerade", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBadge = (id: string) =>
    setSelectedBadgeIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const allBadgesSelected =
    availableBadges.length > 0 && selectedBadgeIds.length === availableBadges.length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="mq-backdrop"
        onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
      />

      {/* Drawer */}
      <aside className="mq-drawer" role="dialog" aria-modal="true" aria-label="Masquerade as Role">
        {/* Header */}
        <div className="mq-header">
          <div className="mq-header-title">
            <span className="mq-icon">🎭</span>
            <span>Masquerade</span>
          </div>
          <button
            className="mq-close"
            aria-label="Close"
            onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
          >
            ✕
          </button>
        </div>

        <form className="mq-body" onSubmit={handleLaunch}>
          {/* Role Section */}
          <section className="mq-section">
            <div className="mq-section-label">Role</div>
            <div className="mq-role-group">
              {isHubAdmin && (
                <>
                  <div className="mq-role-group-title">Hub Roles</div>
                  {HUB_ROLES.map(r => (
                    <RoleCard
                      key={r.value}
                      {...r}
                      isDark={isDark}
                      selected={role === r.value}
                      onSelect={() => setRole(r.value)}
                    />
                  ))}
                  <div className="mq-divider" />
                  <div className="mq-role-group-title">Server Roles</div>
                </>
              )}
              {SERVER_ROLES.map(r => (
                <RoleCard
                  key={r.value}
                  {...r}
                  isDark={isDark}
                  selected={role === r.value}
                  onSelect={() => setRole(r.value)}
                />
              ))}
            </div>
          </section>

          {/* Server Section */}
          <section className={`mq-section mq-section-collapsible ${needsServer(role) ? "mq-section-active" : ""}`}>
            <div className="mq-section-label">
              Server
              {!needsServer(role) && <span className="mq-section-inactive-note"> — not applicable for this role</span>}
            </div>
            <div className="mq-server-list">
              {allowedServers.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`mq-server-item ${serverId === s.id ? "mq-server-item-selected" : ""}`}
                  onClick={() => setServerId(prev => prev === s.id ? "" : s.id)}
                  disabled={!needsServer(role)}
                >
                  <span className="mq-server-name">{s.name}</span>
                  {serverId === s.id && <span className="mq-check">✓</span>}
                </button>
              ))}
              {allowedServers.length === 0 && (
                <p className="mq-empty">No servers available.</p>
              )}
            </div>
          </section>

          {/* Badge Section */}
          <section className={`mq-section mq-section-collapsible ${serverId && needsServer(role) ? "mq-section-active" : ""}`}>
            <div className="mq-section-label-row">
              <span className="mq-section-label">
                Badges
                {(!serverId || !needsServer(role)) && (
                  <span className="mq-section-inactive-note"> — select a server first</span>
                )}
              </span>
              {availableBadges.length > 0 && serverId && needsServer(role) && (
                <button
                  type="button"
                  className="mq-toggle-all"
                  onClick={() =>
                    setSelectedBadgeIds(allBadgesSelected ? [] : availableBadges.map(b => b.id))
                  }
                >
                  {allBadgesSelected ? "Clear All" : "Select All"}
                </button>
              )}
            </div>
            <div className="mq-badge-list">
              {availableBadges.length === 0 && serverId && needsServer(role) && (
                <p className="mq-empty">No badges on this server.</p>
              )}
              {availableBadges.map(badge => (
                <button
                  key={badge.id}
                  type="button"
                  className={`mq-badge-chip ${selectedBadgeIds.includes(badge.id) ? "mq-badge-chip-selected" : ""}`}
                  onClick={() => toggleBadge(badge.id)}
                  disabled={!serverId || !needsServer(role)}
                >
                  <span className="mq-badge-name">{badge.name}</span>
                  <span className="mq-badge-rank">Rank {badge.rank}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div className="mq-footer">
            <div className="mq-preview">
              <span className="mq-preview-label">Preview:</span>
              <span className="mq-preview-value">{previewLine}</span>
            </div>
            <div className="mq-footer-note">Read-only · Messages are simulated locally</div>
            <button
              type="submit"
              className="mq-launch-btn"
              disabled={!canLaunch}
            >
              {submitting ? "Launching…" : "Launch Read-Only Preview"}
            </button>
          </div>
        </form>
      </aside>

      <style jsx>{`
        .mq-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          z-index: 1999;
        }

        .mq-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 360px;
          max-width: 100vw;
          background: ${isDark ? "#1e1f22" : "#ffffff"};
          border-left: 1px solid ${isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.08)"};
          display: flex;
          flex-direction: column;
          z-index: 2000;
          box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
          animation: mq-slide-in 0.2s ease;
        }

        @keyframes mq-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }

        /* Header */
        .mq-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          background: ${isDark ? "#2b2d31" : "#f2f3f5"};
          border-bottom: 1px solid ${isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.08)"};
          flex-shrink: 0;
        }
        .mq-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1rem;
          font-weight: 700;
          color: ${isDark ? "#f2f3f5" : "#313338"};
        }
        .mq-icon {
          font-size: 1.25rem;
        }
        .mq-close {
          background: none;
          border: none;
          color: ${isDark ? "#b5bac1" : "#5c5e66"};
          font-size: 1rem;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .mq-close:hover {
          background: ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"};
          color: ${isDark ? "#f2f3f5" : "#313338"};
        }

        /* Body */
        .mq-body {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* Sections */
        .mq-section {
          padding: 16px 20px;
          border-bottom: 1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)"};
        }
        .mq-section-collapsible {
          opacity: 0.4;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }
        .mq-section-collapsible.mq-section-active {
          opacity: 1;
          pointer-events: auto;
        }
        .mq-section-label {
          font-size: 0.7rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: ${isDark ? "#b5bac1" : "#5c5e66"};
          margin-bottom: 10px;
        }
        .mq-section-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .mq-section-label-row .mq-section-label {
          margin-bottom: 0;
        }
        .mq-section-inactive-note {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          opacity: 0.6;
        }

        /* Role cards */
        .mq-role-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .mq-role-group-title {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: ${isDark ? "#72767d" : "#94999e"};
          margin: 8px 0 4px;
        }
        .mq-role-group-title:first-child {
          margin-top: 0;
        }
        .mq-divider {
          height: 1px;
          background: ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)"};
          margin: 8px 0;
        }

        /* Server list */
        .mq-server-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .mq-server-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: ${isDark ? "#2b2d31" : "#f2f3f5"};
          border: 2px solid transparent;
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
          color: ${isDark ? "#f2f3f5" : "#313338"};
          font-size: 0.9rem;
          text-align: left;
          transition: border-color 0.12s, background 0.12s;
        }
        .mq-server-item:hover:not(:disabled) {
          background: ${isDark ? "#35373c" : "#e3e5e8"};
        }
        .mq-server-item-selected {
          border-color: #5865f2;
          background: rgba(88, 101, 242, 0.12);
        }
        .mq-server-item:disabled {
          cursor: not-allowed;
        }
        .mq-server-name {
          font-weight: 500;
        }
        .mq-check {
          color: #5865f2;
          font-weight: 700;
          font-size: 0.85rem;
        }

        /* Badge chips */
        .mq-badge-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .mq-badge-chip {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          background: ${isDark ? "#2b2d31" : "#f2f3f5"};
          border: 2px solid transparent;
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          color: ${isDark ? "#f2f3f5" : "#313338"};
          transition: border-color 0.12s, background 0.12s;
        }
        .mq-badge-chip:hover:not(:disabled) {
          background: ${isDark ? "#35373c" : "#e3e5e8"};
        }
        .mq-badge-chip-selected {
          border-color: #5865f2;
          background: rgba(88, 101, 242, 0.12);
        }
        .mq-badge-chip:disabled {
          cursor: not-allowed;
        }
        .mq-badge-name {
          font-size: 0.85rem;
          font-weight: 600;
        }
        .mq-badge-rank {
          font-size: 0.7rem;
          color: ${isDark ? "#b5bac1" : "#5c5e66"};
        }

        .mq-toggle-all {
          background: none;
          border: none;
          color: #5865f2;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .mq-toggle-all:hover {
          background: rgba(88, 101, 242, 0.1);
        }

        .mq-empty {
          font-size: 0.82rem;
          color: ${isDark ? "#72767d" : "#94999e"};
          margin: 0;
          padding: 4px 0;
        }

        /* Footer */
        .mq-footer {
          flex-shrink: 0;
          padding: 16px 20px;
          background: ${isDark ? "#2b2d31" : "#f2f3f5"};
          border-top: 1px solid ${isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.08)"};
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mq-preview {
          display: flex;
          align-items: baseline;
          gap: 6px;
          background: ${isDark ? "#111214" : "#e3e5e8"};
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 0.82rem;
          min-height: 34px;
        }
        .mq-preview-label {
          color: ${isDark ? "#72767d" : "#94999e"};
          font-weight: 700;
          flex-shrink: 0;
        }
        .mq-preview-value {
          color: ${isDark ? "#f2f3f5" : "#313338"};
          font-weight: 500;
          word-break: break-word;
        }
        .mq-footer-note {
          font-size: 0.72rem;
          color: ${isDark ? "#72767d" : "#94999e"};
          text-align: center;
        }
        .mq-launch-btn {
          background: #5865f2;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 11px;
          font-size: 0.95rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.12s;
        }
        .mq-launch-btn:hover:not(:disabled) {
          background: #4752c4;
        }
        .mq-launch-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}

interface RoleCardProps {
  value: Role;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  isDark: boolean;
}

function RoleCard({ label, description, selected, onSelect, isDark }: RoleCardProps) {
  return (
    <button
      type="button"
      className={`mq-role-card ${selected ? "mq-role-card-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="mq-role-card-label">{label}</span>
      <span className="mq-role-card-desc">{description}</span>
      <style jsx>{`
        .mq-role-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          background: ${isDark ? "#2b2d31" : "#f2f3f5"};
          border: 2px solid transparent;
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
          color: ${isDark ? "#f2f3f5" : "#313338"};
          text-align: left;
          width: 100%;
          transition: border-color 0.12s, background 0.12s;
          gap: 2px;
        }
        .mq-role-card:hover {
          background: ${isDark ? "#35373c" : "#e3e5e8"};
        }
        .mq-role-card-selected {
          border-color: #5865f2;
          background: rgba(88, 101, 242, 0.12);
        }
        .mq-role-card-label {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .mq-role-card-desc {
          font-size: 0.75rem;
          color: ${isDark ? "#b5bac1" : "#5c5e66"};
          line-height: 1.3;
        }
      `}</style>
    </button>
  );
}
