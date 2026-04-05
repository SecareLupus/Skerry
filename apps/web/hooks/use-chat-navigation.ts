"use client";

import { useCallback, useEffect, useRef, useMemo, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useChat } from "../context/chat-context";
import { Channel } from "@skerry/shared";

export function useChatNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlServerId = searchParams.get("server");
  const urlChannelId = searchParams.get("channel");
  const urlMessageId = searchParams.get("message");

  const { state, dispatch } = useChat();
  const { 
    servers, 
    channels, 
    channelFilter, 
    selectedServerId, 
    selectedChannelId, 
    messages,
    bootstrapStatus 
  } = state;

  const lastSyncedUrlRef = useRef<string>("");
  const targetUrlSelectionRef = useRef<string | null>(null);
  const previousUrlRef = useRef<string>("");

  const filteredChannels = useMemo(() => {
    const term = channelFilter.trim().toLowerCase();
    if (!term) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(term));
  }, [channels, channelFilter]);

  const groupedChannelIds = useMemo(() => {
    return filteredChannels.map(c => c.id);
  }, [filteredChannels]);

  const setUrlSelection = useCallback(
    (serverId: string | null, channelId: string | null, messageId: string | null = null) => {
      const currentQuery = searchParams.toString();
      const next = new URLSearchParams(searchParams.toString());
      if (serverId) {
        next.set("server", serverId);
      } else {
        next.delete("server");
      }

      if (channelId) {
        next.set("channel", channelId);
      } else {
        next.delete("channel");
      }

      if (messageId) {
        next.set("message", messageId);
      } else {
        next.delete("message");
      }

      const query = next.toString();
      if (query === currentQuery) {
        return;
      }
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  function getAdjacentId(currentId: string, ids: string[], direction: "next" | "previous"): string | null {
    if (ids.length === 0) {
      return null;
    }
    const currentIndex = ids.indexOf(currentId);
    if (currentIndex === -1) {
      return ids[0] ?? null;
    }

    const offset = direction === "next" ? 1 : -1;
    const nextIndex = (currentIndex + offset + ids.length) % ids.length;
    return ids[nextIndex] ?? null;
  }

  // Note: These need to be linked to handleServerChange / handleChannelChange which are currently in ChatClient
  // We'll pass them in or extract them too. Let's pass them for now.
  const handleServerKeyboardNavigation = useCallback((
    event: ReactKeyboardEvent, 
    currentServerId: string, 
    onServerChange: (id: string) => void | Promise<void>
  ) => {
    const serverIds = servers.map((server) => server.id);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextId = getAdjacentId(currentServerId, serverIds, "next");
      if (nextId) void onServerChange(nextId);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const previousId = getAdjacentId(currentServerId, serverIds, "previous");
      if (previousId) void onServerChange(previousId);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const first = serverIds[0];
      if (first) void onServerChange(first);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = serverIds[serverIds.length - 1];
      if (last) void onServerChange(last);
    }
  }, [servers]);

  const handleChannelKeyboardNavigation = useCallback((
    event: ReactKeyboardEvent, 
    currentChannelId: string, 
    onChannelChange: (id: string) => void | Promise<void>
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextId = getAdjacentId(currentChannelId, groupedChannelIds, "next");
      if (nextId) void onChannelChange(nextId);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const previousId = getAdjacentId(currentChannelId, groupedChannelIds, "previous");
      if (previousId) void onChannelChange(previousId);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const first = groupedChannelIds[0];
      if (first) void onChannelChange(first);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = groupedChannelIds[groupedChannelIds.length - 1];
      if (last) void onChannelChange(last);
    }
  }, [groupedChannelIds]);

  return {
    urlServerId,
    urlChannelId,
    urlMessageId,
    lastSyncedUrlRef,
    targetUrlSelectionRef,
    previousUrlRef,
    setUrlSelection,
    handleServerKeyboardNavigation,
    handleChannelKeyboardNavigation
  };
}
