"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { listChannelMembers } from "../lib/control-plane";

export function useMembers() {
  const { state, dispatch } = useChat();
  const { selectedChannelId } = state;

  useEffect(() => {
    if (!selectedChannelId) return;

    const interval = setInterval(() => {
      listChannelMembers(selectedChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch(() => { });
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [selectedChannelId, dispatch]);
}
