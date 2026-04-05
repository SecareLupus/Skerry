"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useChat, MessageItem, ModalType } from "../context/chat-context";
import { AuthOverlay } from "./auth-overlay";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./chat-window";
import { ErrorBoundary } from "./error-boundary";
import { ClientTopbar } from "./layout/ClientTopbar";
import { ClientModals } from "./modals/ClientModals";
import { ModalManager } from "./modal-manager";
import type { Category, Channel, ChannelType, ChatMessage, MentionMarker, ModerationAction, ModerationReport, Server, VoicePresenceMember, VoiceTokenGrant } from "@skerry/shared";
import { getChannelName, getChannelIcon } from "../lib/channel-utils";
import { ThreadPanel } from "./thread-panel";
import {
  bootstrapAdmin,
  createReport,
  connectMessageStream,
  connectHubStream,
  completeUsernameOnboarding,
  createCategory,
  createChannel,
  createHubInvite,
  createServer,
  deleteChannel,
  deleteCategory, // Added deleteCategory
  deleteServer,
  issueVoiceToken,
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
  inviteToChannel,
  listMessages,
  listMessagesAround,
  searchMessages,
  searchUsers,
  getFirstUnreadMessageId,
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
  updateServerSettings,
  updateUserTheme,
  uploadMedia,
  updateChannelSettings,
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


import Link from "next/link";

// Custom Hooks
import { useToast } from "./toast-provider";
import { useVoice } from "../hooks/use-voice";
import { useNotifications } from "../hooks/use-notifications";
import { useNotificationBadge } from "../hooks/use-notification-badge";
import { useDMs } from "../hooks/use-dms";
import { useModeration } from "../hooks/use-moderation";
import { usePresence } from "../hooks/use-presence";
import { useMembers } from "../hooks/use-members";
import { useChatRealtime } from "../hooks/use-chat-realtime";
import { useChatNavigation } from "../hooks/use-chat-navigation";
import { useChatInitialization } from "../hooks/use-chat-initialization";
import { useChatMutations } from "../hooks/use-chat-mutations";
import { useChatSettings } from "../hooks/use-chat-settings";
import { useChatMessaging } from "../hooks/use-chat-messaging";



function formatMessageTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}

