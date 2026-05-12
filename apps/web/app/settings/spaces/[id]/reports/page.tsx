"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listReports, transitionReportStatus } from "../../../../../lib/control-plane";
import type { ModerationReport, ReportStatus } from "@skerry/shared";
import { useToast } from "../../../../../components/toast-provider";

const STATUS_LABELS: Record<ReportStatus, string> = {
    open: "Open",
    triaged: "In Review",
    resolved: "Resolved",
    dismissed: "Dismissed",
};

const STATUS_OPTIONS: Array<{ value: ReportStatus | ""; label: string }> = [
    { value: "", label: "All statuses" },
    { value: "open", label: "Open" },
    { value: "triaged", label: "In Review" },
    { value: "resolved", label: "Resolved" },
    { value: "dismissed", label: "Dismissed" },
];

export default function SpaceReportsPage() {
    const params = useParams();
    const serverId = params.id as string;
    const { showToast } = useToast();

    const [reports, setReports] = useState<ModerationReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<ReportStatus | "">("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const loadReports = useCallback(async () => {
        setLoading(true);
        try {
            const items = await listReports(serverId, filterStatus || undefined);
            setReports(items);
        } catch (e: any) {
            showToast(e.message || "Failed to load reports", "error");
        } finally {
            setLoading(false);
        }
    }, [serverId, filterStatus, showToast]);

    useEffect(() => {
        if (serverId) loadReports();
    }, [serverId, loadReports]);

    async function handleTransition(reportId: string, status: Exclude<ReportStatus, "open">, reason?: string) {
        setBusy(true);
        try {
            await transitionReportStatus({
                reportId,
                serverId,
                status,
                reason: reason ?? `Report ${status} from triage UI`,
            });
            showToast(`Report ${STATUS_LABELS[status].toLowerCase()}`, "success");
            await loadReports();
            setExpandedId(null);
        } catch (e: any) {
            showToast(e.message || "Failed to update report", "error");
        } finally {
            setBusy(false);
        }
    }

    function truncate(text: string, max: number) {
        return text.length > max ? text.slice(0, max) + "…" : text;
    }

    function statusClass(status: ReportStatus): string {
        if (status === "open") return "status-open";
        if (status === "triaged") return "status-review";
        if (status === "dismissed") return "status-dismissed";
        return "status-resolved";
    }

    return (
        <div className="settings-page">
            <header className="settings-header">
                <h1>Report Triage</h1>
                <p className="text-muted">
                    Review and resolve user-submitted reports for this space.
                </p>
            </header>

            <div className="report-filters">
                <select
                    className="filter-select"
                    value={filterStatus}
                    onChange={(e) => {
                        setFilterStatus(e.target.value as ReportStatus | "");
                        setExpandedId(null);
                    }}
                >
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            <div className="settings-section">
                {loading ? (
                    <div className="loading-state">Loading reports...</div>
                ) : reports.length === 0 ? (
                    <div className="empty-state">
                        <p>No reports found{filterStatus ? ` with status "${STATUS_LABELS[filterStatus as ReportStatus]}"` : ""}.</p>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="report-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 70 }}>Status</th>
                                    <th>Reason</th>
                                    <th style={{ width: 120 }}>Reporter</th>
                                    <th style={{ width: 120 }}>Target</th>
                                    <th style={{ width: 150 }}>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reports.map((report) => {
                                    const isOpen = expandedId === report.id;
                                    const reportStatus = report.status as ReportStatus;
                                    return (
                                        <ReportRow
                                            key={report.id}
                                            report={report}
                                            isExpanded={isOpen}
                                            busy={busy}
                                            onToggle={() => setExpandedId(isOpen ? null : report.id)}
                                            onTransition={(s) => handleTransition(report.id, s)}
                                            truncate={truncate}
                                            statusClass={statusClass}
                                            statusLabel={STATUS_LABELS[reportStatus]}
                                        />
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style jsx>{`
                .report-filters {
                    display: flex;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                }
                .filter-select {
                    padding: 0.4rem 0.6rem;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--bg-secondary);
                    color: var(--text-normal);
                    font-size: 0.85rem;
                }
                .report-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.85rem;
                }
                .report-table th {
                    text-align: left;
                    padding: 0.6rem 0.75rem;
                    border-bottom: 1px solid var(--border);
                    color: var(--text-muted);
                    font-weight: 500;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                }
                .report-table td {
                    padding: 0.6rem 0.75rem;
                    border-bottom: 1px solid var(--border-subtle);
                    vertical-align: middle;
                }
                .report-row {
                    cursor: pointer;
                    transition: background 0.1s;
                }
                .report-row:hover {
                    background: var(--bg-modifier-hover);
                }
                .report-row.expanded {
                    background: var(--bg-modifier-selected);
                }
                .status-badge {
                    display: inline-block;
                    padding: 0.15rem 0.45rem;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                .status-open { background: rgba(240, 71, 71, 0.15); color: #f04747; }
                .status-review { background: rgba(250, 166, 26, 0.15); color: #faa61a; }
                .status-resolved { background: rgba(59, 165, 93, 0.15); color: #3ba55d; }
                .status-dismissed { background: rgba(150, 150, 150, 0.15); color: #999; }
                .detail-panel {
                    padding: 0.75rem 1rem 1rem;
                    background: var(--bg-secondary);
                    border-bottom: 2px solid var(--border);
                }
                .detail-panel p {
                    margin: 0 0 0.5rem;
                    line-height: 1.4;
                }
                .detail-actions {
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.75rem;
                    flex-wrap: wrap;
                }
                .action-btn {
                    padding: 0.3rem 0.75rem;
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    font-size: 0.75rem;
                    cursor: pointer;
                    background: var(--bg-primary);
                    color: var(--text-normal);
                }
                .action-btn:hover { background: var(--bg-modifier-hover); }
                .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .action-btn.danger { color: #f04747; border-color: rgba(240, 71, 71, 0.3); }
                .action-btn.resolve { color: #3ba55d; border-color: rgba(59, 165, 93, 0.3); }
                code {
                    background: var(--bg-primary);
                    padding: 0.1rem 0.3rem;
                    border-radius: 3px;
                    font-size: 0.78rem;
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
            `}</style>
        </div>
    );
}

function ReportRow({
    report,
    isExpanded,
    busy,
    onToggle,
    onTransition,
    truncate,
    statusClass,
    statusLabel,
}: {
    report: ModerationReport;
    isExpanded: boolean;
    busy: boolean;
    onToggle: () => void;
    onTransition: (status: Exclude<ReportStatus, "open">) => void;
    truncate: (t: string, m: number) => string;
    statusClass: (s: ReportStatus) => string;
    statusLabel: string;
}) {
    const reportStatus = report.status as ReportStatus;
    const isOpen = reportStatus === "open";

    return (
        <>
            <tr
                className={`report-row ${isExpanded ? "expanded" : ""}`}
                onClick={onToggle}
                data-testid={`report-row-${report.id}`}
            >
                <td>
                    <span className={`status-badge ${statusClass(reportStatus)}`}>
                        {statusLabel}
                    </span>
                </td>
                <td>{truncate(report.reason, 80)}</td>
                <td>
                    <code title={report.reporterUserId}>{report.reporterUserId.slice(0, 8)}…</code>
                </td>
                <td>
                    {report.targetUserId ? (
                        <code title={report.targetUserId}>{report.targetUserId.slice(0, 8)}…</code>
                    ) : report.targetMessageId ? (
                        <span className="text-muted">Message</span>
                    ) : (
                        <span className="text-muted">—</span>
                    )}
                </td>
                <td className="text-muted">{new Date(report.createdAt).toLocaleString()}</td>
            </tr>
            {isExpanded && (
                <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                        <div className="detail-panel">
                            <p><strong>Full reason:</strong> {report.reason}</p>
                            <p>
                                <strong>Reporter:</strong> <code>{report.reporterUserId}</code>
                                {report.targetUserId && (
                                    <> &middot; <strong>Target:</strong> <code>{report.targetUserId}</code></>
                                )}
                                {report.targetMessageId && (
                                    <> &middot; <strong>Message:</strong> <code>{report.targetMessageId.slice(0, 12)}…</code></>
                                )}
                                {report.channelId && (
                                    <> &middot; <strong>Channel:</strong> <code>{report.channelId.slice(0, 12)}…</code></>
                                )}
                            </p>
                            {report.triagedByUserId && (
                                <p><strong>Triaged by:</strong> <code>{report.triagedByUserId.slice(0, 8)}…</code></p>
                            )}

                            <div className="detail-actions">
                                {isOpen && (
                                    <>
                                        <button
                                            className="action-btn"
                                            disabled={busy}
                                            onClick={(e) => { e.stopPropagation(); onTransition("triaged"); }}
                                        >
                                            Start Review
                                        </button>
                                        <button
                                            className="action-btn resolve"
                                            disabled={busy}
                                            onClick={(e) => { e.stopPropagation(); onTransition("resolved"); }}
                                        >
                                            Resolve (no action)
                                        </button>
                                        <button
                                            className="action-btn danger"
                                            disabled={busy}
                                            onClick={(e) => { e.stopPropagation(); onTransition("dismissed"); }}
                                        >
                                            Dismiss
                                        </button>
                                    </>
                                )}
                                {reportStatus === "triaged" && (
                                    <>
                                        <button
                                            className="action-btn resolve"
                                            disabled={busy}
                                            onClick={(e) => { e.stopPropagation(); onTransition("resolved"); }}
                                        >
                                            Mark Resolved
                                        </button>
                                        <button
                                            className="action-btn danger"
                                            disabled={busy}
                                            onClick={(e) => { e.stopPropagation(); onTransition("dismissed"); }}
                                        >
                                            Dismiss
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
