"use client";

import { useEffect, useState } from "react";
import type { MessageRevision } from "@skerry/shared";
import { fetchRevisions } from "../lib/control-plane";

interface Props {
  channelId: string;
  messageId: string;
  currentContent: string;
  onClose: () => void;
}

export function EditHistoryPopover({ channelId, messageId, currentContent, onClose }: Props) {
  const [revisions, setRevisions] = useState<MessageRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRevisions(channelId, messageId)
      .then((items) => {
        if (cancelled) return;
        setRevisions(items);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load edit history");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [channelId, messageId]);

  const total = revisions.length;
  const current = revisions[index];
  const canGoBack = index < total - 1;
  const canGoForward = index > 0;

  const displayContent = current?.content ?? currentContent;
  const displayTime = current?.createdAt
    ? new Date(current.createdAt).toLocaleString()
    : "Original";

  // Current position shows "N of total" where N is 1-indexed from latest
  const positionLabel = total > 0 ? `${total - index} of ${total}` : "";

  return (
    <>
      {/* Backdrop */}
      <div className="eh-backdrop" onClick={onClose} data-testid="edit-history-backdrop" />

      {/* Popover */}
      <div className="eh-popover" role="dialog" aria-label="Edit history" data-testid="edit-history-popover">
        <div className="eh-header">
          <span className="eh-title">Edit History</span>
          <button className="eh-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="eh-body">
          {loading && <p className="eh-status">Loading…</p>}
          {error && <p className="eh-status eh-status--error">{error}</p>}
          {!loading && !error && total === 0 && (
            <p className="eh-status">No previous edits.</p>
          )}

          {total > 0 && current && (
            <>
              <div className="eh-nav">
                <button
                  className="eh-nav-btn"
                  disabled={!canGoBack}
                  onClick={() => setIndex(i => i + 1)}
                  aria-label="Older revision"
                >
                  ◀
                </button>
                <span className="eh-position">{positionLabel}</span>
                <button
                  className="eh-nav-btn"
                  disabled={!canGoForward}
                  onClick={() => setIndex(i => i - 1)}
                  aria-label="Newer revision"
                >
                  ▶
                </button>
              </div>

              <div className="eh-revision">
                <time className="eh-time" dateTime={current.createdAt}>
                  {displayTime}
                </time>
                <pre className="eh-content">{displayContent}</pre>
              </div>

              {index === 0 && total > 1 && (
                <div className="eh-current-hint">
                  Use ◀ to see older versions
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .eh-backdrop {
          position: fixed;
          inset: 0;
          z-index: 3000;
        }

        .eh-popover {
          position: fixed;
          z-index: 3001;
          width: 360px;
          max-width: 95vw;
          max-height: 80vh;
          background: #1e1f22;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .eh-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: #2b2d31;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          flex-shrink: 0;
        }

        .eh-title {
          font-size: 0.9rem;
          font-weight: 700;
          color: #f2f3f5;
        }

        .eh-close {
          background: none;
          border: none;
          color: #b5bac1;
          font-size: 1rem;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .eh-close:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .eh-body {
          padding: 12px 16px;
          overflow-y: auto;
          flex: 1;
        }

        .eh-status {
          color: #b5bac1;
          font-size: 0.85rem;
          text-align: center;
          padding: 16px 0;
        }
        .eh-status--error {
          color: #d04545;
        }

        .eh-nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .eh-nav-btn {
          background: #2b2d31;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          color: #b5bac1;
          padding: 4px 12px;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .eh-nav-btn:hover:not(:disabled) {
          background: #35373c;
          color: #f2f3f5;
        }
        .eh-nav-btn:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .eh-position {
          font-size: 0.8rem;
          color: #72767d;
          min-width: 60px;
          text-align: center;
        }

        .eh-revision {
          background: #2b2d31;
          border-radius: 6px;
          padding: 10px 12px;
        }

        .eh-time {
          display: block;
          font-size: 0.72rem;
          color: #72767d;
          margin-bottom: 8px;
        }

        .eh-content {
          margin: 0;
          font-size: 0.85rem;
          color: #b5bac1;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: inherit;
        }

        .eh-current-hint {
          margin-top: 8px;
          font-size: 0.72rem;
          color: #72767d;
          text-align: center;
        }
      `}</style>
    </>
  );
}
