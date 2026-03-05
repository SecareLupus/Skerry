"use client";

import React, { useEffect, useState } from "react";
import { useChat } from "../../../../context/chat-context";
import { listHubMembers } from "../../../../lib/control-plane";
import MemberTable, { MemberEntry } from "../../../../components/member-table";

export default function HubMembersPage() {
  const { state } = useChat();
  const { hubs } = state;
  const hub = hubs[0]; // Assuming single hub for now

  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMembers = async () => {
    if (!hub?.id) return;
    try {
      setLoading(true);
      const items = await listHubMembers(hub.id);
      // Map IdentityMapping to MemberEntry
      setMembers(items.map(m => ({
        productUserId: m.productUserId,
        displayName: m.preferredUsername || m.email?.split('@')[0] || m.productUserId,
        avatarUrl: m.avatarUrl,
        isBridged: false, // Hub list is Skerry users only
        isOnline: false   // Hub list doesn't track presence globally yet
      })));
    } catch (err) {
      console.error("Failed to load hub members", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
  }, [hub?.id]);

  if (!hub) return <p>Hub not found.</p>;

  return (
    <div className="settings-section">
      <header>
        <h2>Hub Members</h2>
        <p className="settings-description">
          Showing all Skerry users with active roles in <strong>{hub.name}</strong>.
        </p>
      </header>

      {loading ? (
        <p>Loading members...</p>
      ) : (
        <MemberTable members={members} onRefresh={loadMembers} />
      )}
    </div>
  );
}
