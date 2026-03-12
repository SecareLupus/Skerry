"use client";

import React, { useState, useMemo } from "react";
import { useChat } from "../context/chat-context";
import { performModerationAction } from "../lib/control-plane";
import { useToast } from "./toast-provider";

export function ModerationModal() {
  const { state, dispatch } = useChat();
  const {
    moderationTargetUserId,
    moderationTargetDisplayName,
    moderationTargetMessageId,
    selectedServerId,
    selectedChannelId,
    viewerRoles,
    hubs
  } = state;
  const { showToast } = useToast();

  const [action, setAction] = useState<"warn" | "strike" | "timeout" | "kick" | "ban" | "unban">("warn");
  const [scope, setScope] = useState<"room" | "space" | "hub">("room");
  const [reason, setReason] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600);
  const [submitting, setSubmitting] = useState(false);

  const activeChannel = state.channels.find(c => c.id === (moderationTargetMessageId ? state.messages.find(m => m.id === moderationTargetMessageId)?.channelId : selectedChannelId));
  const activeServer = state.servers.find(s => s.id === (activeChannel?.serverId || selectedServerId));

  const canManageHub = useMemo(
    () => viewerRoles.some((binding) => binding.role === "hub_admin" && !binding.serverId),
    [viewerRoles]
  );

  const canManageServer = useMemo(
    () => viewerRoles.some((binding) => 
        (binding.role === "hub_admin" || binding.role === "space_owner") && 
        (binding.serverId === selectedServerId || !binding.serverId)
    ),
    [viewerRoles, selectedServerId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moderationTargetUserId) return;

    setSubmitting(true);
    try {
      const hubId = hubs[0]?.id; // Take first hub for now, usually only one
      
      await performModerationAction({
        action,
        hubId: scope === "hub" ? hubId : undefined,
        serverId: (scope === "space" || scope === "room") ? (activeServer?.id || selectedServerId || "") : undefined,
        channelId: scope === "room" ? (activeChannel?.id || selectedChannelId || undefined) : undefined,
        targetUserId: moderationTargetUserId,
        reason: reason || `Action: ${action} via moderation panel`,
        timeoutSeconds: action === "timeout" ? timeoutSeconds : undefined
      });

      showToast(`Successfully performed ${action} on ${moderationTargetDisplayName}`, "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Moderation action failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!moderationTargetUserId) return null;

  return (
    <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Moderate {moderationTargetDisplayName}</h2>
          <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="moderation-form">
          <div className="field">
            <label>Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value as any)}>
              <option value="warn">⚠️ Warn</option>
              <option value="strike">❗ Strike (Escalation)</option>
              <option value="timeout">⏳ Timeout (Mute)</option>
              <option value="kick">👢 Kick</option>
              <option value="ban">🚫 Ban</option>
              <option value="unban">🔓 Unban</option>
            </select>
          </div>

          <div className="field">
            <label>Scope</label>
            <div className="scope-options">
              <label className={`scope-option ${scope === "room" ? "active" : ""}`}>
                <input type="radio" name="scope" value="room" checked={scope === "room"} onChange={() => setScope("room")} />
                <span>Room {activeChannel ? `(#${activeChannel.name})` : ""}</span>
              </label>
              <label className={`scope-option ${scope === "space" ? "active" : ""} ${!canManageServer ? "disabled" : ""}`}>
                <input type="radio" name="scope" value="space" checked={scope === "space"} disabled={!canManageServer} onChange={() => setScope("space")} />
                <span>Space {activeServer ? `(${activeServer.name})` : ""}</span>
              </label>
              <label className={`scope-option ${scope === "hub" ? "active" : ""} ${!canManageHub ? "disabled" : ""}`}>
                <input type="radio" name="scope" value="hub" checked={scope === "hub"} disabled={!canManageHub} onChange={() => setScope("hub")} />
                <span>Hub</span>
              </label>
            </div>
          </div>

          {action === "timeout" && (
            <div className="field">
              <label>Duration</label>
              <select value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(parseInt(e.target.value, 10))}>
                <option value={60}>1 Minute</option>
                <option value={300}>5 Minutes</option>
                <option value={600}>10 Minutes</option>
                <option value={3600}>1 Hour</option>
                <option value={86400}>24 Hours</option>
                <option value={604800}>1 Week</option>
                <option value={2419200}>1 Month</option>
              </select>
            </div>
          )}

          <div className="field">
            <label>Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the reason for this action..."
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="modal-actions">
            <button type="submit" className="danger-button" disabled={submitting}>
              {submitting ? "Processing..." : `Execute ${action.charAt(0).toUpperCase() + action.slice(1)}`}
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
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          backdrop-filter: blur(4px);
        }
        .modal-card {
          background: #1e1f22;
          border-radius: 8px;
          width: 440px;
          max-width: 90vw;
          box-shadow: 0 8px 16px rgba(0,0,0,0.4);
          overflow: hidden;
          color: #f2f3f5;
        }
        .modal-header {
          padding: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #2b2d31;
        }
        .modal-header h2 {
          margin: 0;
          font-size: 1.2rem;
        }
        .close-button {
          background: none;
          border: none;
          color: #b5bac1;
          font-size: 1.2rem;
          cursor: pointer;
        }
        .moderation-form {
          padding: 16px;
        }
        .field {
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .field label {
          font-size: 0.75rem;
          font-weight: 700;
          color: #b5bac1;
          text-transform: uppercase;
        }
        select, textarea {
          background: #111214;
          border: none;
          color: #f2f3f5;
          padding: 10px;
          border-radius: 4px;
          font-family: inherit;
          width: 100%;
        }
        .scope-options {
          display: flex;
          gap: 8px;
        }
        .scope-option {
          flex: 1;
          background: #2b2d31;
          padding: 8px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
          border: 1px solid transparent;
        }
        .scope-option.active {
          background: #35373c;
          border-color: #5865f2;
        }
        .scope-option.disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .scope-option input {
          display: none;
        }
        .modal-actions {
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        button {
          padding: 10px;
          border-radius: 4px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
        }
        .danger-button {
          background: #da373c;
          color: white;
        }
        .danger-button:hover {
          background: #a92b2f;
        }
        .secondary-button {
          background: transparent;
          color: white;
        }
        .secondary-button:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
