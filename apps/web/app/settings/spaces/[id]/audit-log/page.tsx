"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchAuditLog } from "../../../../../lib/control-plane";
import type { AuditLogEntry, AuditActionType } from "@skerry/shared";
import { useToast } from "../../../../../components/toast-provider";

// Duplicated from @skerry/shared to avoid runtime import issues in Next.js
const AUDIT_ACTION_TYPES: readonly AuditActionType[] = [
    "role.grant",
    "role.revoke",
    "channel.create",
    "channel.delete",
    "channel.update",
    "category.create",
    "category.delete",
    "category.update",
    "moderation.warn",
    "moderation.strike",
    "moderation.mute",
    "moderation.kick",
    "moderation.ban",
    "permission.edit",
    "invite.generate",
    "invite.redeem",
    "integration.connect",
    "integration.disconnect",
    "server.update",
];

const ACTION_LABELS: Record<string, string> = {
  "role.grant": "Role Granted",
  "role.revoke": "Role Revoked",
  "channel.create": "Channel Created",
  "channel.delete": "Channel Deleted",
  "channel.update": "Channel Updated",
  "category.create": "Category Created",
  "category.delete": "Category Deleted",
  "category.update": "Category Updated",
  "moderation.warn": "Warned",
  "moderation.strike": "Struck",
  "moderation.mute": "Muted",
  "moderation.kick": "Kicked",
  "moderation.ban": "Banned",
  "permission.edit": "Permissions Edited",
  "invite.generate": "Invite Generated",
  "invite.redeem": "Invite Redeemed",
  "integration.connect": "Integration Connected",
  "integration.disconnect": "Integration Disconnected",
  "server.update": "Server Updated",
};

const TARGET_LABELS: Record<string, string> = {
  user: "User",
  channel: "Channel",
  role: "Role",
  category: "Category",
  invite: "Invite",
  server: "Server",
};

const PAGE_SIZE = 25;

