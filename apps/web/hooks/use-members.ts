"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { listChannelMembers } from "../lib/control-plane";

export function useMembers() {
  const { state, dispatch } = useChat();
  const { selectedChannelId } = state;

  useEffect(() => {
    if (!selectedChannelId) return;

    // Only fetch immediately if we have zero members (initial load sync)
    if (state.members.length === 0) {
      listChannelMembers(selectedChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch(() => { });
    }

    const interval = setInterval(() => {
      listChannelMembers(selectedChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch(() => { });
    }, 60000); // Relaxed to 60 seconds

    return () => clearInterval(interval);
  }, [selectedChannelId, dispatch, state.members.length]);
}
