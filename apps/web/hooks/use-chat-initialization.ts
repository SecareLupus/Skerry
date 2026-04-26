"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChat, MessageItem } from "../context/chat-context";
import { useToast } from "../components/toast-provider";
import { 
  fetchAuthProviders, 
  fetchViewerSession, 
  fetchBootstrapStatus, 
  listViewerRoleBindings, 
  listHubs, 
  listBlocks,
  listServers,
  listChannels,
  listCategories,
  listDiscordBridgeMappings,
  updateUserTheme,
  controlPlaneBaseUrl,
  fetchChannelInit,
  type ChatMessage
} from "../lib/control-plane";

interface UseChatInitializationProps {
  urlServerId: string | null;
  urlChannelId: string | null;
  urlMessageId: string | null;
  setUrlSelection: (serverId: string | null, channelId: string | null, messageId?: string | null) => void;
  markChannelAsRead: (channelId: string) => Promise<void>;
  messagesRef: React.RefObject<HTMLOListElement>;
  setDraftMessage: (msg: string) => void;
  lastSyncedUrlRef: React.MutableRefObject<string>;
  setTargetUrl?: (url: string | null) => void;
}

export function useChatInitialization({
  urlServerId,
  urlChannelId,
  urlMessageId,
  setUrlSelection,
  markChannelAsRead,
  messagesRef,
  setDraftMessage,
  lastSyncedUrlRef,
  setTargetUrl
}: UseChatInitializationProps) {
  const { state, dispatch } = useChat();
  const { showToast } = useToast();
  
  const { 
    viewer, 
    bootstrapStatus, 
    selectedServerId, 
    selectedChannelId, 
    draftMessagesByChannel, 
    channelScrollPositions,
    theme
  } = state;

  const chatStateRequestIdRef = useRef(0);
  const initialChatLoadKeyRef = useRef<string | null>(null);

  const refreshAuthState = useCallback(async (): Promise<void> => {
    try {
      const providerData = await fetchAuthProviders();
      dispatch({ type: "SET_PROVIDERS", payload: providerData });
    } catch (cause) {
      console.error("Failed to load auth providers:", cause);
      const message = cause instanceof Error ? cause.message : "Failed to load auth providers.";
      dispatch({ type: "SET_ERROR", payload: `${message} (Target: ${controlPlaneBaseUrl}/auth/providers)` });
    }

    const viewerData = await fetchViewerSession();
    dispatch({ type: "SET_VIEWER", payload: viewerData });

    try {
      const bootstrapData = await fetchBootstrapStatus();
      dispatch({ type: "SET_BOOTSTRAP_STATUS", payload: bootstrapData });
    } catch (cause) {
      console.error("Failed to load bootstrap status:", cause);
    }

    if (!viewerData || viewerData.needsOnboarding) {
      dispatch({ type: "SET_VIEWER_ROLES", payload: [] });
      dispatch({ type: "SET_HUBS", payload: [] });
      dispatch({ type: "SET_BLOCKED_USER_IDS", payload: [] });
      return;
    }

    void listViewerRoleBindings()
      .then((roleBindings) => dispatch({ type: "SET_VIEWER_ROLES", payload: roleBindings }))
      .catch(() => dispatch({ type: "SET_VIEWER_ROLES", payload: [] }));

    void listHubs()
      .then((items) => {
        dispatch({ type: "SET_HUBS", payload: items });
      })
      .catch(() => dispatch({ type: "SET_HUBS", payload: [] }));

    void listBlocks()
      .then((items) => dispatch({ type: "SET_BLOCKED_USER_IDS", payload: items }))
      .catch(() => dispatch({ type: "SET_BLOCKED_USER_IDS", payload: [] }));
  }, [dispatch]);

  const refreshChatState = useCallback(async (preferredServerId?: string, preferredChannelId?: string, preferredMessageId?: string, force = false, extraKnownChannels?: import("@skerry/shared").Channel[]): Promise<void> => {
    const requestId = ++chatStateRequestIdRef.current;
    
    // Throttled fetch for global list of servers, roles, and hubs
    // Reuse state if available and not forced, otherwise fetch fresh metadata
    const [serverItems, roleBindings, hubItems] = await Promise.all([
      // Always fetch servers if the current list is empty or if forced.
      // In E2E tests, this ensures we pick up newly joined servers after a redirect.
      (state.servers.length === 0 || force) ? listServers(force) : Promise.resolve(state.servers),
      (state.viewerRoles.length > 0 && !force) ? Promise.resolve(state.viewerRoles) : listViewerRoleBindings(force),
      (state.hubs.length > 0 && !force) ? Promise.resolve(state.hubs) : listHubs()
    ]);
    if (requestId !== chatStateRequestIdRef.current) return;

    // Determine target server and channel
    let nextServerId = preferredServerId ?? urlServerId ?? null;
    let nextChannelId = preferredChannelId ?? urlChannelId ?? null;

    if (!nextServerId) {
      if (requestId === chatStateRequestIdRef.current) {
        dispatch({
          type: "SET_CHAT_INITIAL_DATA",
          payload: {
            servers: serverItems,
            viewerRoles: roleBindings,
            hubs: hubItems,
            selectedServerId: null,
            channels: [],
            categories: [],
            selectedChannelId: null,
            messages: [],
            error: null
          }
        });
        dispatch({ type: "SET_SWITCHING_SERVER", payload: false });
        setUrlSelection(null, null);
        if (setTargetUrl) setTargetUrl(null);
      }
      return;
    }

    // Optimize: Check if we already have the correct data for this server and channel
    const currentDataBelongsToTargetServer = state.channels.length > 0 && state.channels[0]?.serverId === nextServerId;

    // EXTREME OPTIMIZATION: If we are already on this server and channel,
    // and we have messages, and the data actually belongs to this server, 
    // don't do a full refresh unless forced.
    if (!force && !preferredMessageId && 
        nextServerId === state.selectedServerId && 
        nextChannelId === state.selectedChannelId && 
        state.messages.length > 0 &&
        currentDataBelongsToTargetServer) {
       // Just update metadata if needed
        if (requestId === chatStateRequestIdRef.current) {
           dispatch({ type: "SET_SWITCHING_SERVER", payload: false });
           void markChannelAsRead(nextChannelId!); 
        }
       return;
    }

    // Optimize: If we don't have an explicit channel, we still need to load the server's channels to pick one
    let channelItems = state.channels;
    let categoryItems = state.categories;

    if (force || nextServerId !== state.selectedServerId || !currentDataBelongsToTargetServer || categoryItems.length === 0) {
      // If we are switching servers, we still need the room list for the sidebar
      [channelItems, categoryItems] = await Promise.all([
        listChannels(nextServerId),
        listCategories(nextServerId)
      ]);
      if (requestId !== chatStateRequestIdRef.current) return;
    }

    if (!nextChannelId) {
      const textChannels = channelItems.filter((channel) => channel.type === "text" || channel.type === "announcement");
      nextChannelId = textChannels[0]?.id ?? channelItems[0]?.id ?? null;
    }

    // Validate that the channel exists in this server (prevent stale localStorage hits).
    // For just-created channels (notably DMs), listChannels may lag the write or
    // the caller may have a fresher view than the closure-captured state, so we
    // accept a hand-off via `extraKnownChannels` and also fall back to
    // state.allDmChannels for the steady-state case.
    if (nextChannelId && !channelItems.find(c => c.id === nextChannelId)) {
      const known = extraKnownChannels?.find(c => c.id === nextChannelId)
        ?? state.allDmChannels.find(c => c.id === nextChannelId);
      if (known && known.serverId === nextServerId) {
        channelItems = [known, ...channelItems];
      } else {
        console.warn(`[useChatInitialization] Channel ${nextChannelId} not found in server ${nextServerId}. Resetting to default.`);
        const textChannels = channelItems.filter((channel) => channel.type === "text" || channel.type === "announcement");
        nextChannelId = textChannels[0]?.id ?? channelItems[0]?.id ?? null;
      }
    }

        // BOOTSTRAP: Load the entire room state in one atomic call
    if (nextChannelId) {
      try {
        let initData;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount <= maxRetries) {
          try {
            initData = await fetchChannelInit(nextChannelId);
            break;
          } catch (err) {
            if (retryCount === maxRetries) throw err;
            retryCount++;
            console.warn(`[useChatInitialization] fetchChannelInit failed, retrying (${retryCount}/${maxRetries})...`, err);
            // Linear backoff: 1s, 2s, 3s
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }

        if (!initData) throw new Error("Failed to load channel data after retries.");
        if (requestId !== chatStateRequestIdRef.current) return;

        dispatch({
          type: "SET_CHAT_INITIAL_DATA",
          payload: {
            servers: serverItems,
            viewerRoles: roleBindings,
            hubs: hubItems,
            selectedServerId: nextServerId,
            channels: channelItems,
            categories: categoryItems,
            selectedChannelId: nextChannelId,
            activeChannelData: initData.channel,
            messages: initData.messages.map((m: ChatMessage) => ({ ...m })),
            members: initData.members,
            permissions: initData.permissions,
            highlightedMessageId: preferredMessageId ?? urlMessageId ?? null,
            error: null
          }
        });
        dispatch({ type: "SET_SWITCHING_SERVER", payload: false });

        const finalMessageId = preferredMessageId ?? urlMessageId ?? null;
        setUrlSelection(nextServerId, nextChannelId, finalMessageId);
        const targetUrl = `${nextServerId}:${nextChannelId ?? "null"}:${finalMessageId ?? "null"}`;
        lastSyncedUrlRef.current = targetUrl;
        if (setTargetUrl) setTargetUrl(targetUrl);
        setDraftMessage(draftMessagesByChannel[nextChannelId] ?? "");

        // Track last channel by server
        if (nextServerId) {
          dispatch({ type: "SET_LAST_CHANNEL_BY_SERVER", payload: { serverId: nextServerId, channelId: nextChannelId } });
        }

        // Auto-mark as read
        void markChannelAsRead(nextChannelId);
        
        // Only fetch mappings if this is first load or server changed
        if (nextServerId !== state.selectedServerId || state.discordMappings.length === 0) {
          void listDiscordBridgeMappings(nextServerId)
            .then((items) => dispatch({ type: "SET_DISCORD_MAPPINGS", payload: items }))
            .catch(() => {});
        }

        // Use a small delay to ensure the DOM has rendered the reversed messages 
        // and calculated the new scrollHeight before we apply the saved position.
        setTimeout(() => {
          const list = messagesRef.current;
          if (list) {
            const savedPos = channelScrollPositions[nextChannelId!];
            list.scrollTop = savedPos !== undefined ? savedPos : 0;
            // Immediate check to see if we need the "Jump to Present" button
            dispatch({ type: "SET_NEAR_BOTTOM", payload: Math.abs(list.scrollTop) < 100 });
          }
        }, 50);

      } catch (err) {
        // If it's a 404, the channel is gone (likely after a workspace reset)
        // Recover by clearing stale state and retrying with the first available channel.
        if (err instanceof Error && err.message.toLowerCase().includes("404") && nextChannelId) {
          console.warn("[useChatInitialization] Channel 404'd. Clearing stale state and retrying fallback...", nextChannelId);
          localStorage.removeItem("lastChannelId");
          const textChannels = channelItems.filter((channel) => channel.type === "text" || channel.type === "announcement");
          const fallbackId = textChannels[0]?.id ?? channelItems[0]?.id ?? null;
          if (fallbackId && fallbackId !== nextChannelId) {
            return void refreshChatState(nextServerId, fallbackId, preferredMessageId, force);
          }
        }

        console.error("Failed to bootstrap room:", err);
        dispatch({ type: "SET_SWITCHING_SERVER", payload: false });
        dispatch({ type: "SET_ERROR", payload: "Failed to load chat room." });
      }
    } else {
      // Empty server or only voice rooms (unlikely)
      dispatch({
        type: "SET_CHAT_INITIAL_DATA",
        payload: {
          servers: serverItems,
          viewerRoles: roleBindings,
          hubs: hubItems,
          selectedServerId: nextServerId,
          channels: channelItems,
          categories: categoryItems,
          selectedChannelId: null,
          messages: [],
          error: null
        }
      });
      dispatch({ type: "SET_SWITCHING_SERVER", payload: false });
      setUrlSelection(nextServerId, null);
    }
  }, [urlServerId, urlChannelId, urlMessageId, selectedServerId, selectedChannelId, dispatch, setUrlSelection, lastSyncedUrlRef, setDraftMessage, draftMessagesByChannel, channelScrollPositions, messagesRef, markChannelAsRead, setTargetUrl, state.channels, state.categories, state.allDmChannels]);

  const handleServerChange = useCallback(async (serverId: string, channelId?: string, extraKnownChannels?: import("@skerry/shared").Channel[]): Promise<void> => {
    const targetChannelId = channelId ?? state.lastChannelByServer[serverId];
    dispatch({ type: "SET_SWITCHING_SERVER", payload: true });
    dispatch({ type: "SET_SELECTED_SERVER_ID", payload: serverId });
    localStorage.setItem("lastServerId", serverId);
    if (targetChannelId) localStorage.setItem("lastChannelId", targetChannelId);

    try {
      await refreshChatState(serverId, targetChannelId, undefined, true, extraKnownChannels);
    } catch (cause) {
      dispatch({ type: "SET_SWITCHING_SERVER", payload: false });
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to load channels." });
    }
  }, [state.lastChannelByServer, dispatch, refreshChatState]);

  const handleChannelChange = useCallback(async (channelId: string): Promise<void> => {
    localStorage.setItem("lastChannelId", channelId);
    setUrlSelection(selectedServerId, channelId);
    const targetUrl = `${selectedServerId}:${channelId ?? "null"}:null`;
    if (setTargetUrl) setTargetUrl(targetUrl);
    lastSyncedUrlRef.current = targetUrl;

    setDraftMessage(draftMessagesByChannel[channelId] ?? "");

    try {
      // REFACTOR: Just call refreshChatState with force=true to avoid duplicate code
      await refreshChatState(selectedServerId ?? undefined, channelId, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to load channel." });
    }
  }, [selectedServerId, dispatch, setUrlSelection, lastSyncedUrlRef, setDraftMessage, draftMessagesByChannel, refreshChatState]);

  const initialize = useCallback(async (): Promise<void> => {
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await refreshAuthState();
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Failed to load auth state.";
      dispatch({ type: "SET_ERROR", payload: msg });
      showToast(msg, "error");
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [refreshAuthState, dispatch, showToast]);

  return {
    refreshAuthState,
    refreshChatState,
    handleServerChange,
    handleChannelChange,
    initialize,
    initialChatLoadKeyRef
  };
}
