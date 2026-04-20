"use client";

import React, { useState, useEffect } from "react";
import { performModerationAction, getUserModerationStatus } from "../../lib/control-plane";

interface ModerationModalProps {
  targetUserId: string;
  targetDisplayName: string;
  serverId: string;
  hubId?: string; // Optional hubId
  onClose: () => void;
  showToast: (message: string, type: "success" | "error") => void;
  refreshChatState: () => Promise<void>;
}

export function ModerationModal({
  targetUserId,
  targetDisplayName,
  serverId,
  hubId,
  onClose,
  showToast,
  refreshChatState
}: ModerationModalProps) {
  const [action, setAction] = useState<"kick" | "ban" | "timeout" | "warn" | "strike">("kick");
  const [scope, setScope] = useState<"hub" | "server" | "channel">("channel");
  const [reason, setReason] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600); // 1 hour default
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ warningCount: number; strikeCount: number } | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await getUserModerationStatus(targetUserId, { serverId });
        setStatus(res);
      } catch (e) {
        console.error("Failed to fetch user moderation status", e);
      }
    }
    fetchStatus();
  }, [targetUserId, serverId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      showToast("Please provide a reason", "error");
      return;
    }

    setLoading(true);
    try {
      await performModerationAction({
        action,
        hubId: scope === "hub" ? hubId : undefined,
        serverId: scope === "server" ? serverId : undefined,
        targetUserId,
        reason,
        timeoutSeconds: action === "timeout" ? timeoutSeconds : undefined
      });
      showToast(`User ${action === "kick" ? "kicked" : action === "ban" ? "banned" : action === "timeout" ? "timed out" : "warned"} successfully`, "success");
      onClose();
      // Only refresh if we did a kick or ban that would affect the current view
      if (action === "kick" || action === "ban") {
        await refreshChatState();
      }
    } catch (err: any) {
      showToast(err.message || "Failed to perform moderation action", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="stack" onSubmit={handleSubmit} data-testid="moderation-modal">
      <div className="moderation-target-info">
        <p>Moderating <strong>{targetDisplayName}</strong></p>
        {status && (
          <p className="text-muted" style={{ fontSize: '0.8rem' }}>
            Current: {status.warningCount} warnings, {status.strikeCount} strikes
          </p>
        )}
      </div>

      <div className="form-section">
        <label htmlFor="mod-action">Action</label>
        <select
          id="mod-action"
          value={action}
          onChange={(e) => setAction(e.target.value as any)}
          data-testid="moderation-action-select"
        >
          <option value="warn">Warn</option>
          <option value="strike">Add Strike</option>
          <option value="timeout">Timeout</option>
          <option value="kick">Kick</option>
          <option value="ban">Ban</option>
        </select>
      </div>

      <div className="form-section">
        <label>Scope</label>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input 
              type="radio" 
              name="scope" 
              value="channel" 
              checked={scope === "channel"} 
              onChange={() => setScope("channel")} 
            />
            Room
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input 
              type="radio" 
              name="scope" 
              value="server" 
              checked={scope === "server"} 
              onChange={() => setScope("server")} 
            />
            Space
          </label>
          {hubId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input 
                type="radio" 
                name="scope" 
                value="hub" 
                checked={scope === "hub"} 
                onChange={() => setScope("hub")} 
              />
              Hub
            </label>
          )}
        </div>
      </div>

      {action === "timeout" && (
        <div className="form-section">
          <label htmlFor="timeout-duration">Duration</label>
          <select
            id="timeout-duration"
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
          >
            <option value={60}>1 Minute</option>
            <option value={300}>5 Minutes</option>
            <option value={3600}>1 Hour</option>
            <option value={86400}>24 Hours</option>
            <option value={604800}>7 Days</option>
          </select>
        </div>
      )}

      <div className="form-section">
        <label htmlFor="mod-reason">Reason</label>
        <textarea
          id="mod-reason"
          placeholder="Required reason for this action..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          maxLength={500}
          required
          autoFocus
          data-testid="moderation-reason-input"
        />
      </div>

      <div className="modal-footer" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button 
          type="submit" 
          className={action === "ban" || action === "kick" ? "danger" : "primary"}
          disabled={loading}
          data-testid="confirm-moderation-button"
        >
          {loading ? "Processing..." : `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`}
        </button>
      </div>
    </form>
  );
}
