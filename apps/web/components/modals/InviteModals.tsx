import { useEffect, useMemo, useState } from "react";
import { createHubInvite, fetchBadges, inviteToChannel } from "../../lib/control-plane";
import type { Badge, IdentityMapping, InviteBakeableRole, Role, Server } from "@skerry/shared";
import { INVITE_BAKEABLE_ROLES } from "@skerry/shared";

interface InviteModalsProps {
  isInviting: boolean;
  setIsInviting: (val: boolean) => void;
  isCreatingHubInvite: boolean;
  setIsCreatingHubInvite: (val: boolean) => void;
  userSearchQuery: string;
  setUserSearchQuery: (val: string) => void;
  userSearchResults: IdentityMapping[];
  activeServer?: Server;
  hubServers: Server[];
  selectedChannelId: string | null;
  lastInviteUrl: string | null;
  setLastInviteUrl: (val: string | null) => void;
  showToast: (message: string, type: "success" | "error") => void;
}

const ROLE_PICKER_LABELS: Record<InviteBakeableRole, string> = {
  space_moderator: "Space moderator",
  space_admin: "Space admin"
};

export function InviteModals({
  isInviting,
  setIsInviting,
  isCreatingHubInvite,
  setIsCreatingHubInvite,
  userSearchQuery,
  setUserSearchQuery,
  userSearchResults,
  activeServer,
  hubServers,
  selectedChannelId,
  lastInviteUrl,
  setLastInviteUrl,
  showToast
}: InviteModalsProps) {
  const [defaultRole, setDefaultRole] = useState<"" | Role>("");
  const [defaultServerId, setDefaultServerId] = useState<string>("");
  const [defaultBadgeIds, setDefaultBadgeIds] = useState<string[]>([]);
  const [hubBadges, setHubBadges] = useState<Badge[]>([]);

  const inviteHubId = activeServer?.hubId || activeServer?.id || null;
  const serversInHub = useMemo(
    () => hubServers.filter((s) => s.hubId === inviteHubId || s.id === inviteHubId),
    [hubServers, inviteHubId]
  );
  const isSpaceScopedRole = defaultRole.startsWith("space_");

  // Reset pickers when the modal closes so reopening doesn't show stale selections.
  useEffect(() => {
    if (!isCreatingHubInvite) {
      setDefaultRole("");
      setDefaultServerId("");
      setDefaultBadgeIds([]);
    }
  }, [isCreatingHubInvite]);

  // Load badges from every server in the hub when the modal opens.
  useEffect(() => {
    if (!isCreatingHubInvite || serversInHub.length === 0) {
      setHubBadges([]);
      return;
    }
    let cancelled = false;
    void Promise.all(serversInHub.map((s) => fetchBadges(s.id).catch(() => [] as Badge[])))
      .then((results) => {
        if (cancelled) return;
        setHubBadges(results.flat());
      });
    return () => {
      cancelled = true;
    };
  }, [isCreatingHubInvite, serversInHub]);
  useEffect(() => {
    if (!isCreatingHubInvite && !isInviting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isCreatingHubInvite) {
          setIsCreatingHubInvite(false);
          setLastInviteUrl(null);
        }
        if (isInviting) setIsInviting(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCreatingHubInvite, isInviting, setIsCreatingHubInvite, setIsInviting, setLastInviteUrl]);

  if (isInviting) {
    return (
      <div className="modal-backdrop" data-testid="modal-backdrop" onClick={() => setIsInviting(false)}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
          <header className="modal-header">
            <h2>Invite to DM</h2>
            <button type="button" className="ghost" onClick={() => setIsInviting(false)}>×</button>
          </header>
          <div className="stack" style={{ padding: "1rem" }}>
            <input
              type="text"
              placeholder="Search by username..."
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              autoFocus
              style={{ width: "100%" }}
            />
            <div className="search-results scroller" style={{ maxHeight: "300px", marginTop: "1rem", border: "1px solid var(--border)", borderRadius: "4px" }}>
              {userSearchResults.length > 0 ? (
                userSearchResults.map((user) => (
                  <div key={user.productUserId} style={{ padding: "0.75rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{user.displayName}</span>
                    <button
                      className="ghost"
                      onClick={async () => {
                        try {
                          if (!selectedChannelId) return;
                          await inviteToChannel(selectedChannelId, user.productUserId);
                          showToast(`Invited ${user.displayName}`, "success");
                          setIsInviting(false);
                        } catch (err) {
                          showToast("Invite failed", "error");
                        }
                      }}
                    >
                      Invite
                    </button>
                  </div>
                ))
              ) : (
                <p style={{ padding: "1rem", textAlign: "center", opacity: 0.6 }}>No users found</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCreatingHubInvite) {
    return (
      <div className="modal-backdrop" data-testid="hub-invite-modal" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
          <header className="modal-header">
            <h2>Create Hub Invite Link</h2>
            <button type="button" className="ghost" data-testid="close-invite-modal" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>×</button>
          </header>
          <div className="stack" style={{ padding: "1.5rem", textAlign: "left" }}>
            {!lastInviteUrl ? (
              <>
                <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1rem" }}>
                  This will create a link that anyone can use to join this hub.
                </p>
                <label className="stack" style={{ gap: "0.25rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  <span>Default role</span>
                  <select
                    data-testid="invite-default-role"
                    value={defaultRole}
                    onChange={(e) => {
                      const next = e.target.value as "" | Role;
                      setDefaultRole(next);
                      // Space-scoped roles need a server; clear non-applicable selection.
                      if (next && !next.startsWith("space_")) {
                        // hub-wide role; the server picker remains optional.
                      }
                    }}
                    style={{ width: "100%" }}
                  >
                    <option value="">No additional role (member only)</option>
                    {INVITE_BAKEABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_PICKER_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stack" style={{ gap: "0.25rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
                  <span>
                    Place new members in
                    {isSpaceScopedRole ? <span aria-hidden="true"> *</span> : null}
                  </span>
                  <select
                    data-testid="invite-default-server"
                    value={defaultServerId}
                    onChange={(e) => setDefaultServerId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">Any server (auto-join only)</option>
                    {serversInHub.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {isSpaceScopedRole && !defaultServerId ? (
                    <small style={{ color: "var(--danger, #c33)" }}>
                      A space-scoped role requires a target server.
                    </small>
                  ) : null}
                </label>
                {hubBadges.length > 0 ? (
                  <fieldset
                    data-testid="invite-default-badges"
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      padding: "0.5rem 0.75rem",
                      marginBottom: "1rem",
                      maxHeight: "140px",
                      overflowY: "auto"
                    }}
                  >
                    <legend style={{ fontSize: "0.85rem", padding: "0 0.25rem" }}>
                      Default badges (optional)
                    </legend>
                    {hubBadges.map((badge) => {
                      const checked = defaultBadgeIds.includes(badge.id);
                      return (
                        <label
                          key={badge.id}
                          style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem", padding: "0.15rem 0" }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setDefaultBadgeIds((prev) =>
                                e.target.checked
                                  ? [...prev, badge.id]
                                  : prev.filter((id) => id !== badge.id)
                              );
                            }}
                          />
                          <span>{badge.name}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      // Prefer hubId, then fall back to id (some servers ARE the hub)
                      const hubId = activeServer?.hubId || activeServer?.id;
                      if (!hubId) {
                        showToast("Could not determine Hub ID", "error");
                        return;
                      }
                      if (isSpaceScopedRole && !defaultServerId) {
                        showToast("Pick a server for the space-scoped role.", "error");
                        return;
                      }
                      const invite = await createHubInvite(hubId, {
                        defaultRole: defaultRole === "" ? undefined : defaultRole,
                        defaultServerId: defaultServerId === "" ? undefined : defaultServerId,
                        defaultBadgeIds: defaultBadgeIds.length > 0 ? defaultBadgeIds : undefined
                      });
                      // Use /invite/ which is the established splash redirect route
                      const url = `${window.location.origin}/invite/${invite.id}`;
                      setLastInviteUrl(url);
                    } catch (e: any) {
                      showToast(e?.message || "Failed to create invite", "error");
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  Generate Invite Link
                </button>
              </>
            ) : (
              <div className="stack" style={{ gap: "1rem" }}>
                <div style={{ background: "var(--surface-alt)", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={lastInviteUrl}
                    data-testid="invite-url-input"
                    style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: "0.9rem" }}
                  />
                  <button
                    className="ghost"
                    data-testid="copy-invite-url"
                    onClick={() => {
                        if (lastInviteUrl) {
                            void navigator.clipboard.writeText(lastInviteUrl);
                            showToast("Link copied!", "success");
                        }
                    }}
                  >
                    Copy
                  </button>
                </div>
                <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Invite URL copied to clipboard.</p>
                <button
                  className="primary"
                  data-testid="done-invite-modal"
                  onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}
                  style={{ width: "100%" }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
