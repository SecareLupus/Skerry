"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useChat, MessageItem, ModalType } from "../context/chat-context";
import { AuthOverlay } from "./auth-overlay";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./chat-window";
import Link from "next/link";
import { useToast } from "./toast-provider";
import { ContextMenu, ContextMenuItem } from "./context-menu";
import { ProfileModal } from "./profile-modal";
import type { Category, Channel, ChatMessage, MentionMarker, ModerationAction, ModerationReport, Server, VoicePresenceMember, VoiceTokenGrant } from "@skerry/shared";
import {
  bootstrapAdmin,
  createReport,
  connectMessageStream,
  completeUsernameOnboarding,
  createCategory,
  createChannel,
  createServer,
  deleteChannel,
  deleteCategory, // Added deleteCategory
  deleteServer,
  issueVoiceTokenWithVideo,
  fetchAllowedActions,
  fetchAuthProviders,
  fetchBootstrapStatus,
  fetchViewerSession,
  fetchNotificationSummary,
  listHubs,
  listMentions,
  listAuditLogs,
  listReports,
  listChannelReadStates,
  listCategories,
  listChannels,
  listMessages,
  listServers,
  listViewerRoleBindings,
  joinVoicePresence,
  leaveVoicePresence,
  listVoicePresence,
  moveChannelCategory,
  performModerationAction,
  logout,
  providerLinkUrl,
  providerLoginUrl,
  renameCategory,
  renameChannel,
  renameServer,
  sendMessage,
  transitionReportStatus,
  updateChannelVideoControls,
  upsertChannelReadState,
  updateChannelControls,
  updateUserTheme,
  updateVoicePresenceState,
  controlPlaneBaseUrl,
  createDMChannel,
  blockUser,
  unblockUser,
  listBlocks,
  listDiscordBridgeMappings,
  fetchDiscordBridgeHealth,
  updatePresence,
  listChannelMembers,
  type AuthProvidersResponse,
  type BootstrapStatus,
  type ViewerRoleBinding,
  type PrivilegedAction,
  type ViewerSession
} from "../lib/control-plane";



function formatMessageTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlServerId = searchParams.get("server");
  const urlChannelId = searchParams.get("channel");
  const suggestedUsername = searchParams.get("suggestedUsername");

  const { state, dispatch: originalDispatch } = useChat();
  const dispatch = useCallback((action: any) => {
    if (action.type?.startsWith("SET_VOICE_") || action.type === "SET_LOADING") {
      console.log("[ChatClient] DISPATCH:", action.type, action.payload);
    }
    originalDispatch(action);
  }, [originalDispatch]);

  const { showToast } = useToast();
  const {
    viewer,
    providers,
    bootstrapStatus,
    servers,
    channels,
    categories,
    messages,
    viewerRoles,
    selectedServerId,
    selectedChannelId,
    loading,
    error,
    realtimeState,
    allowedActions,
    theme,
    activeModal,
    isDetailsOpen,
    isAddMenuOpen,
    channelFilter,
    lastReadByChannel,
    mentionCountByChannel,
    isNearBottom,
    pendingNewMessageCount,
    lastSeenMessageId,
    renameSpaceId,
    renameSpaceName,
    renameCategoryId,
    renameCategoryName,
    renameRoomId,
    renameRoomName,
    renameRoomType,
    renameRoomCategoryId,
    selectedCategoryIdForCreate,
    voiceConnected,
    voiceMuted,
    voiceDeafened,
    voiceVideoEnabled,
    voiceVideoQuality,
    voiceGrant,
    voiceMembers,
    unreadCountByChannel,
    creatingSpace,
    creatingRoom,
    creatingCategory,
    mutatingStructure,
    deleteTargetSpaceId,
    deleteSpaceConfirm,
    deleteRoomConfirm,
    discordMappings,
    discordConnection,
    sending,
    updatingControls,
    channelScrollPositions,
    draftMessagesByChannel,
    profileUserId,
    members
  } = state;

  const [mentions, setMentions] = useState<MentionMarker[]>([]);
  const { blockedUserIds } = state;
  const previousServerIdRef = useRef<string | null>(null);

  const filteredChannels = useMemo(() => {
    const term = channelFilter.trim().toLowerCase();
    if (!term) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(term));
  }, [channels, channelFilter]);

  useEffect(() => {
    console.log("[ChatClient] Component Mounted");
    return () => console.log("[ChatClient] Component Unmounted");
  }, []);

  const groupedChannels = useMemo(() => {
    const byCategory = new Map<string | null, Channel[]>();
    for (const channel of filteredChannels) {
      const key = channel.categoryId ?? null;
      const bucket = byCategory.get(key) ?? [];
      bucket.push(channel);
      byCategory.set(key, bucket);
    }

    const groups: Array<{ id: string | null; name: string; channels: Channel[] }> = [];
    const uncategorized = byCategory.get(null) ?? [];
    if (uncategorized.length > 0) {
      groups.push({ id: null, name: "", channels: uncategorized });
    }

    for (const category of categories) {
      const channelsForCategory = byCategory.get(category.id) ?? [];
      groups.push({
        id: category.id,
        name: category.name,
        channels: channelsForCategory
      });
    }

    return groups;
  }, [categories, filteredChannels]);

  const groupedChannelIds = useMemo(() => {
    return filteredChannels.map(c => c.id);
  }, [filteredChannels]);

  const [draftMessage, setDraftMessage] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);

  const [spaceName, setSpaceName] = useState("New Space");
  const [roomName, setRoomName] = useState("new-room");
  const [roomType, setRoomType] = useState<"text" | "announcement" | "voice">("text");
  const [selectedHubIdForCreate, setSelectedHubIdForCreate] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("New Category");

  const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number; userId: string; displayName: string } | null>(null);

  const messagesRef = useRef<HTMLOListElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const chatStateRequestIdRef = useRef(0);
  const initialChatLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const savedTheme = (viewer?.identity?.theme || localStorage.getItem("theme")) as "light" | "dark" | null;
    if (savedTheme) {
      dispatch({ type: "SET_THEME", payload: savedTheme });
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      dispatch({ type: "SET_THEME", payload: "dark" });
    }
  }, [viewer?.identity, dispatch]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    dispatch({ type: "SET_THEME", payload: next });
    void updateUserTheme(next);
  }, [theme, dispatch]);

  const canAccessWorkspace = Boolean(viewer && !viewer.needsOnboarding && bootstrapStatus?.initialized);
  const activeChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const canManageChannel = useMemo(
    () =>
      allowedActions.includes("channel.lock") ||
      allowedActions.includes("channel.unlock") ||
      allowedActions.includes("channel.slowmode"),
    [allowedActions]
  );
  const canManageHub = useMemo(
    () => viewerRoles.some((binding) => binding.role === "hub_admin" && !binding.serverId),
    [viewerRoles]
  );
  const canManageCurrentSpace = useMemo(
    () =>
      viewerRoles.some(
        (binding) =>
          (binding.role === "hub_admin" || binding.role === "space_owner") &&
          (binding.serverId === selectedServerId || !binding.serverId)
      ),
    [viewerRoles, selectedServerId]
  );

  const renderedMessages = useMemo(() => {
    const grouped: Array<{
      message: MessageItem;
      showHeader: boolean;
      showDateDivider: boolean;
    }> = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]!;
      const previous = messages[index - 1];
      const currentTime = new Date(message.createdAt).getTime();
      const previousTime = previous ? new Date(previous.createdAt).getTime() : null;
      const showHeader =
        !previous ||
        previous.authorUserId !== message.authorUserId ||
        previousTime === null ||
        currentTime - previousTime > 5 * 60 * 1000;

      const showDateDivider =
        !previous ||
        new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();

      grouped.push({
        message,
        showHeader,
        showDateDivider
      });
    }

    return grouped;
  }, [messages]);

  const setUrlSelection = useCallback(
    (serverId: string | null, channelId: string | null) => {
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

      const query = next.toString();
      if (query === currentQuery) {
        return;
      }
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const refreshAuthState = useCallback(async (): Promise<void> => {
    // We fetch critical auth meta individually to prevent total failure if one service (like DB) is lagging.
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
      // Keep previous status or null on failure.
    }

    void listViewerRoleBindings()
      .then((roleBindings) => dispatch({ type: "SET_VIEWER_ROLES", payload: roleBindings }))
      .catch(() => dispatch({ type: "SET_VIEWER_ROLES", payload: [] }));

    void listHubs()
      .then((items) => {
        dispatch({ type: "SET_HUBS", payload: items.map((h) => ({ id: h.id, name: h.name })) });
        if (items.length > 0 && items[0]) {
          setSelectedHubIdForCreate(items[0].id);
        }
      })
      .catch(() => dispatch({ type: "SET_HUBS", payload: [] }));

    void listBlocks()
      .then((items) => dispatch({ type: "SET_BLOCKED_USER_IDS", payload: items }))
      .catch(() => dispatch({ type: "SET_BLOCKED_USER_IDS", payload: [] }));
  }, [dispatch]);

  const handleUserContextMenu = (event: React.MouseEvent, member: { id: string, displayName: string }) => {
    event.preventDefault();
    setUserContextMenu({ x: event.clientX, y: event.clientY, userId: member.id, displayName: member.displayName });
  };

  const userContextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!userContextMenu) return [];
    const isModerator = allowedActions.includes("moderation.kick") || allowedActions.includes("moderation.ban");
    const isSelf = userContextMenu.userId === viewer?.productUserId;

    const items: ContextMenuItem[] = [
      {
        label: "View Profile",
        icon: "👤",
        onClick: () => {
          dispatch({ type: "SET_PROFILE_USER_ID", payload: userContextMenu.userId });
          dispatch({ type: "SET_ACTIVE_MODAL", payload: "profile" });
        }
      },
      {
        label: "Direct Message",
        icon: "💬",
        onClick: async () => {
          if (!selectedHubIdForCreate) return;
          try {
            const channel = await createDMChannel(selectedHubIdForCreate, [userContextMenu.userId]);
            setUrlSelection(channel.serverId, channel.id);
            void refreshChatState(channel.serverId, channel.id);
          } catch (e) {
            showToast("Failed to create DM channel", "error");
          }
        }
      }
    ];

    if (!isSelf) {
      const isBlocked = blockedUserIds.includes(userContextMenu.userId);
      items.push({
        label: isBlocked ? "Unblock User" : "Ignore / Block",
        icon: isBlocked ? "✅" : "🚫",
        onClick: async () => {
          try {
            if (isBlocked) {
              await unblockUser(userContextMenu.userId);
              dispatch({ type: "UNBLOCK_USER", payload: userContextMenu.userId });
              showToast("User unblocked", "success");
            } else {
              await blockUser(userContextMenu.userId);
              dispatch({ type: "BLOCK_USER", payload: userContextMenu.userId });
              showToast("User blocked", "success");
            }
          } catch (e) {
            showToast("Failed to update block status", "error");
          }
        }
      });
    }

    if (isModerator && !isSelf) {
      items.push({
        label: "Timeout (Shadow Mute)",
        icon: "⏳",
        danger: true,
        onClick: () => {
          void performModerationAction({
            action: "timeout",
            serverId: selectedServerId || "",
            targetUserId: userContextMenu.userId,
            timeoutSeconds: 3600,
            reason: "Shadow mute requested via context menu"
          });
        }
      });
      items.push({
        label: "Kick",
        icon: "👢",
        danger: true,
        onClick: () => {
          void performModerationAction({
            action: "kick",
            serverId: selectedServerId || "",
            targetUserId: userContextMenu.userId,
            reason: "Kick requested via context menu"
          });
        }
      });
    }

    return items;
  }, [userContextMenu, allowedActions, viewer, selectedServerId, dispatch]);

  const refreshChatState = useCallback(async (preferredServerId?: string, preferredChannelId?: string): Promise<void> => {
    const requestId = ++chatStateRequestIdRef.current;
    const [serverItems, roleBindings] = await Promise.all([
      listServers(),
      listViewerRoleBindings()
    ]);
    if (requestId !== chatStateRequestIdRef.current) {
      return;
    }
    dispatch({ type: "SET_SERVERS", payload: serverItems });
    dispatch({ type: "SET_VIEWER_ROLES", payload: roleBindings });


    const candidateServerId =
      preferredServerId ??
      urlServerId ??
      selectedServerId ??
      serverItems[0]?.id ??
      null;
    const nextServerId =
      candidateServerId && serverItems.some((server) => server.id === candidateServerId)
        ? candidateServerId
        : (serverItems[0]?.id ?? null);
    dispatch({ type: "SET_SELECTED_SERVER_ID", payload: nextServerId });

    if (!nextServerId) {
      dispatch({ type: "SET_CHANNELS", payload: [] });
      dispatch({ type: "SET_CATEGORIES", payload: [] });
      dispatch({ type: "SET_SELECTED_CHANNEL_ID", payload: null });
      dispatch({ type: "SET_MESSAGES", payload: [] });
      setUrlSelection(null, null);
      return;
    }

    // Clear channels to show loading state or clear previous server's sidebar
    dispatch({ type: "SET_CHANNELS", payload: [] });
    dispatch({ type: "SET_CATEGORIES", payload: [] });

    const channelItems = await listChannels(nextServerId);
    if (requestId !== chatStateRequestIdRef.current) {
      return;
    }
    const categoryItems = await listCategories(nextServerId);
    if (requestId !== chatStateRequestIdRef.current) {
      return;
    }
    dispatch({ type: "SET_CHANNELS", payload: channelItems });
    dispatch({ type: "SET_CATEGORIES", payload: categoryItems });

    void listDiscordBridgeMappings(nextServerId)
      .then((items) => dispatch({ type: "SET_DISCORD_MAPPINGS", payload: items }))
      .catch(() => dispatch({ type: "SET_DISCORD_MAPPINGS", payload: [] }));

    void fetchDiscordBridgeHealth(nextServerId)
      .then((health) => dispatch({ type: "SET_DISCORD_CONNECTION", payload: health.connection }))
      .catch(() => dispatch({ type: "SET_DISCORD_CONNECTION", payload: null }));

    const textChannels = channelItems.filter((channel) => channel.type === "text" || channel.type === "announcement");

    let nextChannelId = selectedChannelId;
    let shouldFetchMessages = false;

    // If an explicit channel ID is provided via arguments or URL:
    if (preferredChannelId || urlChannelId) {
      const explicitId = preferredChannelId ?? urlChannelId;
      if (explicitId && channelItems.some((c) => c.id === explicitId)) {
        nextChannelId = explicitId;
        shouldFetchMessages = true;
      }
    }

    // If there is NO active channel selected yet:
    if (!nextChannelId) {
      nextChannelId = textChannels[0]?.id ?? channelItems[0]?.id ?? null;
      shouldFetchMessages = true;
    }

    if (nextChannelId !== selectedChannelId) {
      dispatch({ type: "SET_SELECTED_CHANNEL_ID", payload: nextChannelId });
    }

    if (nextChannelId && (shouldFetchMessages || !selectedChannelId)) {
      const nextChannelObj = channelItems.find(c => c.id === nextChannelId);
      if (nextChannelObj) {
        dispatch({ type: "SET_ACTIVE_CHANNEL_DATA", payload: nextChannelObj });
      }
    }

    setUrlSelection(nextServerId, nextChannelId);

    if (!nextChannelId) {
      dispatch({ type: "SET_MESSAGES", payload: [] });
      return;
    }

    if (shouldFetchMessages) {
      const messageItems = await listMessages(nextChannelId);
      if (requestId !== chatStateRequestIdRef.current) {
        return;
      }
      dispatch({ type: "SET_MESSAGES", payload: messageItems.map((message) => ({ ...message })) });

      // Load draft message
      setDraftMessage(draftMessagesByChannel[nextChannelId] ?? "");

      // Restore scroll position
      setTimeout(() => {
        const list = messagesRef.current;
        if (list) {
          const savedPos = channelScrollPositions[nextChannelId];
          if (savedPos !== undefined) {
            list.scrollTop = savedPos;
          } else {
            list.scrollTop = list.scrollHeight;
          }
        }
      }, 0);
    }

    if (nextChannelId) {
      void listChannelMembers(nextChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch((e) => console.error("Failed to fetch members:", e));
    } else {
      dispatch({ type: "SET_MEMBERS", payload: [] });
    }
  }, [selectedServerId, selectedChannelId, setUrlSelection, urlChannelId, urlServerId, dispatch, draftMessagesByChannel, channelScrollPositions]);

  const initialize = useCallback(async (): Promise<void> => {
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await refreshAuthState();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Failed to load auth state.";
      dispatch({ type: "SET_ERROR", payload: msg });
      showToast(msg, "error");
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [refreshAuthState, dispatch]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Presence Heartbeat
  useEffect(() => {
    if (!viewer) return;

    const sendHeartbeat = () => {
      updatePresence().catch(() => { });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000); // Every minute
    return () => clearInterval(interval);
  }, [viewer]);

  // Periodic member list refresh for presence updates
  useEffect(() => {
    if (!selectedChannelId) return;

    const interval = setInterval(() => {
      listChannelMembers(selectedChannelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch(() => { });
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [selectedChannelId, dispatch]);

  // Potential bug trigger: This effect initializes the chat state (server/channel) based on 
  // bootstrap defaults. If bootstrapStatus or its properties update unexpectedly, this 
  // could reset the user's manual space selection back to the default space.
  useEffect(() => {
    if (!viewer || viewer.needsOnboarding || !bootstrapStatus?.initialized) {
      initialChatLoadKeyRef.current = null;
      return;
    }

    const lastServerId = localStorage.getItem("lastServerId");
    const lastChannelId = localStorage.getItem("lastChannelId");

    const loadKey = [
      viewer.productUserId,
      lastServerId ?? bootstrapStatus.defaultServerId ?? "",
      lastChannelId ?? bootstrapStatus.defaultChannelId ?? ""
    ].join(":");
    if (initialChatLoadKeyRef.current === loadKey) {
      return;
    }
    initialChatLoadKeyRef.current = loadKey;

    void refreshChatState(
      lastServerId ?? bootstrapStatus.defaultServerId ?? undefined,
      lastChannelId ?? bootstrapStatus.defaultChannelId ?? undefined
    ).catch(
      (cause) => {
        const msg = cause instanceof Error ? cause.message : "Failed to load chat state.";
        dispatch({ type: "SET_ERROR", payload: msg });
        showToast(msg, "error");
      }
    );
  }, [viewer, bootstrapStatus?.initialized, bootstrapStatus?.defaultServerId, bootstrapStatus?.defaultChannelId, refreshChatState]);

  useEffect(() => {
    if (!canAccessWorkspace || !selectedServerId) {
      dispatch({ type: "SET_ALLOWED_ACTIONS", payload: [] });
      return;
    }

    void fetchAllowedActions(selectedServerId, selectedChannelId ?? undefined)
      .then((actions) => dispatch({ type: "SET_ALLOWED_ACTIONS", payload: actions }))
      .catch(() => {
        dispatch({ type: "SET_ALLOWED_ACTIONS", payload: [] });
      });
  }, [canAccessWorkspace, selectedServerId, selectedChannelId, dispatch]);

  useEffect(() => {
    if (!canAccessWorkspace || !selectedServerId) {
      // Need a way to clear all read states or just ignore
      return;
    }

    void listChannelReadStates(selectedServerId)
      .then((items) => {
        for (const item of items) {
          dispatch({ type: "SET_LAST_READ", payload: { channelId: item.channelId, lastSeenId: item.lastReadAt } });
        }
      })
      .catch(() => {
        // Keep local map if read-state fetch fails.
      });
  }, [canAccessWorkspace, selectedServerId, dispatch]);


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

  useEffect(() => {
    dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
    dispatch({ type: "SET_LAST_SEEN_MESSAGE_ID", payload: null });
    dispatch({ type: "SET_NEAR_BOTTOM", payload: true });
  }, [selectedChannelId, dispatch]);

  useEffect(() => {
    const selectedServer = servers.find((server) => server.id === selectedServerId);
    dispatch({ type: "SET_RENAME_SPACE", payload: { id: selectedServer?.id ?? "", name: selectedServer?.name ?? "" } });
    dispatch({ type: "SET_DELETE_TARGET_SPACE_ID", payload: state.deleteTargetSpaceId || selectedServer?.id || servers[0]?.id || "" });
  }, [selectedServerId, servers, dispatch]);

  useEffect(() => {
    // Reset voice state ONLY if the server actually changed
    if (previousServerIdRef.current !== selectedServerId) {
      console.log("[ChatClient] Voice reset effect: Server changed. Previous:", previousServerIdRef.current, "New:", selectedServerId);
      dispatch({ type: "SET_VOICE_CONNECTED", payload: false });
      dispatch({ type: "SET_VOICE_MUTED", payload: false });
      dispatch({ type: "SET_VOICE_DEAFENED", payload: false });
      dispatch({ type: "SET_VOICE_GRANT", payload: null });
      dispatch({ type: "SET_VOICE_MEMBERS", payload: [] });
      previousServerIdRef.current = selectedServerId;
    } else {
      console.log("[ChatClient] Voice reset effect: Server unchanged. Skipping reset.");
    }
  }, [selectedServerId, dispatch]);

  useEffect(() => {
    const selected = channels.find((channel) => channel.id === selectedChannelId);
    dispatch({ type: "SET_RENAME_ROOM", payload: { id: selected?.id ?? "", name: selected?.name ?? "", type: selected?.type ?? "text", categoryId: selected?.categoryId ?? null } });
    dispatch({ type: "SET_SELECTED_CATEGORY_FOR_CREATE", payload: selected?.categoryId ?? "" });
  }, [channels, selectedChannelId, dispatch]);

  useEffect(() => {
    if (categories.length === 0) {
      dispatch({ type: "SET_RENAME_CATEGORY", payload: { id: "", name: "" } });
      dispatch({ type: "SET_SELECTED_CATEGORY_FOR_CREATE", payload: "" });
      return;
    }

    const current = categories.find((category) => category.id === renameCategoryId);
    const selected = current ?? categories[0]!;
    dispatch({ type: "SET_RENAME_CATEGORY", payload: { id: selected.id, name: selected.name } });
    dispatch({ type: "SET_SELECTED_CATEGORY_FOR_CREATE", payload: selected.id });
  }, [categories, renameCategoryId, dispatch]);


  useEffect(() => {
    if (!voiceConnected || !selectedServerId || !selectedChannelId || activeChannel?.type !== "voice") {
      dispatch({ type: "SET_VOICE_MEMBERS", payload: [] });
      return;
    }

    let stopped = false;
    const refresh = () => {
      void listVoicePresence({
        serverId: selectedServerId,
        channelId: selectedChannelId
      })
        .then((items) => {
          if (stopped) {
            return;
          }
          dispatch({ type: "SET_VOICE_MEMBERS", payload: items });
        })
        .catch(() => {
          // Keep previous roster on transient failures.
        });
    };

    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [voiceConnected, selectedServerId, selectedChannelId, activeChannel?.type]);

  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest || newest.id === lastSeenMessageId) {
      return;
    }

    const list = messagesRef.current;
    if (!list) {
      return;
    }

    if (isNearBottom) {
      list.scrollTop = list.scrollHeight;
      dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
      dispatch({ type: "SET_LAST_SEEN_MESSAGE_ID", payload: newest.id });
      return;
    }

    dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: pendingNewMessageCount + 1 });
    dispatch({ type: "SET_LAST_SEEN_MESSAGE_ID", payload: newest.id });
  }, [isNearBottom, lastSeenMessageId, messages]);

  useEffect(() => {
    if (!canAccessWorkspace || !selectedChannelId) {
      dispatch({ type: "SET_REALTIME_STATE", payload: "disconnected" });
      return;
    }

    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollInterval) {
        return;
      }

      dispatch({ type: "SET_REALTIME_STATE", payload: "polling" });
      pollInterval = setInterval(() => {
        void listMessages(selectedChannelId)
          .then((next: MessageItem[]) => {
            dispatch({
              type: "UPDATE_MESSAGES",
              payload: (current: MessageItem[]) => {
                const map = new Map<string, MessageItem>();
                // Keep all current sending/failed messages
                current.forEach((m: MessageItem) => {
                  if (m.clientState === "sending" || m.clientState === "failed") {
                    map.set(m.id, m);
                  }
                });
                // Add all server messages, letting them overwrite if ID matches
                // (Server messages won't have clientState so they'll overwrite "sending" if ID is same,
                // but usually tmp IDs are different).
                next.forEach((m: MessageItem) => map.set(m.id, m));

                return Array.from(map.values()).sort((a, b) =>
                  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );
              }
            });
          })
          .catch(() => {
            // Keep previous messages on transient polling failures.
          });
      }, 3000);
    };

    const stopPolling = () => {
      if (!pollInterval) {
        return;
      }
      clearInterval(pollInterval);
      pollInterval = null;
    };

    startPolling();

    const disconnectStream = connectMessageStream(selectedChannelId, {
      onOpen: () => {
        if (closed) {
          return;
        }
        stopPolling();
        dispatch({ type: "SET_REALTIME_STATE", payload: "live" });
      },
      onError: () => {
        if (closed) {
          return;
        }
        startPolling();
      },
      onMessageCreated: (message) => {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            if (current.some((item: MessageItem) => item.id === message.id)) {
              return current;
            }
            return [...current, message];
          }
        });
        // If we are already at the bottom of the channel where message was received
        if (state.selectedChannelId === message.channelId && state.isNearBottom) {
          void markChannelAsRead(message.channelId);
        }
      },
      onMessageUpdated: (updatedMessage) => {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            return current.map((item: MessageItem) => (item.id === updatedMessage.id ? updatedMessage : item));
          }
        });
      },
      onMessageDeleted: (deletedMessageId) => {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            return current.filter((item: MessageItem) => item.id !== deletedMessageId);
          }
        });
      }
    });

    return () => {
      closed = true;
      disconnectStream();
      stopPolling();
    };
  }, [canAccessWorkspace, selectedChannelId]);


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

  function handleServerKeyboardNavigation(event: ReactKeyboardEvent, currentServerId: string): void {
    const serverIds = servers.map((server) => server.id);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextId = getAdjacentId(currentServerId, serverIds, "next");
      if (nextId) {
        void handleServerChange(nextId);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const previousId = getAdjacentId(currentServerId, serverIds, "previous");
      if (previousId) {
        void handleServerChange(previousId);
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const first = serverIds[0];
      if (first) {
        void handleServerChange(first);
      }
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = serverIds[serverIds.length - 1];
      if (last) {
        void handleServerChange(last);
      }
    }
  }

  function handleChannelKeyboardNavigation(event: ReactKeyboardEvent, currentChannelId: string): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextId = getAdjacentId(currentChannelId, groupedChannelIds, "next");
      if (nextId) {
        void handleChannelChange(nextId);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const previousId = getAdjacentId(currentChannelId, groupedChannelIds, "previous");
      if (previousId) {
        void handleChannelChange(previousId);
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const first = groupedChannelIds[0];
      if (first) {
        void handleChannelChange(first);
      }
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = groupedChannelIds[groupedChannelIds.length - 1];
      if (last) {
        void handleChannelChange(last);
      }
    }
  }

  async function handleServerChange(serverId: string): Promise<void> {
    dispatch({ type: "SET_SELECTED_SERVER_ID", payload: serverId });
    localStorage.setItem("lastServerId", serverId);
    dispatch({ type: "SET_CHANNELS", payload: [] });
    dispatch({ type: "SET_CATEGORIES", payload: [] });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await refreshChatState(serverId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to load channels." });
    }
  }

  async function handleChannelChange(channelId: string): Promise<void> {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      dispatch({ type: "SET_ACTIVE_CHANNEL_DATA", payload: channel });
    }

    // Save current draft before switching
    if (selectedChannelId) {
      dispatch({ type: "SET_CHANNEL_DRAFT", payload: { channelId: selectedChannelId, draft: draftMessage } });
    }

    dispatch({ type: "SET_SELECTED_CHANNEL_ID", payload: channelId });
    localStorage.setItem("lastChannelId", channelId);

    // Load new draft
    setDraftMessage(draftMessagesByChannel[channelId] ?? "");

    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const next = await listMessages(channelId);
      dispatch({ type: "SET_MESSAGES", payload: next.map((message) => ({ ...message })) });
      setUrlSelection(selectedServerId, channelId);

      // Refresh members immediately on channel switch
      void listChannelMembers(channelId)
        .then((items) => dispatch({ type: "SET_MEMBERS", payload: items }))
        .catch((e) => console.error("Failed to fetch members on channel change:", e));

      // Restore scroll position
      setTimeout(() => {
        const list = messagesRef.current;
        if (list) {
          const savedPos = channelScrollPositions[channelId];
          if (savedPos !== undefined) {
            list.scrollTop = savedPos;
          } else {
            list.scrollTop = list.scrollHeight;
          }
        }
      }, 0);

      // Auto-clear if we are (presumably) at the bottom or latest messages loaded
      // We'll also rely on the scroll event but doing it here handles the initial load
      void markChannelAsRead(channelId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to load messages." });
    }
  }

  const markChannelAsRead = useCallback(async (channelId: string) => {
    if (!channelId) return;
    // Immediate UI update
    dispatch({ type: "CLEAR_NOTIFICATIONS", payload: { channelId } });
    try {
      await upsertChannelReadState(channelId);
    } catch (e) {
      // Ignore transient errors
    }
  }, [dispatch]);

  function handleMessageListScroll(event?: React.UIEvent<HTMLOListElement>): void {
    const list = messagesRef.current;
    if (!list) {
      return;
    }

    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const nearBottom = distanceFromBottom < 24;
    dispatch({ type: "SET_NEAR_BOTTOM", payload: nearBottom });

    if (selectedChannelId) {
      dispatch({ type: "SET_CHANNEL_SCROLL_POSITION", payload: { channelId: selectedChannelId, position: list.scrollTop } });
    }

    if (nearBottom) {
      dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
      if (selectedChannelId) {
        void markChannelAsRead(selectedChannelId);
      }
    }
  }

  function jumpToLatest(): void {
    const list = messagesRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
    dispatch({ type: "SET_NEAR_BOTTOM", payload: true });
    dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
  }


  async function handleCreateSpace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedHubIdForCreate || !spaceName.trim()) {
      return;
    }

    dispatch({ type: "SET_CREATING_SPACE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const created = await createServer({
        hubId: selectedHubIdForCreate,
        name: spaceName.trim()
      });
      setSpaceName("New Space");
      await refreshChatState(created.id);
      setUrlSelection(created.id, null);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create space." });
    } finally {
      dispatch({ type: "SET_CREATING_SPACE", payload: false });
    }
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedServerId || !roomName.trim()) {
      return;
    }

    dispatch({ type: "SET_CREATING_ROOM", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const created = await createChannel({
        serverId: selectedServerId,
        name: roomName.trim(),
        type: roomType,
        categoryId: selectedCategoryIdForCreate || undefined
      });
      setRoomName("new-room");
      await refreshChatState(selectedServerId, created.id);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create room." });
    } finally {
      dispatch({ type: "SET_CREATING_ROOM", payload: false });
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedServerId || !categoryName.trim()) {
      return;
    }

    dispatch({ type: "SET_CREATING_CATEGORY", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await createCategory({
        serverId: selectedServerId,
        name: categoryName.trim()
      });
      setCategoryName("New Category");
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create category." });
    } finally {
      dispatch({ type: "SET_CREATING_CATEGORY", payload: false });
    }
  }

  async function handleRenameCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedServerId || !renameCategoryId || !renameCategoryName.trim()) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await renameCategory({
        categoryId: renameCategoryId,
        serverId: selectedServerId,
        name: renameCategoryName.trim()
      });
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to rename category." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function moveCategoryPosition(categoryId: string, direction: "up" | "down"): Promise<void> {
    if (!selectedServerId) return;
    const index = categories.findIndex(c => c.id === categoryId);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const neighbor = categories[targetIndex];
    if (!neighbor) return;

    const current = categories[index];
    if (!current) return;

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      // Swap positions
      await Promise.all([
        renameCategory({ categoryId: current.id, serverId: selectedServerId, position: neighbor.position }),
        renameCategory({ categoryId: neighbor.id, serverId: selectedServerId, position: current.position })
      ]);
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to reorder category." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleMoveSelectedRoomCategory(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedServerId || !selectedChannelId) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await moveChannelCategory({
        channelId: selectedChannelId,
        serverId: selectedServerId,
        categoryId: selectedCategoryIdForCreate || null
      });
      await refreshChatState(selectedServerId, selectedChannelId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to move room." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleDeleteCategory(categoryId: string): Promise<void> {
    if (!selectedServerId) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await deleteCategory({
        serverId: selectedServerId,
        categoryId: categoryId
      });
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete category." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleRenameSpace(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!renameSpaceId || !renameSpaceName.trim()) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await renameServer({
        serverId: renameSpaceId,
        name: renameSpaceName.trim()
      });
      dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: "" } });
      await refreshChatState(renameSpaceId, selectedChannelId ?? undefined);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to rename space." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleDeleteSpace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const targetServerId = state.deleteTargetSpaceId || renameSpaceId || selectedServerId;
    if (!targetServerId) return;
    if (state.deleteSpaceConfirm.trim() !== "DELETE SPACE") {
      dispatch({ type: "SET_ERROR", payload: "Type DELETE SPACE to confirm." });
      return;
    }
    await performDeleteSpace(targetServerId);
  }

  async function performDeleteSpace(serverId: string): Promise<void> {
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await deleteServer(serverId);
      dispatch({ type: "SET_DELETE_SPACE_CONFIRM", payload: "" });
      const remainingServers = servers.filter((s) => s.id !== serverId);
      await refreshChatState(remainingServers[0]?.id);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete space." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleRenameRoom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!renameRoomId || !renameRoomName.trim() || !selectedServerId) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await renameChannel({
        channelId: renameRoomId,
        serverId: selectedServerId,
        name: renameRoomName.trim(),
        type: renameRoomType,
        categoryId: renameRoomCategoryId
      });
      dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: "", type: renameRoomType, categoryId: renameRoomCategoryId } });
      await refreshChatState(selectedServerId, renameRoomId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to update room." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function moveChannelPosition(channelId: string, direction: "up" | "down"): Promise<void> {
    if (!selectedServerId) return;
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    // Reordering happens WITHIN the same category (or within Uncategorized)
    const peers = channels
      .filter(c => c.categoryId === channel.categoryId)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

    const index = peers.findIndex(c => c.id === channelId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const neighbor = peers[targetIndex];
    if (!neighbor) return;

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      await Promise.all([
        renameChannel({ channelId: channel.id, serverId: selectedServerId, position: neighbor.position }),
        renameChannel({ channelId: neighbor.id, serverId: selectedServerId, position: channel.position })
      ]);
      await refreshChatState(selectedServerId, channelId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to reorder room." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }

  async function handleDeleteRoom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedChannelId || !selectedServerId) return;
    if (state.deleteRoomConfirm.trim() !== "DELETE ROOM") {
      dispatch({ type: "SET_ERROR", payload: "Type DELETE ROOM to confirm." });
      return;
    }
    await performDeleteRoom(selectedServerId, selectedChannelId);
  }

  async function performDeleteRoom(serverId: string, channelId: string): Promise<void> {
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await deleteChannel({ serverId, channelId });
      dispatch({ type: "SET_DELETE_ROOM_CONFIRM", payload: "" });
      const remainingChannels = channels.filter((c) => c.id !== channelId);
      await refreshChatState(serverId, remainingChannels[0]?.id);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete room." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }



  const handleJoinVoice = useCallback(async (): Promise<void> => {
    console.log("[ChatClient] handleJoinVoice called, server:", selectedServerId, "channel:", selectedChannelId);
    if (!selectedServerId || !selectedChannelId || activeChannel?.type !== "voice") {
      return;
    }

    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const grant = await issueVoiceTokenWithVideo({
        serverId: selectedServerId,
        channelId: selectedChannelId,
        videoQuality: voiceVideoQuality
      });
      await joinVoicePresence({
        serverId: selectedServerId,
        channelId: selectedChannelId,
        muted: voiceMuted,
        deafened: voiceDeafened,
        videoEnabled: voiceVideoEnabled,
        videoQuality: voiceVideoQuality
      });
      dispatch({
        type: "SET_VOICE_SESSION",
        payload: { connected: true, grant }
      });
      dispatch({
        type: "SET_VOICE_MEMBERS",
        payload: await listVoicePresence({
          serverId: selectedServerId,
          channelId: selectedChannelId
        })
      });
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to join voice." });
    }
  }, [selectedServerId, selectedChannelId, activeChannel?.type, voiceVideoQuality, voiceMuted, voiceDeafened, voiceVideoEnabled, dispatch]);

  const handleLeaveVoice = useCallback(async (): Promise<void> => {
    console.log("[ChatClient] handleLeaveVoice called. Connected:", voiceConnected, "Server:", selectedServerId, "Channel:", selectedChannelId);
    if (!selectedServerId || !selectedChannelId || !voiceConnected) {
      console.log("[ChatClient] handleLeaveVoice early exit - not connected or missing IDs.");
      return;
    }

    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await leaveVoicePresence({
        serverId: selectedServerId,
        channelId: selectedChannelId
      });
      dispatch({ type: "SET_VOICE_CONNECTED", payload: false });
      dispatch({ type: "SET_VOICE_GRANT", payload: null });
      dispatch({ type: "SET_VOICE_MEMBERS", payload: [] });
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to leave voice." });
    }
  }, [selectedServerId, selectedChannelId, voiceConnected, dispatch]);

  async function handleToggleMuteDeafen(nextMuted: boolean, nextDeafened: boolean): Promise<void> {
    if (!selectedServerId || !selectedChannelId || !voiceConnected) {
      dispatch({ type: "SET_VOICE_MUTED", payload: nextMuted });
      dispatch({ type: "SET_VOICE_DEAFENED", payload: nextDeafened });
      return;
    }

    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await updateVoicePresenceState({
        serverId: selectedServerId,
        channelId: selectedChannelId,
        muted: nextMuted,
        deafened: nextDeafened,
        videoEnabled: voiceVideoEnabled,
        videoQuality: voiceVideoQuality
      });
      dispatch({ type: "SET_VOICE_MUTED", payload: nextMuted });
      dispatch({ type: "SET_VOICE_DEAFENED", payload: nextDeafened });
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to update voice state." });
    }
  }

  async function handleToggleVideo(nextVideoEnabled: boolean): Promise<void> {
    dispatch({ type: "SET_VOICE_VIDEO_ENABLED", payload: nextVideoEnabled });
    if (!selectedServerId || !selectedChannelId || !voiceConnected) {
      return;
    }
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await updateVoicePresenceState({
        serverId: selectedServerId,
        channelId: selectedChannelId,
        muted: voiceMuted,
        deafened: voiceDeafened,
        videoEnabled: nextVideoEnabled,
        videoQuality: voiceVideoQuality
      });
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to update video state." });
    }
  }

  async function handleSetVoiceChannelVideoDefaults(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedServerId || !selectedChannelId || activeChannel?.type !== "voice") {
      return;
    }
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await updateChannelVideoControls({
        channelId: selectedChannelId,
        serverId: selectedServerId,
        videoEnabled: voiceVideoEnabled,
        maxVideoParticipants: 4
      });
      await refreshChatState(selectedServerId, selectedChannelId);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to update voice defaults." });
    }
  }


  async function sendContentWithOptimistic(content: string, attachments: any[] = [], existingMessageId?: string): Promise<void> {
    if (!selectedChannelId || !viewer || (!content.trim() && attachments.length === 0)) {
      return;
    }

    const tempId = existingMessageId ?? `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: MessageItem = {
      id: tempId,
      channelId: selectedChannelId,
      authorUserId: viewer.productUserId,
      authorDisplayName: viewer.identity?.preferredUsername ?? "You",
      content,
      attachments,
      createdAt: new Date().toISOString(),
      clientState: "sending"
    };

    dispatch({
      type: "UPDATE_MESSAGES",
      payload: (current: MessageItem[]) => {
        if (current.some((item: MessageItem) => item.id === tempId)) {
          return current.map((item: MessageItem) => (item.id === tempId ? optimisticMessage : item));
        }
        return [...current, optimisticMessage];
      }
    });

    dispatch({ type: "SET_SENDING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const persisted = await sendMessage(selectedChannelId, content.trim(), attachments);
      dispatch({
        type: "UPDATE_MESSAGES",
        payload: (current: MessageItem[]) => {
          // Check if message was already added by streamer
          if (current.some((m: MessageItem) => m.id === persisted.id)) {
            // Remove the temporary message if it still exists
            return current.filter((m: MessageItem) => m.id !== tempId);
          }
          // Replace temp with persisted
          return current.map((item: MessageItem) => (item.id === tempId ? persisted : item));
        }
      });
    } catch (cause) {
      dispatch({
        type: "UPDATE_MESSAGES",
        payload: (current: MessageItem[]) =>
          current.map((item: MessageItem) =>
            item.id === tempId
              ? {
                ...item,
                clientState: "failed"
              }
              : item
          )
      });
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Message send failed." });
    } finally {
      dispatch({ type: "SET_SENDING", payload: false });
    }
  }

  async function submitDraftMessage(attachments: any[] = []): Promise<void> {
    if (!selectedChannelId || (!draftMessage.trim() && attachments.length === 0)) {
      return;
    }

    const content = draftMessage.trim();
    setDraftMessage("");
    messageInputRef.current?.focus();
    await sendContentWithOptimistic(content, attachments);
  }

  async function handleSendMessage(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await submitDraftMessage();
  }

  async function handleLogout(): Promise<void> {
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await logout();
      dispatch({ type: "SET_VIEWER", payload: null });
      dispatch({ type: "SET_SERVERS", payload: [] });
      dispatch({ type: "SET_CHANNELS", payload: [] });
      dispatch({ type: "SET_MESSAGES", payload: [] });
      await initialize();
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Logout failed." });
    }
  }

  if (loading) {
    return (
      <main className="app">
        <section className="panel">
          <h1>Skerry</h1>
          <p>Loading local workspace...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>Skerry Local Chat</h1>
        <div className="topbar-meta">
          <button
            type="button"
            className="icon-button"
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            aria-label={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            onClick={toggleTheme}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>

          <Link href="/settings" className="icon-button" title="User Settings" aria-label="User Settings">
            ⚙️
          </Link>
          <span className="status-pill" data-state={realtimeState}>
            {realtimeState === "live" ? "Live" : realtimeState === "polling" ? "Polling" : "Offline"}
          </span>
          <span aria-live="polite">
            Signed in as {viewer?.identity?.preferredUsername ?? "Guest"}
          </span>
          {viewer ? (
            <button type="button" className="ghost" onClick={handleLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <AuthOverlay />

      <div
        className={`sidebar-overlay ${state.isSidebarOpen ? "visible" : ""}`}
        onClick={() => dispatch({ type: "SET_SIDEBAR_OPEN", payload: false })}
      />

      <div
        className={`details-overlay ${isDetailsOpen ? "visible" : ""}`}
        onClick={() => dispatch({ type: "SET_DETAILS_OPEN", payload: false })}
      />

      {canAccessWorkspace && (
        <section
          className={`chat-shell ${isDetailsOpen ? "" : "details-collapsed"} ${state.isSidebarOpen ? "sidebar-open" : ""}`}
          aria-label="Chat workspace"
        >
          <div className="sidebar-drawer-container">
            <Sidebar
              handleServerChange={handleServerChange}
              handleChannelChange={handleChannelChange}
              handleServerKeyboardNavigation={handleServerKeyboardNavigation}
              handleChannelKeyboardNavigation={handleChannelKeyboardNavigation}
              performDeleteSpace={performDeleteSpace}
              performDeleteRoom={performDeleteRoom}
            />
          </div>
          <ChatWindow
            handleSendMessage={handleSendMessage}
            handleMessageListScroll={handleMessageListScroll}
            jumpToLatest={jumpToLatest}
            submitDraftMessage={submitDraftMessage}
            sendContentWithOptimistic={sendContentWithOptimistic}
            handleJoinVoice={handleJoinVoice}
            handleLeaveVoice={handleLeaveVoice}
            handleToggleMuteDeafen={handleToggleMuteDeafen}
            handleToggleVideo={handleToggleVideo}
            draftMessage={draftMessage}
            setDraftMessage={setDraftMessage}

            sending={sending}
            voiceConnected={voiceConnected}
            voiceMuted={voiceMuted}
            voiceDeafened={voiceDeafened}
            voiceVideoEnabled={voiceVideoEnabled}
            voiceGrant={voiceGrant}
            mentions={mentions}
            messagesRef={messagesRef}
            messageInputRef={messageInputRef}
            refreshChatState={refreshChatState}
          />

          <div className="details-drawer-container">
            {isDetailsOpen && (
              <aside className="context panel scrollable-pane" aria-label="Channel context">
                <h2>Channel Details</h2>
                {activeChannel ? (
                  <>
                    <p className="context-line">
                      <strong>Name:</strong> #{activeChannel.name}
                    </p>
                    <p className="context-line">
                      <strong>Type:</strong> {activeChannel.type}
                    </p>
                    <p className="context-line">
                      <strong>Locked:</strong> {activeChannel.isLocked ? "Yes" : "No"}
                    </p>
                    <p className="context-line">
                      <strong>Slow mode:</strong> {activeChannel.slowModeSeconds}s
                    </p>
                    {(mentions.length ?? 0) > 0 ? (
                      <p className="context-line">
                        <strong>Mentions in channel:</strong> {mentions.length}
                      </p>
                    ) : null}

                    <hr />
                    <h3>Channel Members</h3>
                    <ul className="member-list">
                      {members.map((member) => (
                        <li
                          key={member.productUserId}
                          className="member-item"
                          onContextMenu={(e) => handleUserContextMenu(e, { id: member.productUserId, displayName: member.displayName })}
                          title={member.isOnline ? "Online" : "Offline"}
                        >
                          <span
                            className="member-dot"
                            data-online={member.isOnline}
                            data-status={member.bridgedUserStatus}
                          />
                          <span className="member-name">{member.displayName}</span>
                          {member.isBridged && (
                            <span className="bridged-badge" title={member.bridgedUserStatus || 'Bridged from Discord'}>
                              Bridged
                            </span>
                          )}
                        </li>
                      ))}
                      {members.length === 0 && <p className="muted">No members found</p>}
                    </ul >

                    {canManageChannel && (
                      <div style={{ marginTop: "1.5rem" }}>
                        <Link
                          href={`/settings/rooms/${activeChannel.id}`}
                          className="button-link ghost"
                          style={{ width: "100%" }}
                        >
                          Manage Channel Settings
                        </Link>
                      </div>
                    )
                    }

                    {
                      activeChannel.type === "voice" ? (
                        <>
                          <hr />
                          <h3>Voice Controls</h3>
                          <p className="context-line">
                            <strong>Status:</strong> {voiceConnected ? "Connected" : "Disconnected"}
                          </p>
                          {voiceGrant ? (
                            <p className="context-line">
                              <strong>Voice Room:</strong> {voiceGrant.sfuRoomId}
                            </p>
                          ) : null}
                          <div className="voice-actions">
                            {!voiceConnected ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleJoinVoice();
                                }}
                              >
                                Join Voice
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  void handleLeaveVoice();
                                }}
                              >
                                Leave Voice
                              </button>
                            )}
                          </div>
                        </>
                      ) : null
                    }
                  </>
                ) : (
                  <p>Select a channel to see details</p>
                )}
              </aside >
            )}
          </div >
        </section >
      )}

      {
        activeModal && (
          <div className="modal-backdrop" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <header className="modal-header">
                <h2>
                  {activeModal === "create-space" && "Create New Space"}
                  {activeModal === "create-category" && "Create New Category"}
                  {activeModal === "create-room" && "Create New Room"}
                  {activeModal === "rename-space" && "Rename Space"}
                  {activeModal === "rename-category" && "Rename Category"}
                  {activeModal === "rename-room" && "Rename Room"}
                </h2>
                <button type="button" className="ghost" onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>×</button>
              </header>

              {activeModal === "create-space" && (
                <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                  void handleCreateSpace(event);
                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                }}>
                  <label htmlFor="space-name-modal">Space Name</label>
                  <input
                    id="space-name-modal"
                    autoFocus
                    value={spaceName}
                    onChange={(e) => setSpaceName(e.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                  <button type="submit" disabled={creatingSpace}>Create Space</button>
                </form>
              )}

              {activeModal === "rename-space" && (
                <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                  void handleRenameSpace(event);
                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                }}>
                  <label htmlFor="rename-space-modal">New Space Name</label>
                  <input
                    id="rename-space-modal"
                    autoFocus
                    value={renameSpaceName}
                    onChange={(e) => dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: e.target.value } })}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                  <button type="submit" disabled={mutatingStructure}>Save Changes</button>
                </form>
              )}

              {activeModal === "create-category" && (
                <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                  void handleCreateCategory(event);
                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                }}>
                  <label htmlFor="category-name-modal">Category Name</label>
                  <input
                    id="category-name-modal"
                    autoFocus
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                  <button type="submit" disabled={creatingCategory}>Create Category</button>
                </form>
              )}

              {activeModal === "rename-category" && (
                <div className="stack">
                  <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                    void handleRenameCategory(event);
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                  }}>
                    <p>Editing category: <strong>{categories.find(c => c.id === renameCategoryId)?.name}</strong></p>
                    <label htmlFor="rename-category-modal">Category Name</label>
                    <input
                      id="rename-category-modal"
                      autoFocus
                      value={renameCategoryName}
                      onChange={(e) => dispatch({ type: "SET_RENAME_CATEGORY", payload: { id: renameCategoryId, name: e.target.value } })}
                      minLength={2}
                      maxLength={80}
                      required
                    />
                    <button type="submit" disabled={mutatingStructure}>Save Name</button>
                  </form>

                  <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                    <p>Reorder Category</p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        disabled={mutatingStructure || categories.findIndex(c => c.id === renameCategoryId) === 0}
                        onClick={() => moveCategoryPosition(renameCategoryId, "up")}
                      >
                        Move Up
                      </button>
                      <button
                        type="button"
                        disabled={mutatingStructure || categories.findIndex(c => c.id === renameCategoryId) === categories.length - 1}
                        onClick={() => moveCategoryPosition(renameCategoryId, "down")}
                      >
                        Move Down
                      </button>
                    </div>
                  </div>

                  <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                    <p>Danger Zone</p>
                    <button
                      type="button"
                      className="danger"
                      disabled={mutatingStructure}
                      onClick={() => {
                        const cat = categories.find(c => c.id === renameCategoryId);
                        if (confirm(`Are you sure you want to delete the category "${cat?.name}"? Rooms inside will become uncategorized.`)) {
                          void handleDeleteCategory(renameCategoryId);
                          dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                        }
                      }}
                    >
                      Delete Category
                    </button>
                  </div>
                </div>
              )}

              {activeModal === "create-room" && (
                <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                  void handleCreateRoom(event);
                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                }}>
                  <p>
                    Target Category: <strong>
                      {selectedCategoryIdForCreate ? categories.find(c => c.id === selectedCategoryIdForCreate)?.name : "Uncategorized"}
                    </strong>
                  </p>
                  <label htmlFor="room-name-modal">Room Name</label>
                  <input
                    id="room-name-modal"
                    autoFocus
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                  <label htmlFor="room-type-modal">Type</label>
                  <select id="room-type-modal" value={roomType} onChange={(e) => setRoomType(e.target.value as any)}>
                    <option value="text">Text Room</option>
                    <option value="announcement">Announcement Room</option>
                    <option value="voice">Voice Room</option>
                  </select>
                  <button type="submit" disabled={creatingRoom}>Create Room</button>
                </form>
              )}

              {activeModal === "rename-room" && (
                <div className="stack">
                  <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                    void handleRenameRoom(event);
                    dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                  }}>
                    <p>Editing room: <strong>{channels.find(c => c.id === renameRoomId)?.name}</strong></p>
                    <label htmlFor="rename-room-modal">Room Name</label>
                    <input
                      id="rename-room-modal"
                      autoFocus
                      value={renameRoomName}
                      onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: e.target.value, type: renameRoomType, categoryId: renameRoomCategoryId } })}
                      minLength={2}
                      maxLength={80}
                      required
                    />

                    <label htmlFor="rename-room-type">Type</label>
                    <select
                      id="rename-room-type"
                      value={renameRoomType}
                      onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: e.target.value as any, categoryId: renameRoomCategoryId } })}
                    >
                      <option value="text">Text Room</option>
                      <option value="announcement">Announcement Room</option>
                      <option value="voice">Voice Room</option>
                    </select>

                    <label htmlFor="rename-room-category">Category</label>
                    <select
                      id="rename-room-category"
                      value={renameRoomCategoryId ?? ""}
                      onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: e.target.value || null } })}
                    >
                      <option value="">(None)</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>

                    <button type="submit" disabled={mutatingStructure}>Save Changes</button>
                  </form>

                  <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                    <p>Reorder Room</p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        disabled={mutatingStructure || (() => {
                          const channel = channels.find(c => c.id === renameRoomId);
                          if (!channel) return true;
                          const peers = channels.filter(c => c.categoryId === channel.categoryId)
                            .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
                          return peers.findIndex(c => c.id === renameRoomId) === 0;
                        })()}
                        onClick={() => moveChannelPosition(renameRoomId, "up")}
                      >
                        Move Up
                      </button>
                      <button
                        type="button"
                        disabled={mutatingStructure || (() => {
                          const channel = channels.find(c => c.id === renameRoomId);
                          if (!channel) return true;
                          const peers = channels.filter(c => c.categoryId === channel.categoryId)
                            .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
                          return peers.findIndex(c => c.id === renameRoomId) === peers.length - 1;
                        })()}
                        onClick={() => moveChannelPosition(renameRoomId, "down")}
                      >
                        Move Down
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }

      {
        userContextMenu && (
          <ContextMenu
            x={userContextMenu.x}
            y={userContextMenu.y}
            items={userContextMenuItems}
            onClose={() => setUserContextMenu(null)}
          />
        )
      }

      {activeModal === "profile" && <ProfileModal />}
    </main >
  );
}
