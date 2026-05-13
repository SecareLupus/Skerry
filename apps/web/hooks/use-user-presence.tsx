"use client";

import { useEffect, useState, useRef } from "react";
import { fetchUserPresence } from "../lib/control-plane";

interface PresenceEntry {
  isOnline: boolean;
  lastSeenAt: string;
}

/**
 * Fetches presence for a set of user IDs. Debounces rapid changes
 * and refreshes every 30 seconds while the user list is non-empty.
 */
export function useUserPresence(userIds: string[]) {
  const [presence, setPresence] = useState<Record<string, PresenceEntry>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Deduplicate IDs for the fetch call
  const uniqueIds = [...new Set(userIds.filter(Boolean))];

  useEffect(() => {
    if (uniqueIds.length === 0) {
      setPresence({});
      return;
    }

    const refresh = () => {
      fetchUserPresence(uniqueIds)
        .then(setPresence)
        .catch(() => { /* presence is best-effort */ });
    };

    refresh();
    timerRef.current = setInterval(refresh, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uniqueIds.join(",")]);

  return presence;
}

/**
 * Tiny colored dot for presence indicators.
 * green=online, gray=offline/unknown
 */
export function PresenceDot({ isOnline }: { isOnline?: boolean }) {
  return (
    <span
      role="status"
      aria-label={isOnline ? "Online" : "Offline"}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        marginRight: 4,
        flexShrink: 0,
        backgroundColor: isOnline ? "#3ba55d" : "#747f8d",
        border: "1px solid rgba(0,0,0,0.15)",
      }}
    />
  );
}
