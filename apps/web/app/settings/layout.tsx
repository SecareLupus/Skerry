"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChat } from "../../context/chat-context";
import Icon from "../../components/icon";

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
    { label: "User Settings", href: "/settings", icon: "user" },
    { label: "Hub Settings", href: "/settings/hub", icon: "settings", hidden: !canManageHub },
    { label: "Hub Members", href: "/settings/hub/members", icon: "users", hidden: !canManageHub },
    { label: "Hub Invites", href: "/settings/hub/invites", icon: "link", hidden: !canManageHub },
    { 
      label: "Space Settings", 
      href: `/settings/spaces/${selectedServerId}`, 
      icon: "home", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Space Members", 
      href: `/settings/spaces/${selectedServerId}/members`, 
      icon: "shield", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Space Badges", 
      href: `/settings/spaces/${selectedServerId}/badges`, 
      icon: "award", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Audit Log", 
      href: `/settings/spaces/${selectedServerId}/audit-log`, 
      icon: "scroll-text", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Reports", 
      href: `/settings/spaces/${selectedServerId}/reports`, 
      icon: "alert-triangle", 
      hidden: !canManageCurrentSpace || !selectedServerId 
    },
    { 
      label: "Room Settings", 
      href: `/settings/rooms/${selectedChannelId}`, 
      icon: "message-square", 
      hidden: !canManageCurrentSpace || !selectedChannelId 
    },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="header-left">
          <Link href="/" className="back-button" title="Back to Chat">
            <Icon name="arrow-left" size={16} />
          </Link>
          <h1 style={{ marginLeft: '0.5rem' }}>Settings</h1>
        </div>
        <div className="topbar-meta">
          {viewer && (
            <span className="status-indicator">
              {viewer.identity?.displayName || viewer.identity?.email}
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
                <Icon name={item.icon} size={18} />
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
