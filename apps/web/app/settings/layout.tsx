"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChat } from "../../context/chat-context";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { state } = useChat();
  const { viewerRoles, selectedServerId, selectedChannelId, viewer } = state;

  const canManageHub = useMemo(() => viewerRoles.some(
    (binding) =>
      binding.role === "hub_admin" &&
      (!binding.serverId || binding.serverId === "")
  ), [viewerRoles]);

  const canManageCurrentSpace = useMemo(() => viewerRoles.some(
    (binding) =>
      (binding.role === "hub_admin" || binding.role === "space_owner") &&
      (binding.serverId === selectedServerId || !binding.serverId)
  ), [viewerRoles, selectedServerId]);

  const navItems = [
    { label: "User Settings", href: "/settings", icon: "👤" },
    { label: "Hub Settings", href: "/settings/hub", icon: "⚙️", hidden: !canManageHub },
    { label: "Hub Members", href: "/settings/hub/members", icon: "👥", hidden: !canManageHub },
    { 
      label: "Space Settings", 
      href: `/settings/spaces/${selectedServerId}`, 
      icon: "🏠", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Space Members", 
      href: `/settings/spaces/${selectedServerId}/members`, 
      icon: "🛡️", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Room Settings", 
      href: `/settings/rooms/${selectedChannelId}`, 
      icon: "💬", 
      hidden: !canManageCurrentSpace || !selectedChannelId 
    },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="header-left">
          <Link href="/" className="back-button" title="Back to Chat">
            ←
          </Link>
          <h1 style={{ marginLeft: '0.5rem' }}>Settings</h1>
        </div>
        <div className="topbar-meta">
          {viewer && (
            <span className="status-indicator">
              {viewer.identity?.preferredUsername || viewer.identity?.email}
            </span>
          )}
        </div>
      </header>
      <main className="chat-shell details-collapsed" style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '280px 1fr' }}>
        <aside className="panel">
          <nav className="settings-sidebar">
            {navItems.filter(item => !item.hidden).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`settings-nav-item ${
                  pathname === item.href ? "active" : ""
                }`}
              >
                <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="panel settings-content">
          {children}
        </div>
      </main>
    </div>
  );
}
