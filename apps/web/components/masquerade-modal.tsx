"use client";

import React, { useState, useEffect } from "react";
import { useChat } from "../context/chat-context";
import { getMasqueradeToken, fetchBadges } from "../lib/control-plane";
import { useToast } from "./toast-provider";
import type { Role, Badge } from "@skerry/shared";

export function MasqueradeModal() {
  const { state, dispatch } = useChat();
  const { selectedServerId, servers, hubs } = state;
  const { showToast } = useToast();

  const [role, setRole] = useState<Role>("user");
  const [serverId, setServerId] = useState<string>(selectedServerId || "");
  const [availableBadges, setAvailableBadges] = useState<Badge[]>([]);
  const [selectedBadgeIds, setSelectedBadgeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (serverId) {
      fetchBadges(serverId)
        .then(setAvailableBadges)
        .catch(err => console.error("Failed to fetch badges", err));
    } else {
      setAvailableBadges([]);
    }
  }, [serverId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { token } = await getMasqueradeToken({
        role,
        serverId: serverId || undefined,
        badgeIds: selectedBadgeIds.length > 0 ? selectedBadgeIds : undefined
      });

      // Open new tab with token
      const url = new URL(window.location.origin);
      url.searchParams.set("masqueradeToken", token);
      window.open(url.toString(), "_blank");

      showToast("Masquerade session opened in a new tab.", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to initiate masquerade", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBadge = (badgeId: string) => {
    setSelectedBadgeIds(prev => 
      prev.includes(badgeId) 
        ? prev.filter(id => id !== badgeId) 
        : [...prev, badgeId]
    );
  };

  const isHubRole = role === "hub_owner" || role === "hub_admin";

  return (
    <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🎭 Masquerade as Role</h2>
          <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="masquerade-form">
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <optgroup label="Hub Roles">
                <option value="hub_owner">👑 Hub Owner</option>
                <option value="hub_admin">💎 Hub Admin</option>
              </optgroup>
              <optgroup label="Server Roles">
                <option value="space_owner">🏰 Space Owner</option>
                <option value="space_admin">⭐ Space Admin</option>
                <option value="space_moderator">🛡️ Space Moderator</option>
              </optgroup>
              <optgroup label="General">
                <option value="user">👤 Regular User</option>
                <option value="visitor">🌐 Visitor</option>
              </optgroup>
            </select>
          </div>

          {!isHubRole && role !== "visitor" && (
            <div className="field">
              <label>Target Server</label>
              <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
                <option value="">-- Select a Server --</option>
                {servers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {serverId && availableBadges.length > 0 && !isHubRole && (
            <div className="field">
              <label>Server Badges</label>
              <div className="badge-grid">
                {availableBadges.map(badge => (
                  <div 
                    key={badge.id} 
                    className={`badge-item ${selectedBadgeIds.includes(badge.id) ? 'selected' : ''}`}
                    onClick={() => toggleBadge(badge.id)}
                  >
                    <span className="badge-name">{badge.name}</span>
                    <span className="badge-rank">Rank {badge.rank}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="info-box">
             <p>This will open a <strong>Read-Only</strong> session in a new tab. Any messages you send will only be simulated locally.</p>
          </div>

          <div className="modal-actions">
            <button type="submit" className="primary-button" disabled={submitting || (!isHubRole && role !== "visitor" && role !== "user" && !serverId)}>
              {submitting ? "Initiating..." : "Launch Masquerade"}
            </button>
            <button type="button" className="secondary-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
              Cancel
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          backdrop-filter: blur(8px);
        }
        .modal-card {
          background: #1e1f22;
          border-radius: 12px;
          width: 480px;
          max-width: 95vw;
          box-shadow: 0 12px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
          overflow: hidden;
          color: #f2f3f5;
        }
        .modal-header {
          padding: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #2b2d31;
        }
        .modal-header h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
        }
        .close-button {
          background: none;
          border: none;
          color: #b5bac1;
          font-size: 1.2rem;
          cursor: pointer;
        }
        .masquerade-form {
          padding: 24px;
        }
        .field {
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .field label {
          font-size: 0.75rem;
          font-weight: 800;
          color: #b5bac1;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        select {
          background: #111214;
          border: 1px solid #000;
          color: #f2f3f5;
          padding: 12px;
          border-radius: 6px;
          font-family: inherit;
          width: 100%;
          font-size: 1rem;
        }
        .badge-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          max-height: 150px;
          overflow-y: auto;
          background: #111214;
          padding: 12px;
          border-radius: 6px;
        }
        .badge-item {
          background: #2b2d31;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          border: 2px solid transparent;
          display: flex;
          flex-direction: column;
          transition: all 0.2s;
        }
        .badge-item:hover {
          background: #35373c;
        }
        .badge-item.selected {
          border-color: #5865f2;
          background: rgba(88, 101, 242, 0.1);
        }
        .badge-name {
          font-weight: 600;
          font-size: 0.9rem;
        }
        .badge-rank {
          font-size: 0.7rem;
          color: #b5bac1;
        }
        .info-box {
          background: rgba(255, 170, 0, 0.1);
          border-left: 4px solid #faa61a;
          padding: 12px;
          margin: 24px 0;
          border-radius: 4px;
        }
        .info-box p {
          margin: 0;
          font-size: 0.85rem;
          line-height: 1.4;
          color: #f2f3f5;
        }
        .modal-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        button {
          padding: 12px;
          border-radius: 6px;
          border: none;
          font-weight: 700;
          cursor: pointer;
          font-size: 0.95rem;
        }
        .primary-button {
          background: #5865f2;
          color: white;
        }
        .primary-button:hover:not(:disabled) {
          background: #4752c4;
        }
        .primary-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .secondary-button {
          background: transparent;
          color: white;
        }
        .secondary-button:hover {
          background: rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </div>
  );
}