export default function SpaceAuditLogPage() {
  const params = useParams();
  const serverId = params.id as string;
  const { showToast } = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterActor, setFilterActor] = useState("");
  const [filterTarget, setFilterTarget] = useState("");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAuditLog(serverId, {
        actionType: filterAction || undefined,
        actorUserId: filterActor || undefined,
        targetId: filterTarget || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (error: any) {
      showToast(error.message || "Failed to fetch audit logs", "error");
    } finally {
      setLoading(false);
    }
  }, [serverId, filterAction, filterActor, filterTarget, offset, showToast]);

  useEffect(() => {
    if (serverId) loadLogs();
  }, [serverId, loadLogs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function formatActorId(id: string) {
    return id.slice(0, 10) + "...";
  }

  function formatTargetId(id: string) {
    return id.slice(0, 10) + "...";
  }

  function actionClass(actionType: string): string {
    if (actionType.startsWith("moderation.")) {
      const sub = actionType.split(".")[1];
      if (sub === "kick" || sub === "ban") return "action-danger";
      if (sub === "mute" || sub === "warn") return "action-warn";
      return "action-mod";
    }
    if (actionType.startsWith("role.")) return "action-role";
    if (actionType.startsWith("channel.") || actionType.startsWith("category.")) return "action-channel";
    if (actionType.startsWith("invite.")) return "action-invite";
    if (actionType.startsWith("integration.")) return "action-integration";
    return "";
  }

  function renderSnapshot(snapshot: Record<string, unknown> | null) {
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return <span className="text-muted">—</span>;
    }
    return (
      <pre className="snapshot-json">
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 data-testid="audit-log-heading">Audit Log</h1>
        <p className="text-muted">
          A record of administrative actions taken in this space. {total > 0 && <span>{total} total entries</span>}
        </p>
      </header>

      {/* Filters */}
      <div className="audit-filters">
        <select
          className="filter-select"
          value={filterAction}
          onChange={(e) => {
            setFilterAction(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All actions</option>
          {AUDIT_ACTION_TYPES.map((at) => (
            <option key={at} value={at}>
              {ACTION_LABELS[at] || at}
            </option>
          ))}
        </select>
        <input
          className="filter-input"
          type="text"
          placeholder="Filter by actor ID..."
          value={filterActor}
          onChange={(e) => {
            setFilterActor(e.target.value);
            setOffset(0);
          }}
        />
        <input
          className="filter-input"
          type="text"
          placeholder="Filter by target ID..."
          value={filterTarget}
          onChange={(e) => {
            setFilterTarget(e.target.value);
            setOffset(0);
          }}
        />
        {(filterAction || filterActor || filterTarget) && (
          <button
            className="filter-clear btn-icon btn-icon--ghost"
            onClick={() => {
              setFilterAction("");
              setFilterActor("");
              setFilterTarget("");
              setOffset(0);
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="settings-section">
        {loading ? (
          <div className="loading-state">Loading audit logs...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <p>No administrative actions have been recorded yet.</p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>Action</th>
                    <th style={{ width: 140 }}>Actor</th>
                    <th style={{ width: 120 }}>Target</th>
                    <th style={{ width: 140 }}>Target ID</th>
                    <th style={{ width: 170 }}>Date</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isOpen = expandedId === entry.id;
                    const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0;
                    const reason = entry.metadata?.reason as string | undefined;
                    const hasSnapshots =
                      (entry.beforeSnapshot && Object.keys(entry.beforeSnapshot).length > 0) ||
                      (entry.afterSnapshot && Object.keys(entry.afterSnapshot).length > 0);

                    return (
                      <React.Fragment key={entry.id}>
                        <tr
                          className={`audit-entry ${isOpen ? "expanded" : ""}`}
                          data-testid={`audit-log-item-${entry.id}`}
                          onClick={() => setExpandedId(isOpen ? null : entry.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <span className={`badge ${actionClass(entry.actionType)}`}>
                              {ACTION_LABELS[entry.actionType] || entry.actionType}
                            </span>
                          </td>
                          <td>
                            <code title={entry.actorUserId}>{formatActorId(entry.actorUserId)}</code>
                          </td>
                          <td>
                            <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                              {TARGET_LABELS[entry.targetType] || entry.targetType}
                            </span>
                          </td>
                          <td>
                            <code title={entry.targetId}>{formatTargetId(entry.targetId)}</code>
                          </td>
                          <td className="date-cell">
                            {new Date(entry.createdAt).toLocaleString()}
                          </td>
                          <td className="expand-cell">
                            {(hasSnapshots || hasMeta) && (
                              <span className={`expand-arrow ${isOpen ? "open" : ""}`}>▸</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="audit-expanded">
                            <td colSpan={6}>
                              <div className="expanded-content">
                                {reason && (
                                  <div className="detail-group">
                                    <strong>Reason:</strong> {reason}
                                  </div>
                                )}
                                {entry.metadata && (
                                  <div className="detail-group">
                                    <strong>Metadata:</strong>
                                    <pre className="snapshot-json">{JSON.stringify(entry.metadata, null, 2)}</pre>
                                  </div>
                                )}
                                {hasSnapshots && (
                                  <div className="snapshot-row">
                                    <div className="snapshot-col">
                                      <strong>Before:</strong>
                                      {renderSnapshot(entry.beforeSnapshot)}
                                    </div>
                                    <div className="snapshot-col">
                                      <strong>After:</strong>
                                      {renderSnapshot(entry.afterSnapshot)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn-icon btn-icon--outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="btn-icon btn-icon--outline"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .audit-filters {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }
        .filter-select,
        .filter-input {
          padding: 0.4rem 0.6rem;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg-secondary);
          color: var(--text-normal);
          font-size: 0.85rem;
        }
        .filter-select {
          min-width: 180px;
        }
        .filter-input {
          min-width: 180px;
        }
        .filter-clear {
          font-size: 0.8rem;
          padding: 0.25rem 0.75rem;
        }
        .audit-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }
        .audit-table th {
          text-align: left;
          padding: 0.6rem 0.75rem;
          border-bottom: 1px solid var(--border);
          color: var(--text-muted);
          font-weight: 500;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .audit-table td {
          padding: 0.6rem 0.75rem;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: middle;
        }
        .audit-entry {
          transition: background 0.1s;
        }
        .audit-entry:hover {
          background: var(--bg-modifier-hover);
        }
        .audit-entry.expanded {
          background: var(--bg-modifier-selected);
        }
        .badge {
          display: inline-block;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          background: var(--bg-modifier-selected);
          color: var(--text-normal);
        }
        .action-danger {
          background: rgba(240, 71, 71, 0.15);
          color: #f04747;
        }
        .action-warn {
          background: rgba(250, 166, 26, 0.15);
          color: #faa61a;
        }
        .action-mod {
          background: rgba(240, 71, 71, 0.1);
          color: #e07070;
        }
        .action-role {
          background: rgba(88, 101, 242, 0.15);
          color: #5865f2;
        }
        .action-channel {
          background: rgba(59, 165, 93, 0.15);
          color: #3ba55d;
        }
        .action-invite {
          background: rgba(88, 101, 242, 0.12);
          color: #7983f5;
        }
        .action-integration {
          background: rgba(235, 69, 158, 0.12);
          color: #eb459e;
        }
        .expand-cell {
          text-align: center;
        }
        .expand-arrow {
          display: inline-block;
          transition: transform 0.15s;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .expand-arrow.open {
          transform: rotate(90deg);
        }
        .audit-expanded td {
          padding: 0;
          border-bottom: 2px solid var(--border);
        }
        .expanded-content {
          padding: 0.75rem 1rem 1rem;
          background: var(--bg-secondary);
        }
        .detail-group {
          margin-bottom: 0.5rem;
        }
        .snapshot-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-top: 0.5rem;
        }
        .snapshot-col strong {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.8rem;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .snapshot-json {
          margin: 0;
          padding: 0.5rem;
          background: var(--bg-primary);
          border-radius: 4px;
          font-size: 0.75rem;
          max-height: 200px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 1rem;
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border-subtle);
        }
        .pagination-info {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .empty-state {
          padding: 3rem;
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-secondary);
          border-radius: 8px;
        }
        .loading-state {
          padding: 3rem;
          text-align: center;
          color: var(--text-muted);
        }
        code {
          background: var(--bg-primary);
          padding: 0.15rem 0.35rem;
          border-radius: 3px;
          font-size: 0.8rem;
          font-family: monospace;
        }
      `}</style>
    </div>
  );
}
