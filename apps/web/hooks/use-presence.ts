"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { updatePresence } from "../lib/control-plane";

export function usePresence() {
  const { state } = useChat();
  const { viewer } = state;

  useEffect(() => {
    if (!viewer) return;

    const sendHeartbeat = () => {
      updatePresence().catch(() => { });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000); // Every minute
    return () => clearInterval(interval);
  }, [viewer]);
}
