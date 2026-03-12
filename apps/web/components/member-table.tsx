"use client";

import React, { useState, useMemo, useEffect } from "react";
import { performModerationAction, performBulkModerationAction, getUserModerationStatus } from "../lib/control-plane";
import { useToast } from "./toast-provider";
import { useChat } from "../context/chat-context";

export interface MemberEntry {
  productUserId: string;
  displayName: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  isBridged?: boolean;
  bridgedUserStatus?: string;
  joinedAt?: string;
}

interface MemberTableProps {
  serverId?: string;
  hubId?: string;
  members: MemberEntry[];
  onRefresh?: () => void;
}

export default function MemberTable({ serverId, hubId, members, onRefresh }: MemberTableProps) {
  const { showToast } = useToast();
  const { state, dispatch } = useChat();
  const { allowedActions } = state;
  const isModerator = allowedActions.includes("moderation.kick") || 
                     allowedActions.includes("moderation.ban") || 
                     allowedActions.includes("moderation.warn") || 
                     allowedActions.includes("moderation.strike");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "skerry" | "discord">("all");
  const [modifying, setModifying] = useState(false);
  const [moderationStats, setModerationStats] = useState<Record<string, { warningCount: number; strikeCount: number }>>({});

  useEffect(() => {
    if (!members.length || !isModerator) return;
    
    // Fetch moderation status for SKERRY users (not discord ones as much for now)
    const fetchStats = async () => {
        const stats: Record<string, { warningCount: number; strikeCount: number }> = {};
        for (const member of members) {
            if (!member.isBridged) {
                try {
                    const s = await getUserModerationStatus(member.productUserId, { hubId, serverId });
                    stats[member.productUserId] = s;
                } catch (e) {
                    // Ignore errors for individual members
                }
            }
        }
        setModerationStats(stats);
    };
    fetchStats();
  }, [members, serverId, hubId]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchesSearch = m.displayName.toLowerCase().includes(search.toLowerCase()) ||
        m.productUserId.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === "all" ||
        (filter === "discord" && m.isBridged) ||
        (filter === "skerry" && !m.isBridged);
      return matchesSearch && matchesFilter;
    });
  }, [members, search, filter]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredMembers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMembers.map(m => m.productUserId)));
    }
  };

  const handleBulkAction = async (action: "kick" | "ban" | "unban" | "timeout") => {
    if (!serverId) return;
    if (selectedIds.size === 0) return;

    const reason = window.prompt(`Reason for bulk ${action}:`, `Bulk ${action} by administrator`);
    if (reason === null) return;

    setModifying(true);
    try {
      const result = await performBulkModerationAction({
        serverId,
        targetUserIds: Array.from(selectedIds),
        action,
        reason
      });

      if (result.failures.length > 0) {
        showToast(`Bulk ${action} completed with ${result.failures.length} failures`, "error");
      } else {
        showToast(`Successfully performed bulk ${action} on ${result.successes.length} users`, "success");
      }
      setSelectedIds(new Set());
      onRefresh?.();
    } catch (err) {
      showToast(`Failed to perform bulk ${action}`, "error");
    } finally {
      setModifying(false);
    }
  };

  const handleIndividualAction = async (userId: string, action: "kick" | "ban" | "unban" | "timeout") => {
    if (!serverId) return;

    const reason = window.prompt(`Reason for ${action}:`, `Moderation action by administrator`);
    if (reason === null) return;

    setModifying(true);
    try {
      await performModerationAction({
        serverId,
        targetUserId: userId,
        action,
        reason
      });
      showToast(`User ${userId} ${action}ed`, "success");
      onRefresh?.();
    } catch (err) {
      showToast(`Failed to perform ${action}`, "error");
    } finally {
      setModifying(false);
    }
  };

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search members..."
          className="filter-input"
          style={{ flex: 1, marginBottom: 0 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-input"
          style={{ width: '160px', marginBottom: 0 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
        >
          <option value="all">All Platforms</option>
          <option value="skerry">Skerry Only</option>
          <option value="discord">Discord Only</option>
        </select>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={filteredMembers.length > 0 && selectedIds.size === filteredMembers.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Member</th>
              <th>Platform</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member) => (
              <tr key={member.productUserId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(member.productUserId)}
                    onChange={() => toggleSelect(member.productUserId)}
                  />
                </td>
                <td>
                  <div className="member-cell">
                    <img
                      src={member.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${member.productUserId}`}
                      className="member-avatar"
                      alt=""
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600 }}>{member.displayName}</span>
                        {(() => {
                          const stats = moderationStats[member.productUserId];
                          if (!stats) return null;
                          return (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {stats.warningCount > 0 && (
                                <span className="badge warning" title={`${stats.warningCount} Warnings`}>
                                  ⚠️ {stats.warningCount}
                                </span>
                              )}
                              {stats.strikeCount > 0 && (
                                <span className="badge danger" title={`${stats.strikeCount} Strikes`}>
                                  ❗ {stats.strikeCount}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{member.productUserId}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge ${member.isBridged ? 'discord' : 'skerry'}`}>
                    {member.isBridged ? 'Discord' : 'Skerry'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div
                      className="status-dot"
                      data-state={member.isOnline ? "live" : "disconnected"}
                      data-status={member.bridgedUserStatus}
                    />
                    <span style={{ fontSize: '0.85rem' }}>
                      {member.isOnline
                        ? (member.bridgedUserStatus
                          ? (member.bridgedUserStatus === 'dnd' ? 'Do Not Disturb' : member.bridgedUserStatus.charAt(0).toUpperCase() + member.bridgedUserStatus.slice(1))
                          : 'Online')
                        : 'Offline'}
                    </span>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {serverId && isModerator && (
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button
                        className="ghost"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => {
                          dispatch({ 
                            type: "SET_MODERATION_TARGET", 
                            payload: { userId: member.productUserId, displayName: member.displayName } 
                          });
                          dispatch({ type: "SET_ACTIVE_MODAL", payload: "moderation" });
                        }}
                        disabled={modifying}
                      >
                        Moderate
                      </button>
                      <button
                        className="ghost"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => handleIndividualAction(member.productUserId, "kick")}
                        disabled={modifying}
                      >
                        Kick
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredMembers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No members found matching your criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {selectedIds.size > 0 && serverId && (
          <div className="bulk-actions-bar">
            <div className="bulk-actions-group">
              <span style={{ fontWeight: 600 }}>{selectedIds.size} members selected</span>
              <button className="ghost" onClick={() => setSelectedIds(new Set())}>Clear</button>
            </div>
            <div className="bulk-actions-group">
              <button
                className="ghost"
                onClick={() => handleBulkAction("kick")}
                disabled={modifying}
              >
                Bulk Kick
              </button>
              <button
                style={{ background: 'var(--danger)' }}
                onClick={() => handleBulkAction("ban")}
                disabled={modifying}
              >
                Bulk Ban
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
