"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { listChannelMembers } from "../lib/control-plane";

export function useMembers() {
  const { state, dispatch } = useChat();
  const { selectedChannelId } = state;

  useEffect(() => {
    if (!selectedChannelId) return;

    listChannelMembers(selectedChannelId)
      .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
      .catch(() => { });

    const interval = setInterval(() => {
      listChannelMembers(selectedChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch(() => { });
    }, 30000); // 30s polling for membership consistency

    return () => clearInterval(interval);
  }, [selectedChannelId, dispatch, state.lastMembershipUpdate]);
}
