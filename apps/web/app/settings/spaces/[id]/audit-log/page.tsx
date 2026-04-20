"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listAuditLogs } from "../../../../../lib/control-plane";
import type { ModerationAction } from "@skerry/shared";
import { useToast } from "../../../../../components/toast-provider";

export default function SpaceAuditLogPage() {
  const params = useParams();
  const serverId = params.id as string;
  const { showToast } = useToast();
  const [logs, setLogs] = useState<ModerationAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const items = await listAuditLogs(serverId);
        setLogs(items);
      } catch (error: any) {
        showToast(error.message || "Failed to fetch audit logs", "error");
      } finally {
        setLoading(false);
      }
    }
    if (serverId) fetchLogs();
  }, [serverId, showToast]);

  if (loading) {
    return (
      <div className="settings-page">
        <div className="loading-state">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Audit Log</h1>
        <p className="text-muted">A record of administrative actions taken in this space.</p>
      </header>

      <div className="settings-section">
        <div className="audit-log-container">
          {logs.length === 0 ? (
            <div className="empty-state">
              <p>No administrative actions have been recorded yet.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="audit-entry" data-testid={`audit-log-item-${log.id}`}>
                      <td>
                        <span className={`badge mod-action-${log.actionType}`}>
                          {log.actionType}
                        </span>
                      </td>
                      <td>
                        <div className="user-mention">
                          <code title={log.actorUserId}>{log.actorUserId.slice(0, 8)}...</code>
                        </div>
                      </td>
                      <td>
                        {log.targetUserId ? (
                          <div className="user-mention">
                            <code title={log.targetUserId}>{log.targetUserId.slice(0, 8)}...</code>
                          </div>
                        ) : log.targetMessageId ? (
                            <span className="text-muted" title={log.targetMessageId}>Message</span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="reason-cell">
                        {log.reason}
                      </td>
                      <td className="date-cell">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .audit-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .audit-table th {
          text-align: left;
          padding: 0.75rem;
          border-bottom: 1px solid var(--border);
          color: var(--text-muted);
          font-weight: 500;
        }
        .audit-table td {
          padding: 0.75rem;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: middle;
        }
        .badge {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          background: var(--bg-modifier-selected);
          color: var(--text-normal);
        }
        .mod-action-kick, .mod-action-ban {
          background: rgba(240, 71, 71, 0.1);
          color: #f04747;
        }
        .mod-action-timeout {
          background: rgba(250, 166, 26, 0.1);
          color: #faa61a;
        }
        .reason-cell {
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .empty-state {
          padding: 3rem;
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-secondary);
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
