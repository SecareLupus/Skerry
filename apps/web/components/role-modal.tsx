"use client";

import React, { useState } from "react";
import { useChat } from "../context/chat-context";
import { grantRole } from "../lib/control-plane";
import { useToast } from "./toast-provider";
import type { Role } from "@skerry/shared";

export function RoleModal() {
  const { state, dispatch } = useChat();
  const {
    moderationTargetUserId,
    moderationTargetDisplayName,
    selectedServerId,
    hubs
  } = state;
  const { showToast } = useToast();

  const [role, setRole] = useState<Role>("space_moderator");
  const [scope, setScope] = useState<"space" | "hub">("space");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moderationTargetUserId) return;

    setSubmitting(true);
    try {
      const hubId = hubs[0]?.id;
      
      await grantRole({
        productUserId: moderationTargetUserId,
        role,
        hubId: scope === "hub" ? hubId : undefined,
        serverId: scope === "space" ? (selectedServerId || undefined) : undefined,
      });

      showToast(`Successfully granted role ${role} to ${moderationTargetDisplayName}`, "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to grant role", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!moderationTargetUserId) return null;

  return (
    <div className="modal-overlay" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Grant Role to {moderationTargetDisplayName}</h2>
          <button className="close-button" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="role-form">
          <div className="field">
            <label>Select Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="user">👤 Regular User</option>
              <option value="space_moderator">🛡️ Space Moderator</option>
              <option value="space_owner">👑 Space Owner</option>
              <option value="hub_admin">💎 Hub Administrator</option>
            </select>
            <p className="help-text">
              Selecting a role grants the user administrative privileges within the chosen scope.
            </p>
          </div>

          <div className="field">
            <label>Assignment Scope</label>
            <div className="scope-options">
              <label className={`scope-option ${scope === "space" ? "active" : ""}`}>
                <input type="radio" name="scope" value="space" checked={scope === "space"} onChange={() => setScope("space")} />
                <span>Current Space</span>
              </label>
              <label className={`scope-option ${scope === "hub" ? "active" : ""}`}>
                <input type="radio" name="scope" value="hub" checked={scope === "hub"} onChange={() => setScope("hub")} />
                <span>Entire Hub</span>
              </label>
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Granting..." : "Confirm Grant"}
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
        .role-form {
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
        .help-text {
          font-size: 0.7rem;
          color: #b5bac1;
          margin: 0;
        }
        select {
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
        .primary-button {
          background: #5865f2;
          color: white;
        }
        .primary-button:hover {
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
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
