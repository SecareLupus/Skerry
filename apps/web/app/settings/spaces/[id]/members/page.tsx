"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { listServerMembers } from "../../../../../lib/control-plane";
import MemberTable, { MemberEntry } from "../../../../../components/member-table";

export default function SpaceMembersPage() {
  const params = useParams();
  const serverId = params.id as string;

  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMembers = useCallback(async () => {
    if (!serverId) return;
    try {
      setLoading(true);
      const items = await listServerMembers(serverId);
      setMembers(items);
    } catch (err) {
      console.error("Failed to load space members", err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  if (!serverId) return <p>Space ID not found.</p>;

  return (
    <div className="settings-section">
      <header>
        <h2>Space Members</h2>
        <p className="settings-description">
          Showing regular local users and bridged Discord members for this Space.
        </p>
      </header>

      {loading ? (
        <p>Loading members...</p>
      ) : (
        <MemberTable serverId={serverId} members={members} onRefresh={loadMembers} />
      )}
    </div>
  );
}
