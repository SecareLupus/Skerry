"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { fetchNotificationSummary } from "../lib/control-plane";

export function useNotifications() {
  const { state, dispatch } = useChat();
  const { viewer, bootstrapStatus } = state;

  const canAccessWorkspace = Boolean(viewer && !viewer.needsOnboarding && bootstrapStatus?.initialized);

  useEffect(() => {
    if (!canAccessWorkspace) return;

    const refreshNotifications = () => {
      void fetchNotificationSummary()
        .then((summary) => dispatch({ type: "SET_NOTIFICATIONS", payload: summary }))
        .catch(() => {
          // Ignore transient fetch failures
        });
    };

    refreshNotifications();
    const timer = setInterval(refreshNotifications, 15000);
    return () => clearInterval(timer);
  }, [canAccessWorkspace, dispatch]);
}
