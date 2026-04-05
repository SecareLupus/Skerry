import { createHubInvite, inviteToChannel } from "../../lib/control-plane";
import type { Server, IdentityMapping } from "@skerry/shared";

interface InviteModalsProps {
  isInviting: boolean;
  setIsInviting: (val: boolean) => void;
  isCreatingHubInvite: boolean;
  setIsCreatingHubInvite: (val: boolean) => void;
  userSearchQuery: string;
  setUserSearchQuery: (val: string) => void;
  userSearchResults: IdentityMapping[];
  activeServer?: Server;
  selectedChannelId: string | null;
  lastInviteUrl: string | null;
  setLastInviteUrl: (val: string | null) => void;
  showToast: (message: string, type: "success" | "error") => void;
}

export function InviteModals({
  isInviting,
  setIsInviting,
  isCreatingHubInvite,
  setIsCreatingHubInvite,
  userSearchQuery,
  setUserSearchQuery,
  userSearchResults,
  activeServer,
  selectedChannelId,
  lastInviteUrl,
  setLastInviteUrl,
  showToast
}: InviteModalsProps) {
  if (isInviting) {
    return (
      <div className="modal-backdrop" onClick={() => setIsInviting(false)}>
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
                    <span>{user.preferredUsername}</span>
                    <button
                      className="ghost"
                      onClick={async () => {
                        try {
                          if (!selectedChannelId) return;
                          await inviteToChannel(selectedChannelId, user.productUserId);
                          showToast(`Invited ${user.preferredUsername}`, "success");
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
      <div className="modal-backdrop" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
          <header className="modal-header">
            <h2>Invite to {activeServer?.name}</h2>
            <button type="button" className="ghost" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>×</button>
          </header>
          <div className="stack" style={{ padding: "1.5rem", textAlign: "center" }}>
            {!lastInviteUrl ? (
              <>
                <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1.5rem" }}>
                  This will create a link that anyone can use to join this hub.
                </p>
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
                      const invite = await createHubInvite(hubId);
                      // Use /invite/ which is the established splash redirect route
                      const url = `${window.location.origin}/invite/${invite.id}`;
                      setLastInviteUrl(url);
                    } catch (e) {
                      showToast("Failed to create invite", "error");
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
                    style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: "0.9rem" }}
                  />
                  <button
                    className="ghost"
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
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
