"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";
import { listChannels } from "../lib/control-plane";

export function useDMs() {
  const { state, dispatch } = useChat();
  const { viewer, servers, bootstrapStatus } = state;

  const canAccessWorkspace = Boolean(viewer && !viewer.needsOnboarding && bootstrapStatus?.initialized);

  useEffect(() => {
    if (!canAccessWorkspace) return;
    const dmServer = servers.find((s) => s.type === "dm");
    if (!dmServer) return;

    const refreshDmChannels = () => {
      listChannels(dmServer.id)
        .then((channels) => dispatch({ type: "SET_ALL_DM_CHANNELS", payload: channels }))
        .catch(console.error);
    };

    refreshDmChannels();
    const timer = setInterval(refreshDmChannels, 60000); // refresh every minute just in case
    return () => clearInterval(timer);
  }, [canAccessWorkspace, servers, dispatch]);
}
