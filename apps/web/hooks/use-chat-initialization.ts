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

  const refreshChatState = useCallback(async (preferredServerId?: string, preferredChannelId?: string, preferredMessageId?: string, force = false): Promise<void> => {
    const requestId = ++chatStateRequestIdRef.current;
    
    // Throttled fetch for global list of servers and roles
    // Reuse servers and roles from state if available, otherwise fetch
    const [serverItems, roleBindings] = await Promise.all([
      (state.servers.length > 0 && !force) ? Promise.resolve(state.servers) : listServers(force),
      (state.viewerRoles.length > 0 && !force) ? Promise.resolve(state.viewerRoles) : listViewerRoleBindings(force)
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
            selectedServerId: null,
            channels: [],
            categories: [],
            selectedChannelId: null,
            messages: [],
            error: null
          }
        });
        setUrlSelection(null, null);
        if (setTargetUrl) setTargetUrl(null);
      }
      return;
    }

    // EXTREME OPTIMIZATION: If we are already on this server and channel,
    // and we have messages, don't do a full refresh unless forced.
    // Note: We also don't skip if preferredMessageId is provided, as that implies a jump.
    if (!force && !preferredMessageId && nextServerId === state.selectedServerId && nextChannelId === state.selectedChannelId && state.messages.length > 0) {
       // Just update metadata if needed
       if (requestId === chatStateRequestIdRef.current) {
          void markChannelAsRead(nextChannelId!); 
       }
       return;
    }

    // Optimize: If we don't have an explicit channel, we still need to load the server's channels to pick one
    let channelItems = state.channels;
    let categoryItems = state.categories;
    const currentDataBelongsToNextServer = channelItems.length > 0 && channelItems[0]?.serverId === nextServerId;

    if (force || nextServerId !== state.selectedServerId || !currentDataBelongsToNextServer || categoryItems.length === 0) {
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

    // BOOTSTRAP: Load the entire room state in one atomic call
    if (nextChannelId) {
      try {
        const initData = await fetchChannelInit(nextChannelId);
        if (requestId !== chatStateRequestIdRef.current) return;

        dispatch({
          type: "SET_CHAT_INITIAL_DATA",
          payload: {
            servers: serverItems,
            viewerRoles: roleBindings,
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

        setTimeout(() => {
          const list = messagesRef.current;
          if (list) {
            const savedPos = channelScrollPositions[nextChannelId!];
            list.scrollTop = savedPos !== undefined ? savedPos : list.scrollHeight;
          }
        }, 0);

      } catch (err) {
        console.error("Failed to bootstrap room:", err);
        dispatch({ type: "SET_ERROR", payload: "Failed to load chat room." });
      }
    } else {
      // Empty server or only voice rooms (unlikely)
      dispatch({
        type: "SET_CHAT_INITIAL_DATA",
        payload: {
          servers: serverItems,
          viewerRoles: roleBindings,
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
  }, [urlServerId, urlChannelId, urlMessageId, selectedServerId, selectedChannelId, dispatch, setUrlSelection, lastSyncedUrlRef, setDraftMessage, draftMessagesByChannel, channelScrollPositions, messagesRef, markChannelAsRead, setTargetUrl, state.channels, state.categories]);

  const handleServerChange = useCallback(async (serverId: string, channelId?: string): Promise<void> => {
    const targetChannelId = channelId ?? state.lastChannelByServer[serverId];
    dispatch({ type: "SET_SWITCHING_SERVER", payload: true });
    dispatch({ type: "SET_SELECTED_SERVER_ID", payload: serverId });
    localStorage.setItem("lastServerId", serverId);
    if (targetChannelId) localStorage.setItem("lastChannelId", targetChannelId);

    try {
      await refreshChatState(serverId, targetChannelId, undefined, true);
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