export function ChatClient() {
  const { state, dispatch: originalDispatch } = useChat();
  const { showToast } = useToast();
  const messagesRef = useRef<HTMLOListElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [draftMessage, setDraftMessage] = useState("");

  const {
    urlServerId,
    urlChannelId,
    urlMessageId,
    lastSyncedUrlRef,
    targetUrlSelectionRef,
    previousUrlRef,
    setUrlSelection,
    handleServerKeyboardNavigation,
    handleChannelKeyboardNavigation
  } = useChatNavigation();

  const { markChannelAsRead } = useChatRealtime();

  const {
    refreshChatState,
    handleServerChange,
    handleChannelChange,
    initialize,
    initialChatLoadKeyRef
  } = useChatInitialization({
    urlServerId,
    urlChannelId,
    urlMessageId,
    setUrlSelection,
    markChannelAsRead,
    messagesRef,
    setDraftMessage,
    lastSyncedUrlRef,
    setTargetUrl: (url: string | null) => {
      targetUrlSelectionRef.current = url;
    }
  });

  const {
    draftMessage: _, // ignored from hook return as we lifted it
    setDraftMessage: __, // ignored from hook return as we lifted it
    handleSendMessage,
    submitDraftMessage,
    sendContentWithOptimistic,
    handleLogout
  } = useChatMessaging({
    selectedChannelId: state.selectedChannelId,
    messageInputRef,
    initialize,
    draftMessage,
    setDraftMessage
  });

  const mutations = useChatMutations({
    refreshChatState,
    handleChannelChange
  });

  const settings = useChatSettings({
    refreshChatState
  });

  const {
    handleUpdateRoomTopic: baseUpdateRoomTopic,
    handleUpdateRoomIcon: baseUpdateRoomIcon,
    handleToggleRoomLock: baseToggleRoomLock,
    handleSetSlowmode: baseSetSlowmode,
    handleRenameCategory
  } = settings;

  const handleUpdateRoomTopic = useCallback((topic: string) => {
    if (!state.selectedChannelId) return Promise.resolve();
    return baseUpdateRoomTopic(state.selectedChannelId, topic);
  }, [baseUpdateRoomTopic, state.selectedChannelId]);

  const handleUpdateRoomIcon = useCallback((iconUrl: string | null) => {
    if (!state.selectedChannelId) return Promise.resolve();
    return baseUpdateRoomIcon(state.selectedChannelId, iconUrl);
  }, [baseUpdateRoomIcon, state.selectedChannelId]);

  const handleToggleRoomLock = useCallback(() => {
    const activeChannel = state.channels.find(c => c.id === state.selectedChannelId);
    if (!state.selectedChannelId || !activeChannel) return Promise.resolve();
    return baseToggleRoomLock(state.selectedChannelId, !activeChannel.isLocked);
  }, [baseToggleRoomLock, state.selectedChannelId, state.channels]);

  const handleSetSlowmode = useCallback((seconds: number) => {
    if (!state.selectedChannelId) return Promise.resolve();
    return baseSetSlowmode(state.selectedChannelId, seconds);
  }, [baseSetSlowmode, state.selectedChannelId]);

  const handleMessageListScroll = (event: React.UIEvent<HTMLOListElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    dispatch({ type: "SET_IS_NEAR_BOTTOM", payload: nearBottom });
    if (nearBottom) {
      dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
    }
  };

  const jumpToLatest = () => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
    dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
  };

  const {
    spaceName, setSpaceName,
    roomName, setRoomName,
    roomType, setRoomType,
    roomIcon, setRoomIcon,
    selectedHubIdForCreate, setSelectedHubIdForCreate,
    categoryName, setCategoryName,
    iconFile, setIconFile,
    handleCreateSpace,
    handleRenameSpace,
    handleDeleteSpace,
    performDeleteSpace,
    handleCreateRoom,
    handleRenameRoom,
    handleDeleteRoom,
    performDeleteRoom,
    handleCreateCategory,
    handleDeleteCategory,
    handleMoveSelectedRoomCategory,
    moveCategoryPosition,
    moveChannelPosition,
    spaceSettingsTab, setSpaceSettingsTab,
    roomSettingsTab, setRoomSettingsTab
  } = mutations;

  const dispatch = useCallback((action: any) => {
    if (action.type?.startsWith("SET_VOICE_") || action.type === "SET_LOADING") {
      console.log("[ChatClient] DISPATCH:", action.type, action.payload);
    }
    originalDispatch(action);
  }, [originalDispatch]);

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
    renameSpaceIconUrl,
    renameCategoryId,
    renameCategoryName,
    renameRoomId,
    renameRoomName,
    renameRoomType,
    renameRoomCategoryId,
    renameRoomTopic,
    renameRoomIconUrl,
    renameRoomStyleContent,
    selectedCategoryIdForCreate,
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
    members,
    blockedUserIds,
    hubs
  } = state;

  const [isInviting, setIsInviting] = useState(false);
  const [isCreatingHubInvite, setIsCreatingHubInvite] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);

  const activeChannelData = state.activeChannelData;
  const activeServer = useMemo(
    () => servers.find((s) => s.id === (activeChannelData?.serverId ?? selectedServerId)),
    [servers, selectedServerId, activeChannelData?.serverId]
  );

  useEffect(() => {
    if (userSearchQuery.length > 1) {
      const timer = setTimeout(() => {
        void searchUsers(userSearchQuery).then(setUserSearchResults);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setUserSearchResults([]);
    }
  }, [userSearchQuery]);

  const canManageChannel = useMemo(
    () =>
      allowedActions.includes("channel.lock") ||
      allowedActions.includes("channel.unlock") ||
      allowedActions.includes("channel.slowmode"),
    [allowedActions]
  );

  const iconInputRef = useRef<HTMLInputElement>(null);

  const [mentions, setMentions] = useState<MentionMarker[]>([]);

  const filteredChannels = useMemo(() => {
    const term = channelFilter.trim().toLowerCase();
    if (!term) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(term));
  }, [channels, channelFilter]);

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


  const canAccessWorkspace = Boolean(viewer && !viewer.needsOnboarding && bootstrapStatus?.initialized);
  const activeChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
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

  const {
    voiceConnected,
    voiceMuted,
    voiceDeafened,
    voiceVideoEnabled,
    voiceGrant,
    voiceMembers,
    voiceVideoQuality,
    handleJoinVoice,
    handleLeaveVoice,
    handleToggleMuteDeafen,
    handleToggleVideo,
    handleSetVoiceChannelVideoDefaults
  } = useVoice();

  useNotifications();
  useDMs();
  usePresence();
  useMembers();

  const {
    userContextMenu,
    setUserContextMenu,
    handleUserContextMenu,
    userContextMenuItems
  } = useModeration(setUrlSelection, refreshChatState);

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

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
  }, [viewer, bootstrapStatus?.initialized, bootstrapStatus?.defaultServerId, bootstrapStatus?.defaultChannelId, refreshChatState, dispatch, showToast, initialChatLoadKeyRef]);

  useEffect(() => {
    if (!bootstrapStatus?.initialized) return;

    const currentUrlSelection = `${urlServerId}:${urlChannelId ?? "null"}:${urlMessageId ?? "null"}`;
    const stateUrlMapping = `${selectedServerId}:${selectedChannelId ?? "null"}:${state.highlightedMessageId ?? "null"}`;

    // 1. If URL matches the target we set, we have arrived!
    if (targetUrlSelectionRef.current === currentUrlSelection) {
      targetUrlSelectionRef.current = null;
      lastSyncedUrlRef.current = currentUrlSelection;
      previousUrlRef.current = currentUrlSelection;
      return;
    }

    // 2. If URL hasn't moved at all, return.
    if (currentUrlSelection === previousUrlRef.current) {
      lastSyncedUrlRef.current = currentUrlSelection;
      return;
    }

    // 3. If URL is still at the OLD value but state is at the NEW value (Lagging),
    // and we have a pending target, ignore it.
    if (targetUrlSelectionRef.current && currentUrlSelection === previousUrlRef.current) {
      return;
    }

    // 4. If URL matches our current state exactly, just update refs.
    if (currentUrlSelection === stateUrlMapping) {
      lastSyncedUrlRef.current = currentUrlSelection;
      previousUrlRef.current = currentUrlSelection;
      targetUrlSelectionRef.current = null;
      return;
    }

    // 5. If we reach here, the URL has DRIFTED to an unexpected value.
    // This is likely user navigation (Back/Forward). Sync back to the URL.
    console.log("[ChatClient] True URL drift detected! Syncing state to URL.", { 
      current: currentUrlSelection, 
      previous: previousUrlRef.current,
      target: targetUrlSelectionRef.current,
      state: stateUrlMapping
    });

    targetUrlSelectionRef.current = null;
    previousUrlRef.current = currentUrlSelection;
    lastSyncedUrlRef.current = currentUrlSelection;
    void refreshChatState(urlServerId ?? undefined, urlChannelId ?? undefined);
  }, [urlServerId, urlChannelId, urlMessageId, bootstrapStatus?.initialized, refreshChatState, selectedServerId, selectedChannelId, state.highlightedMessageId]);

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


  // useDMs() hook at top of component already handles this

  useEffect(() => {
    dispatch({ type: "SET_PENDING_NEW_MESSAGE_COUNT", payload: 0 });
    dispatch({ type: "SET_LAST_SEEN_MESSAGE_ID", payload: null });
    dispatch({ type: "SET_NEAR_BOTTOM", payload: true });
  }, [selectedChannelId, dispatch]);

  useEffect(() => {
    const selectedServer = servers.find((server) => server.id === selectedServerId);
    dispatch({ type: "SET_RENAME_SPACE", payload: { id: selectedServer?.id ?? "", name: selectedServer?.name ?? "" } });
    dispatch({ type: "SET_DELETE_TARGET_SPACE_ID", payload: state.deleteTargetSpaceId || selectedServer?.id || servers[0]?.id || "" });
  }, [selectedServerId, servers, dispatch, state.deleteTargetSpaceId]);


  useEffect(() => {
    const selected = channels.find((channel) => channel.id === selectedChannelId);
    dispatch({ type: "SET_RENAME_ROOM", payload: { id: selected?.id ?? "", name: (selected?.name ?? "").replace(/^#/, ""), type: selected?.type ?? "text", categoryId: selected?.categoryId ?? null, topic: selected?.topic ?? "", styleContent: selected?.styleContent ?? "", iconUrl: selected?.iconUrl ?? null } });
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
  }, [voiceConnected, selectedServerId, selectedChannelId, activeChannel?.type, dispatch]);

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
  }, [isNearBottom, lastSeenMessageId, messages, dispatch, pendingNewMessageCount]);












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
    <>
      <main className="app">
      <ClientTopbar
        dispatch={dispatch}
        viewer={viewer}
        realtimeState={realtimeState}
        theme={theme}
        toggleTheme={toggleTheme}
        handleLogout={handleLogout}
        error={error}
      />

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
          className={`chat-shell ${isDetailsOpen ? "" : "details-collapsed"} ${state.isSidebarOpen ? "sidebar-open" : ""} ${state.threadParentId ? "thread-open" : ""}`}
          aria-label="Chat workspace"
        >
          <div className="sidebar-drawer-container">
            <ErrorBoundary>
              <Sidebar
                handleServerChange={handleServerChange}
                handleChannelChange={handleChannelChange}
                handleServerKeyboardNavigation={handleServerKeyboardNavigation}
                handleChannelKeyboardNavigation={handleChannelKeyboardNavigation}
                performDeleteSpace={performDeleteSpace}
                performDeleteRoom={performDeleteRoom}
              />
            </ErrorBoundary>
          </div>
          <ErrorBoundary>
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
              handleUpdateRoomTopic={handleUpdateRoomTopic}
              handleUpdateRoomIcon={handleUpdateRoomIcon}
              handleToggleRoomLock={handleToggleRoomLock}
              handleSetSlowmode={handleSetSlowmode}
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
          </ErrorBoundary>

          <ErrorBoundary>
            {state.threadParentId && <ThreadPanel />}
          </ErrorBoundary>

          <div className="details-drawer-container">
            {isDetailsOpen && (
              <ErrorBoundary>
                <aside className="context panel scrollable-pane" aria-label="Channel context">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <h2 style={{ margin: 0 }}>Channel Details</h2>
                    {selectedServerId && activeServer?.type !== "dm" && (
                      <button
                        type="button"
                        onClick={() => setIsCreatingHubInvite(true)}
                        title="Create Hub Invite"
                        style={{
                          background: "var(--accent-color, #5865f2)",
                          padding: "0.4rem 1rem",
                          borderRadius: "10px",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: "white",
                          border: "none",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                          transition: "all 0.2s ease",
                          width: "auto",
                          minWidth: "64px",
                          minHeight: "44px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: "1.2",
                          gap: "0.1rem"
                        }}
                      >
                        <span style={{ fontSize: "1.4rem", color: "white", fontWeight: 800 }}>+</span>
                        <span style={{ color: "white" }}>Invite</span>
                      </button>
                    )}
                    {activeChannel?.type === "dm" && (
                      <button
                        type="button"
                        onClick={() => setIsInviting(true)}
                        title="Invite Participants"
                        style={{
                          background: "var(--accent-color, #5865f2)",
                          padding: "0.4rem 1rem",
                          borderRadius: "10px",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: "white",
                          border: "none",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                          transition: "all 0.2s ease",
                          width: "auto",
                          minWidth: "64px",
                          minHeight: "44px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: "1.2",
                          gap: "0.1rem"
                        }}
                      >
                        <span style={{ fontSize: "1.4rem", color: "white", fontWeight: 800 }}>👤+</span>
                        <span style={{ color: "white" }}>Invite</span>
                      </button>
                    )}
                  </div>
                  {activeChannel ? (
                    <>
                      <p className="context-line">
                        <strong>Name:</strong> #{getChannelName(activeChannel, viewer?.productUserId, members)}
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
                              data-online={member.isOnline.toString()}
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
                      )}

                      {activeChannel.type === "voice" ? (
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
              </ErrorBoundary>
            )}
          </div >
        </section >
      )}

      <ModalManager />
      <ClientModals 
        activeModal={activeModal}
        dispatch={dispatch}
        spaceName={spaceName}
        setSpaceName={setSpaceName}
        renameSpaceId={renameSpaceId}
        renameSpaceName={renameSpaceName}
        renameSpaceIconUrl={renameSpaceIconUrl}
        spaceSettingsTab={spaceSettingsTab}
        setSpaceSettingsTab={setSpaceSettingsTab}
        iconFile={iconFile}
        setIconFile={setIconFile}
        categoryName={categoryName}
        setCategoryName={setCategoryName}
        renameCategoryId={renameCategoryId}
        renameCategoryName={renameCategoryName}
        roomName={roomName}
        setRoomName={setRoomName}
        roomType={roomType}
        setRoomType={setRoomType}
        roomIcon={roomIcon}
        setRoomIcon={setRoomIcon}
        renameRoomId={renameRoomId}
        renameRoomName={renameRoomName}
        renameRoomType={renameRoomType}
        renameRoomCategoryId={renameRoomCategoryId}
        renameRoomTopic={renameRoomTopic}
        renameRoomIconUrl={renameRoomIconUrl}
        renameRoomStyleContent={renameRoomStyleContent}
        roomSettingsTab={roomSettingsTab}
        setRoomSettingsTab={setRoomSettingsTab}
        isInviting={isInviting}
        setIsInviting={setIsInviting}
        isCreatingHubInvite={isCreatingHubInvite}
        setIsCreatingHubInvite={setIsCreatingHubInvite}
        userSearchQuery={userSearchQuery}
        setUserSearchQuery={setUserSearchQuery}
        userSearchResults={userSearchResults}
        lastInviteUrl={lastInviteUrl}
        setLastInviteUrl={setLastInviteUrl}
        mutatingStructure={mutatingStructure}
        serverId={selectedServerId!}
        selectedChannelId={selectedChannelId}
        selectedCategoryIdForCreate={selectedCategoryIdForCreate}
        activeServer={activeServer}
        activeChannel={activeChannel!}
        channels={channels}
        categories={categories}
        handleCreateSpace={handleCreateSpace}
        handleRenameSpace={handleRenameSpace}
        handleCreateCategory={handleCreateCategory}
        handleRenameCategory={handleRenameCategory}
        handleDeleteCategory={handleDeleteCategory}
        moveCategoryPosition={moveCategoryPosition}
        handleCreateRoom={handleCreateRoom}
        handleRenameRoom={handleRenameRoom}
        moveChannelPosition={moveChannelPosition}
        performDeleteRoom={performDeleteRoom}
        refreshChatState={refreshChatState}
      />
</main>

    </>
  );
}
