"use client";

import Link from "next/link";
import type { ViewerSession } from "../../lib/control-plane";

interface ClientTopbarProps {
  dispatch: (action: any) => void;
  viewer: ViewerSession | null;
  realtimeState: string;
  theme: "light" | "dark" | null;
  toggleTheme: () => void;
  handleLogout: () => Promise<void>;
  error: string | null;
}

export function ClientTopbar({
  dispatch,
  viewer,
  realtimeState,
  theme,
  toggleTheme,
  handleLogout,
  error
}: ClientTopbarProps) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-branding">
          <img src="/logo.png" alt="Skerry Logo" className="topbar-logo" />
          <h1>Skerry Local Chat</h1>
        </div>
        <div className="topbar-meta">
          <button
            type="button"
            className="icon-button"
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            aria-label={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            onClick={toggleTheme}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <button
            type="button"
            className="icon-button"
            title="Search Messages"
            onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "search" })}
          >
            🔍
          </button>
          <Link href="/settings" className="icon-button" title="User Settings" aria-label="User Settings">
            ⚙️
          </Link>
          <span className="status-pill" data-state={realtimeState}>
            {realtimeState === "live" ? "Live" : realtimeState === "polling" ? "Polling" : "Offline"}
          </span>
          <span aria-live="polite">
            Signed in as {viewer?.identity?.preferredUsername ?? "Guest"}
          </span>
          {viewer ? (
            <button type="button" className="ghost" onClick={handleLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
