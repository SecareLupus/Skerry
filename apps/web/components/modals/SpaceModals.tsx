"use client";

import { useRef } from "react";
import { PermissionsEditor } from "../permissions-editor";
import { updateServerSettings } from "../../lib/control-plane";
import type { Server } from "@skerry/shared";

const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" ");

interface SpaceModalsProps {
  activeModal: string | null;
  spaceSettingsTab: "general" | "permissions";
  setSpaceSettingsTab: (tab: "general" | "permissions") => void;
  spaceName: string;
  setSpaceName: (name: string) => void;
  spaceOwnership: "hub" | "self";
  setSpaceOwnership: (val: "hub" | "self") => void;
  renameSpaceId: string;
  renameSpaceName: string;
  renameSpaceIconUrl: string | null;
  iconFile: File | null;
  setIconFile: (file: File | null) => void;
  mutatingStructure: boolean;
  activeServer?: Server;
  servers: Server[];
  handleCreateSpace: (e: React.FormEvent) => Promise<void>;
  handleRenameSpace: (e: React.FormEvent) => Promise<void>;
  dispatch: (action: any) => void;
  showToast: (message: string, type: "success" | "error") => void;
  refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
}

export function SpaceModals({
  activeModal,
  spaceSettingsTab,
  setSpaceSettingsTab,
  spaceName,
  setSpaceName,
  spaceOwnership,
  setSpaceOwnership,
  renameSpaceId,
  renameSpaceName,
  renameSpaceIconUrl,
  iconFile,
  setIconFile,
  mutatingStructure,
  activeServer,
  servers,
  handleCreateSpace,
  handleRenameSpace,
  dispatch,
  showToast,
  refreshChatState
}: SpaceModalsProps) {
  const iconInputRef = useRef<HTMLInputElement>(null);

  if (activeModal === "create-space") {
    return (
      <form className="stack" onSubmit={(event) => {
        void handleCreateSpace(event);
        dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      }}>
        <label htmlFor="space-name-modal">Space Name</label>
        <input
          id="space-name-modal"
          autoFocus
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
        />

        <fieldset className="constrained-stack" style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem 0.75rem" }}>
          <legend style={{ fontSize: "0.85rem", padding: "0 0.25rem" }}>Ownership</legend>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.85rem", padding: "0.25rem 0" }}>
            <input
              type="radio"
              name="space-ownership"
              value="hub"
              checked={spaceOwnership === "hub"}
              onChange={() => setSpaceOwnership("hub")}
            />
            <span>
              <strong>Owned by the Hub</strong> — any hub admin can manage this space.
              Recommended unless you specifically want a single named owner.
            </span>
          </label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.85rem", padding: "0.25rem 0" }}>
            <input
              type="radio"
              name="space-ownership"
              value="self"
              checked={spaceOwnership === "self"}
              onChange={() => setSpaceOwnership("self")}
            />
            <span>
              <strong>Owned by me</strong> — you become the named space_owner.
              Hub admins still retain management rights at the hub level.
            </span>
          </label>
        </fieldset>

        <button type="submit" disabled={mutatingStructure}>Create Space</button>
      </form>
    );
  }

  if (activeModal === "rename-space") {
    return (
      <div className="stack">
        <div className="tabs">
          <button 
            className={cn("tab-button", spaceSettingsTab === "general" && "active")}
            onClick={() => setSpaceSettingsTab("general")}
          >
            General
          </button>
          <button 
            className={cn("tab-button", spaceSettingsTab === "permissions" && "active")}
            onClick={() => setSpaceSettingsTab("permissions")}
          >
            Permissions
          </button>
        </div>

        {spaceSettingsTab === "general" ? (
          <form className="constrained-stack" onSubmit={(event) => {
            void handleRenameSpace(event);
            dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
          }}>
            <label htmlFor="rename-space-modal">New Space Name</label>
            <input
              id="rename-space-modal"
              autoFocus
              value={renameSpaceName}
              onChange={(e) => dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: e.target.value } })}
              minLength={2}
              maxLength={80}
              required
            />

            <div className="form-section">
              <label>Space Icon</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                <div className="server-icon-placeholder" style={{ width: '64px', height: '64px', fontSize: '1.5rem' }}>
                  {iconFile ? (
                    <img src={URL.createObjectURL(iconFile)} alt="" className="server-icon-image" />
                  ) : renameSpaceIconUrl ? (
                    <img src={renameSpaceIconUrl} alt="" className="server-icon-image" />
                  ) : (
                    renameSpaceName.charAt(0).toUpperCase() || '?'
                  )}
                </div>
                <div className="constrained-stack" style={{ gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => iconInputRef.current?.click()}
                  >
                    {renameSpaceIconUrl || iconFile ? 'Change Icon' : 'Upload Icon'}
                  </button>
                  {(renameSpaceIconUrl || iconFile) && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => {
                        setIconFile(null);
                        dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: renameSpaceName, iconUrl: null } });
                      }}
                    >
                      Remove Icon
                    </button>
                  )}
                </div>
                <input
                  type="file"
                  ref={iconInputRef}
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setIconFile(file);
                  }}
                />
              </div>
            </div>
            <button type="submit" disabled={mutatingStructure}>Save Changes</button>
          </form>
        ) : (() => {
          const serverToEdit = servers.find(s => s.id === renameSpaceId) || activeServer;
          return (
            <PermissionsEditor
              serverId={renameSpaceId}
              initialAccess={{
                hubAdminAccess: serverToEdit?.hubAdminAccess ?? 'chat',
                spaceAdminAccess: serverToEdit?.spaceAdminAccess ?? 'chat',
                spaceModeratorAccess: serverToEdit?.spaceModeratorAccess ?? 'chat',
                spaceMemberAccess: serverToEdit?.spaceMemberAccess ?? 'chat',
                hubMemberAccess: serverToEdit?.hubMemberAccess ?? 'chat',
                visitorAccess: serverToEdit?.visitorAccess ?? 'hidden',
                joinPolicy: serverToEdit?.joinPolicy,
                autoJoinHubMembers: serverToEdit?.autoJoinHubMembers ?? false
              }}
              onSaveDefaults={async (access) => {
                await updateServerSettings(renameSpaceId, access);
                showToast("Permissions updated", "success");
                void refreshChatState(undefined, undefined, undefined, true);
              }}
            />
          );
        })()}
      </div>
    );
  }

  return null;
}
