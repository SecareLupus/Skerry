"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useChat, MessageItem, ModalType } from "../context/chat-context";
import { AuthOverlay } from "./auth-overlay";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./chat-window";
import { ErrorBoundary } from "./error-boundary";
import Link from "next/link";
import { LandingPageView } from "./landing-page-view";
import { useToast } from "./toast-provider";
import { ContextMenu, ContextMenuItem } from "./context-menu";
import { PermissionsEditor } from "./permissions-editor";
import type { Category, Channel, ChannelType, ChatMessage, MentionMarker, ModerationAction, ModerationReport, Server, VoicePresenceMember, VoiceTokenGrant } from "@skerry/shared";
import { getChannelName } from "../lib/channel-utils";
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
import { CodeEditor } from "./code-editor";
import { ThemeEngine } from "./theme-engine";
import { LANDING_PAGE_TEMPLATES } from "../lib/landing-page-templates";

// Custom Hooks
import { useVoice } from "../hooks/use-voice";
import { useNotifications } from "../hooks/use-notifications";
import { useNotificationBadge } from "../hooks/use-notification-badge";
import { useDMs } from "../hooks/use-dms";
import { useModeration } from "../hooks/use-moderation";
import { usePresence } from "../hooks/use-presence";
import { useMembers } from "../hooks/use-members";



function formatMessageTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const DEFAULT_LANDING_HTML = `
<div class="landing-page">
  <div class="card">
    <div class="server-badge">
      Welcome to Skerry
    </div>
    <h1>
      {{SERVER_NAME}}
    </h1>
    <p>
      A private sanctuary for creators and their communities. Join us to start collaborating in a secure, decentralized environment.
    </p>
    <div class="button-container">
      <skerry-join-button></skerry-join-button>
    </div>
  </div>
</div>
`;

const DEFAULT_LANDING_CSS = `
.landing-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top right, rgba(88, 101, 242, 0.1), transparent), radial-gradient(circle at bottom left, rgba(235, 69, 158, 0.05), transparent);
  padding: 40px 20px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #fff;
}

.landing-page .card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  padding: 60px 40px;
  max-width: 540px;
  width: 100%;
  text-align: center;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.landing-page .server-badge {
  display: inline-block;
  padding: 8px 16px;
  background: rgba(88, 101, 242, 0.1);
  border: 1px solid rgba(88, 101, 242, 0.2);
  border-radius: 100px;
  color: #5865F2;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 32px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
}

.landing-page h1 {
  color: #fff;
  font-size: 48px;
  font-weight: 800;
  margin: 0 0 20px 0;
  line-height: 1.1;
  letter-spacing: -1.5px;
}

.landing-page p {
  color: rgba(255, 255, 255, 0.5);
  font-size: 18px;
  line-height: 1.6;
  margin: 0 0 48px 0;
  font-weight: 400;
}

.landing-page .button-container {
  display: flex;
  justify-content: center;
}
`;

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}

export function ChatClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlServerId = searchParams.get("server");
  const urlChannelId = searchParams.get("channel");
  const urlMessageId = searchParams.get("message");
  const suggestedUsername = searchParams.get("suggestedUsername");

  const { state, dispatch: originalDispatch } = useChat();
  const [previewWidth, setPreviewWidth] = useState<number>(600);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState<boolean>(false);
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const modal = document.querySelector(".modal-panel.wide-layout");
      if (modal) {
        const rect = modal.getBoundingClientRect();
        const newWidth = rect.right - e.clientX;
        // Clamp between 300 and 800
        setPreviewWidth(Math.max(300, Math.min(newWidth, 900)));
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "default";
      const resizer = document.querySelector(".creator-resizer") as HTMLElement;
      if (resizer) resizer.classList.remove("active");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);
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
    blockedUserIds
  } = state;

  useNotificationBadge();

  const { showToast } = useToast();
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

  const [iconFile, setIconFile] = useState<File | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [mentions, setMentions] = useState<MentionMarker[]>([]);

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
  const [roomType, setRoomType] = useState<ChannelType>("text");
  const [selectedHubIdForCreate, setSelectedHubIdForCreate] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("New Category");
  const [spaceSettingsTab, setSpaceSettingsTab] = useState<"general" | "permissions">("general");
  const [roomSettingsTab, setRoomSettingsTab] = useState<"general" | "permissions" | "preview">("general");

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

    setUrlSelection(nextServerId, nextChannelId, urlMessageId);
    lastSyncedUrlRef.current = `${nextServerId}:${nextChannelId}:${urlMessageId}`;

    if (!nextChannelId) {
      dispatch({ type: "SET_MESSAGES", payload: [] });
      return;
    }

    if (shouldFetchMessages) {
      let messageItems: ChatMessage[];
      if (urlMessageId) {
        messageItems = await listMessagesAround(nextChannelId, urlMessageId);
        if (messageItems.length === 0) {
          // Fallback if message not found (e.g. invalid deep link or deleted)
          messageItems = await listMessages(nextChannelId, null);
          dispatch({ type: "SET_HIGHLIGHTED_MESSAGE_ID", payload: null });
          // Clear the invalid message param from URL
          setUrlSelection(nextServerId, nextChannelId, null);
          lastSyncedUrlRef.current = `${nextServerId}:${nextChannelId}:null`;
        } else {
          dispatch({ type: "SET_HIGHLIGHTED_MESSAGE_ID", payload: urlMessageId });
        }
      } else {
        messageItems = await listMessages(nextChannelId, null);
        dispatch({ type: "SET_HIGHLIGHTED_MESSAGE_ID", payload: null });
      }

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
          // If we are jumping to a specific message, don't restore saved scroll position
          // as ChatWindow will handle scrolling to that message.
          if (urlMessageId) return;

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
  }, [setUrlSelection, urlChannelId, urlServerId, urlMessageId, dispatch, draftMessagesByChannel, channelScrollPositions, selectedServerId, selectedChannelId]);

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



  const initialize = useCallback(async (): Promise<void> => {
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await refreshAuthState();
      // Request notification permission
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

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
  }, [viewer, bootstrapStatus?.initialized, bootstrapStatus?.defaultServerId, bootstrapStatus?.defaultChannelId, refreshChatState, dispatch, showToast]);

  // Synchronize state with URL parameters when they change (e.g. from search or deep links)
  // We use a ref to prevent internal state refreshes from triggering redundant URL-driven refreshes
  const lastSyncedUrlRef = useRef<string>("");

  useEffect(() => {
    if (!bootstrapStatus?.initialized) return;

    const currentUrlSelection = `${urlServerId}:${urlChannelId}:${urlMessageId}`;
    if (currentUrlSelection === lastSyncedUrlRef.current) {
      return;
    }

    // If URL params don't match current selection, or there's a message ID to jump to, sync them
    const needsSync = (urlServerId && urlServerId !== selectedServerId) ||
      (urlChannelId && urlChannelId !== selectedChannelId) ||
      (urlMessageId && messages.every(m => m.id !== urlMessageId));

    if (needsSync) {
      console.log("[ChatClient] URL Sync triggered:", { urlServerId, urlChannelId, urlMessageId });
      lastSyncedUrlRef.current = currentUrlSelection;
      void refreshChatState(urlServerId ?? undefined, urlChannelId ?? undefined);
    }
  }, [urlServerId, urlChannelId, urlMessageId, bootstrapStatus?.initialized, refreshChatState, selectedServerId, selectedChannelId, messages]);

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
    dispatch({ type: "SET_RENAME_ROOM", payload: { id: selected?.id ?? "", name: (selected?.name ?? "").replace(/^#/, ""), type: selected?.type ?? "text", categoryId: selected?.categoryId ?? null, topic: selected?.topic ?? "", styleContent: selected?.styleContent ?? "" } });
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

  const hubId = activeServer?.hubId;
  useEffect(() => {
    if (!canAccessWorkspace || !hubId) {
      dispatch({ type: "SET_REALTIME_STATE", payload: "disconnected" });
      return;
    }

    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollInterval || !selectedChannelId) {
        return;
      }

      dispatch({ type: "SET_REALTIME_STATE", payload: "polling" });
      const channelToPoll = selectedChannelId;
      if (!channelToPoll) return;

      pollInterval = setInterval(() => {
        void listMessages(channelToPoll, null)
          .then((next: MessageItem[]) => {
            dispatch({
              type: "UPDATE_MESSAGES",
              payload: (current: MessageItem[]) => {
                const map = new Map<string, MessageItem>();
                current.forEach((m: MessageItem) => {
                  if (m.clientState === "sending" || m.clientState === "failed") {
                    map.set(m.id, m);
                  }
                });
                next.forEach((m: MessageItem) => map.set(m.id, m));

                return Array.from(map.values()).sort((a, b) =>
                  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );
              }
            });
          })
          .catch(() => {});
      }, 3000);
    };

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    if (selectedChannelId) startPolling();

    const source = connectHubStream(hubId);

    source.onopen = () => {
      if (closed) return;
      stopPolling();
      dispatch({ type: "SET_REALTIME_STATE", payload: "live" });
    };

    source.onerror = () => {
      if (closed) return;
      startPolling();
    };

    source.addEventListener("message.created", (event: any) => {
      const message = JSON.parse(event.data) as ChatMessage;

      if (message.channelId === selectedChannelId) {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            if (current.some((item: MessageItem) => item.id === message.id)) {
              return current;
            }
            if (message.parentId) {
              return current.map(item => {
                if (item.id === message.parentId) {
                  return { ...item, repliesCount: (item.repliesCount || 0) + 1 };
                }
                return item;
              });
            }
            return [...current, message];
          }
        });
        if (state.isNearBottom && !message.parentId) {
          void markChannelAsRead(message.channelId);
        }
      } else {
        void fetchNotificationSummary().then(summary => dispatch({ type: "SET_NOTIFICATIONS", payload: summary }));
      }

      if (typeof window !== "undefined" && document.hidden && Notification.permission === "granted" && message.authorUserId !== viewer?.productUserId) {
        const channel = channels.find(c => c.id === message.channelId);
        new Notification(`${message.authorDisplayName} in ${channel ? getChannelName(channel) : 'Channel'}`, {
          body: message.content,
          icon: "/favicon.ico"
        });
      }
    });

    source.addEventListener("message.updated", (event: any) => {
      const updatedMessage = JSON.parse(event.data) as ChatMessage;
      if (updatedMessage.channelId === selectedChannelId) {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            return current.map((item: MessageItem) => (item.id === updatedMessage.id ? updatedMessage : item));
          }
        });
      }
    });

    source.addEventListener("message.deleted", (event: any) => {
      const { id, channelId } = JSON.parse(event.data) as { id: string; channelId: string };
      if (channelId === selectedChannelId) {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => current.filter((m) => m.id !== id)
        });
      }
    });

    source.addEventListener("typing.start", (event: any) => {
      const data = JSON.parse(event.data);
      dispatch({ type: "SET_TYPING_USER", payload: { ...data, isTyping: true } });
    });

    source.addEventListener("typing.stop", (event: any) => {
      const data = JSON.parse(event.data);
      dispatch({ type: "SET_TYPING_USER", payload: { ...data, isTyping: false } });
    });

    return () => {
      closed = true;
      source.close();
      stopPolling();
    };
  }, [canAccessWorkspace, hubId, selectedChannelId, dispatch, markChannelAsRead, state.isNearBottom, viewer?.productUserId, channels]);


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

  async function handleServerChange(serverId: string, channelId?: string): Promise<void> {
    const targetServer = servers.find(s => s.id === serverId);
    const currentChannel = channels.find(c => c.id === selectedChannelId);

    // If channelId is explicitly provided (e.g. from state restoration or direct link), use it.
    let targetChannelId = channelId;

    if (!targetChannelId) {
      // EXCEPTION: If we are clicking a DM space, OR if the current channel is a DM,
      // do not change the channel.
      const isTargetDm = targetServer?.type === 'dm';
      const isCurrentDm = currentChannel?.type === 'dm';

      if (isTargetDm || isCurrentDm) {
        // Keep current channel if possible, or don't set one yet if switching TO DM list
        targetChannelId = selectedChannelId ?? undefined;
      } else {
        // Standard Space switch: try to find last viewed channel for this server
        targetChannelId = state.lastChannelByServer[serverId];
      }
    }

    dispatch({ type: "SET_SELECTED_SERVER_ID", payload: serverId });
    localStorage.setItem("lastServerId", serverId);

    // Only update lastChannelId in localStorage if we actually have a target channel
    if (targetChannelId) {
      localStorage.setItem("lastChannelId", targetChannelId);
    }

    dispatch({ type: "SET_CHANNELS", payload: [] });
    dispatch({ type: "SET_CATEGORIES", payload: [] });
    dispatch({ type: "SET_ERROR", payload: null });

    try {
      await refreshChatState(serverId, targetChannelId);
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

    // Save as last viewed channel for this server, unless it's a DM
    if (selectedServerId && channel?.type !== 'dm') {
      dispatch({ type: "SET_LAST_CHANNEL_BY_SERVER", payload: { serverId: selectedServerId, channelId } });
    }

    // Load new draft
    setDraftMessage(draftMessagesByChannel[channelId] ?? "");

    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const next = await listMessages(channelId, null);
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

    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
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
      let topic: string | undefined;
      let styleContent: string | undefined;
      if (roomType === "landing") {
        const server = servers.find(s => s.id === selectedServerId);
        topic = DEFAULT_LANDING_HTML.replace("{{SERVER_NAME}}", server?.name || "This Space");
        styleContent = DEFAULT_LANDING_CSS;
      }

      const created = await createChannel({
        serverId: selectedServerId,
        name: roomName.trim(),
        type: roomType,
        categoryId: selectedCategoryIdForCreate || undefined,
        topic,
        iconUrl: "", // Default to empty for now
        styleContent
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
      let iconUrl = renameSpaceIconUrl;

      if (iconFile) {
        const upload = await uploadMedia(renameSpaceId, iconFile);
        iconUrl = upload.url;
      }

      await updateServerSettings(renameSpaceId, {
        name: renameSpaceName.trim(),
        iconUrl
      } as any);
      // Also call renameServer if it handles something Matrix-side that updateServerSettings doesn't
      // if renameServer is purely for the name, it's fine.
      await renameServer({
        serverId: renameSpaceId,
        name: renameSpaceName.trim()
      });

      dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: "", iconUrl: null } });
      setIconFile(null);
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
        categoryId: renameRoomCategoryId,
        topic: renameRoomTopic,
        iconUrl: renameRoomIconUrl,
        styleContent: renameRoomStyleContent
      });
      showToast("Room updated successfully", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      
      const isMasquerade = !!sessionStorage.getItem("masquerade_token");
      if (isMasquerade) {
        return;
      }
      
      await refreshChatState(selectedServerId, renameRoomId);
    } catch (cause) {
      console.error("Failed to update room:", cause);
      showToast(cause instanceof Error ? cause.message : "Failed to update room.", "error");
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
    
    // Mock for Masquerade
    const isMasquerade = !!sessionStorage.getItem("masquerade_token");
    
    try {
      let persisted: ChatMessage;
      if (isMasquerade) {
        // Mock success for masquerade
        await new Promise(resolve => setTimeout(resolve, 500));
        persisted = {
          id: `mock_${Date.now()}`,
          authorUserId: optimisticMessage.authorUserId,
          authorDisplayName: optimisticMessage.authorDisplayName,
          content: optimisticMessage.content,
          attachments: optimisticMessage.attachments,
          createdAt: optimisticMessage.createdAt,
          channelId: optimisticMessage.channelId
        };
      } else {
        persisted = await sendMessage(selectedChannelId, content.trim(), attachments);
      }
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
    let finalContent = content;
    if (state.quotingMessage) {
      const author = state.quotingMessage.externalAuthorName || state.quotingMessage.authorDisplayName;
      finalContent = `> @${author}: ${state.quotingMessage.content}\n\n${content}`;
      dispatch({ type: "SET_QUOTING_MESSAGE", payload: null });
    }

    setDraftMessage("");
    messageInputRef.current?.focus();
    await sendContentWithOptimistic(finalContent, attachments);
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
          <button
            type="button"
            className="icon-button"
            title="Search Messages"
            onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: "search" })}
          >
            🔍
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

      {
        activeModal && (
          <div className="modal-backdrop" style={{ display: 'flex' }} onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}>
            <div 
              className={cn("modal-panel", ((activeModal === "rename-room" && renameRoomType === "landing") || (activeModal === "create-room" && roomType === "landing")) && "wide-layout")} 
              onClick={(e) => e.stopPropagation()}
            >
              <header className="modal-header" style={(activeModal === "rename-room" && renameRoomType === "landing") ? { padding: '1.5rem 1.5rem 0.75rem' } : {}}>
                <h2>
                  {activeModal === "create-space" && "Create New Space"}
                  {activeModal === "create-category" && "Create New Category"}
                  {activeModal === "create-room" && "Create New Room"}
                  {activeModal === "rename-space" && "Space Settings"}
                  {activeModal === "rename-category" && "Rename Category"}
                  {activeModal === "rename-room" && "Edit Room"}
                </h2>
                <button 
                  type="button" 
                  className="ghost" 
                  onClick={() => dispatch({ type: "SET_ACTIVE_MODAL", payload: null })}
                  style={{ borderRadius: '50%', padding: '0.5rem', width: '32px', height: '32px', minWidth: '32px' }}
                >
                  &times;
                </button>
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
                <div className="stack">
                  <div className="tabs">
                    <button 
                      className={cn("tab-button", spaceSettingsTab === "general" && "active")}
                      onClick={() => setSpaceSettingsTab("general")}
                    >
                      General
                    </button>
                    <button 
                      className={cn("tab-button", spaceSettingsTab === "permissions" && "active")}
                      onClick={() => setSpaceSettingsTab("permissions")}
                    >
                      Permissions
                    </button>
                  </div>

                  {spaceSettingsTab === "general" ? (
                    <form className="constrained-stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
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

                      <div className="form-section">
                        <label>Space Icon</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                          <div className="server-icon-placeholder" style={{ width: '64px', height: '64px', fontSize: '1.5rem' }}>
                            {iconFile ? (
                              <img src={URL.createObjectURL(iconFile)} alt="" className="server-icon-image" />
                            ) : renameSpaceIconUrl ? (
                              <img src={renameSpaceIconUrl} alt="" className="server-icon-image" />
                            ) : (
                              renameSpaceName.charAt(0).toUpperCase() || '?'
                            )}
                          </div>
                          <div className="constrained-stack" style={{ gap: '0.4rem' }}>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => iconInputRef.current?.click()}
                            >
                              {renameSpaceIconUrl || iconFile ? 'Change Icon' : 'Upload Icon'}
                            </button>
                            {(renameSpaceIconUrl || iconFile) && (
                              <button
                                type="button"
                                className="ghost"
                                style={{ color: 'var(--danger)' }}
                                onClick={() => {
                                  setIconFile(null);
                                  dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: renameSpaceName, iconUrl: null } });
                                }}
                              >
                                Remove Icon
                              </button>
                            )}
                          </div>
                          <input
                            type="file"
                            ref={iconInputRef}
                            style={{ display: 'none' }}
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) setIconFile(file);
                            }}
                          />
                        </div>
                      </div>
                      <button type="submit" disabled={mutatingStructure}>Save Changes</button>
                    </form>
                  ) : (
                    <PermissionsEditor 
                      serverId={renameSpaceId}
                      initialAccess={{
                        hubAdminAccess: activeServer?.hubAdminAccess ?? 'chat',
                        spaceMemberAccess: activeServer?.spaceMemberAccess ?? 'chat',
                        hubMemberAccess: activeServer?.hubMemberAccess ?? 'chat',
                        visitorAccess: activeServer?.visitorAccess ?? 'hidden',
                        joinPolicy: activeServer?.joinPolicy
                      }}
                      onSaveDefaults={async (access) => {
                        await updateServerSettings(renameSpaceId, access);
                        showToast("Permissions updated", "success");
                        void refreshChatState();
                      }}
                    />
                  )}
                </div>
              )}

              {activeModal === "create-category" && (
                <form className="constrained-stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
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
                <div className="constrained-stack">
                  <form className="constrained-stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
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

                  <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
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

                  <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                    <p>Danger Zone</p>
                    <button
                      type="button"
                      className="danger"
                      disabled={mutatingStructure}
                      onClick={() => {
                        const isMasquerade = !!sessionStorage.getItem("masquerade_token");
                        if (isMasquerade) {
                            showToast("Masquerade: Category deletion blocked.", "error");
                            return;
                        }

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
                <form className="constrained-stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
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
                      <option value="forum">Forum Room</option>
                      <option value="voice">Voice Room</option>
                      <option value="landing">Landing Page</option>
                    </select>
                  <button type="submit" disabled={creatingRoom}>Create Room</button>
                </form>
              )}

              {activeModal === "rename-room" && (
                <div className={cn("stack", renameRoomType === "landing" && "creator-layout")} style={renameRoomType === "landing" ? { height: 'calc(100vh - 200px)', minHeight: '600px' } : {}}>
                  {renameRoomType === "landing" ? (
                    <div style={{ display: 'flex', gap: '2rem', height: '100%', overflow: 'hidden' }}>
                      {/* Left Side: Editor */}
                      <div className="stack scroll-container scrollable-pane" style={{ flex: '1', minWidth: '350px', overflowY: 'auto' }}>
                        <div className="stack" style={{ gap: '1.5rem', padding: '1.5rem' }}>
                          <form className="stack" onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                            void handleRenameRoom(event);
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <p style={{ margin: 0 }}>Editing Landing Page: <strong>{channels.find(c => c.id === renameRoomId)?.name}</strong></p>
                              <button 
                                type="button" 
                                className="ghost"
                                onClick={() => setIsPreviewCollapsed(!isPreviewCollapsed)}
                                style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                              >
                                {isPreviewCollapsed ? "Show Preview" : "Hide Preview"}
                              </button>
                            </div>
                            <div className="stack" style={{ gap: '1rem', background: 'var(--surface-alt)', padding: '1rem', borderRadius: '12px' }}>
                              <label htmlFor="rename-room-modal">Room Name</label>
                              <input
                                id="rename-room-modal"
                                value={renameRoomName}
                                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: e.target.value, type: renameRoomType, categoryId: renameRoomCategoryId, topic: renameRoomTopic, iconUrl: renameRoomIconUrl, styleContent: renameRoomStyleContent } })}
                                minLength={2}
                                maxLength={80}
                                required
                              />

                              <label htmlFor="rename-room-icon">Room Icon (Emoji or URL)</label>
                              <input
                                id="rename-room-icon"
                                value={renameRoomIconUrl || ""}
                                placeholder="e.g. 💬 or https://..."
                                onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: renameRoomCategoryId, topic: renameRoomTopic, iconUrl: e.target.value, styleContent: renameRoomStyleContent } })}
                              />

                              <label htmlFor="rename-room-template">Start from Template</label>
                              <select 
                                id="rename-room-template" 
                                value="" 
                                onChange={(e) => {
                                  const template = LANDING_PAGE_TEMPLATES.find(t => t.id === e.target.value);
                                  if (template && confirm(`Are you sure? This will overwrite your current content and style for "${template.name}".`)) {
                                    dispatch({ 
                                      type: "SET_RENAME_ROOM", 
                                      payload: { 
                                        id: renameRoomId, 
                                        name: renameRoomName, 
                                        type: renameRoomType, 
                                        categoryId: renameRoomCategoryId, 
                                        topic: template.html, 
                                        iconUrl: renameRoomIconUrl,
                                        styleContent: template.css 
                                      } 
                                    });
                                  }
                                }}
                              >
                                <option value="" disabled>Select a template...</option>
                                {LANDING_PAGE_TEMPLATES.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="creator-guide" style={{ marginBottom: '1.5rem' }}>
                              <button 
                                type="button" 
                                className="ghost guide-toggle" 
                                onClick={() => setIsGuideOpen(!isGuideOpen)}
                                style={{ width: '100%', justifyContent: 'space-between', padding: '0.6rem 1rem', borderRadius: isGuideOpen ? '12px 12px 0 0' : '12px' }}
                              >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '1.1rem' }}>📖</span> 
                                  <strong>Style & Variable Guide</strong>
                                </span>
                                <span>{isGuideOpen ? '▼' : '▶'}</span>
                              </button>
                              
                              {isGuideOpen && (
                                <div className="guide-content stack" style={{ gap: '1rem', padding: '1.25rem', background: 'var(--surface-alt)', borderRadius: '0 0 12px 12px', border: '1px solid var(--border)', borderTop: 'none', fontSize: '0.85rem' }}>
                                  <div className="stack" style={{ gap: '0.6rem' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent)' }}>Interpolation Tokens</h4>
                                    <p style={{ margin: 0, opacity: 0.8 }}>Use these in your HTML to display dynamic content:</p>
                                    <div className="guide-grid">
                                      <code>{"{{hubName}}"}</code> <span>Site/Hub name</span>
                                      <code>{"{{serverName}}"}</code> <span>Room/Space name</span>
                                      <code>{"{{viewerName}}"}</code> <span>Visitor name</span>
                                      <code>{"{{memberCount}}"}</code> <span>Total members</span>
                                    </div>
                                  </div>

                                  <div className="stack" style={{ gap: '0.6rem' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent)' }}>Design Tokens (CSS)</h4>
                                    <p style={{ margin: 0, opacity: 0.8 }}>Use these for theme-aware styling:</p>
                                    <div className="guide-grid">
                                      <code>var(--sk-accent)</code> <span>Primary accent</span>
                                      <code>var(--sk-text)</code> <span>Primary text</span>
                                      <code>var(--sk-bg)</code> <span>App background</span>
                                      <code>var(--sk-surface)</code> <span>Surface layer</span>
                                    </div>
                                  </div>

                                  <div className="stack" style={{ gap: '0.6rem' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent)' }}>Custom Components</h4>
                                    <div className="guide-grid">
                                      <code>&lt;skerry-join-button&gt;</code> <span>Interactive join button</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <label>Landing Page HTML</label>
                            <CodeEditor 
                              value={renameRoomTopic} 
                              onChange={(val) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: renameRoomCategoryId, topic: val, iconUrl: renameRoomIconUrl, styleContent: renameRoomStyleContent } })} 
                              language="html"
                              placeholder="<h1>Welcome</h1>"
                              onUploadImage={async () => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                return new Promise((resolve) => {
                                  input.onchange = async () => {
                                    if (input.files?.[0]) {
                                      const upload = await uploadMedia(selectedServerId!, input.files[0]);
                                      resolve(upload.url);
                                    } else {
                                      resolve(null);
                                    }
                                  };
                                  input.click();
                                });
                              }}
                            />

                            <label>Landing Page CSS (Optional)</label>
                            <CodeEditor 
                              value={renameRoomStyleContent || ""} 
                              onChange={(val) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: renameRoomCategoryId, topic: renameRoomTopic, iconUrl: renameRoomIconUrl, styleContent: val } })} 
                              language="css"
                              placeholder=".landing-page { color: gold; }"
                            />

                            <label htmlFor="rename-room-type">Room Type</label>
                            <select
                              id="rename-room-type"
                              value={renameRoomType}
                              onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: e.target.value as any, categoryId: renameRoomCategoryId, topic: renameRoomTopic, iconUrl: renameRoomIconUrl, styleContent: renameRoomStyleContent } })}
                            >
                              <option value="text">Text Room</option>
                              <option value="announcement">Announcement Room</option>
                              <option value="forum">Forum Room</option>
                              <option value="voice">Voice Room</option>
                              <option value="landing">Landing Page</option>
                            </select>

                            <button type="submit" disabled={mutatingStructure} style={{ padding: '1rem', fontSize: '1.1rem' }}>Save Changes</button>
                          </form>

                          <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                            <p>Room Organization</p>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button
                                type="button"
                                disabled={mutatingStructure}
                                onClick={() => moveChannelPosition(renameRoomId, "up")}
                              >
                                Move Up
                              </button>
                              <button
                                type="button"
                                disabled={mutatingStructure}
                                onClick={() => moveChannelPosition(renameRoomId, "down")}
                              >
                                Move Down
                              </button>
                            </div>
                          </div>

                          <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                            <p>Danger Zone</p>
                            <button
                              type="button"
                              className="danger"
                              disabled={mutatingStructure}
                              onClick={() => {
                                if (confirm(`Are you sure you want to delete the room "${renameRoomName}"? All messages and content will be lost.`)) {
                                  void performDeleteRoom(selectedServerId!, renameRoomId);
                                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                                }
                              }}
                            >
                              Delete Room
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Resizer Handle */}
                      {!isPreviewCollapsed && (
                        <div 
                          className="creator-resizer" 
                          onMouseDown={(e) => {
                            e.preventDefault();
                            isResizingRef.current = true;
                            document.body.style.cursor = "col-resize";
                            (e.currentTarget as HTMLElement).classList.add("active");
                          }}
                        />
                      )}

                      {/* Right Side: Live Preview */}
                      <div 
                        className="live-preview-pane" 
                        style={{ 
                          width: isPreviewCollapsed ? '0px' : `${previewWidth}px`,
                          flex: isPreviewCollapsed ? 'none' : 'none',
                          minWidth: isPreviewCollapsed ? '0px' : '300px',
                          borderLeft: isPreviewCollapsed ? 'none' : '1px solid var(--border)'
                        }}
                      >
                        <div className="preview-header" style={{ padding: '0.75rem 1rem', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Live Preview</span>
                          <button 
                            className="ghost" 
                            type="button"
                            onClick={() => setIsPreviewCollapsed(true)}
                            style={{ fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="preview-content preview-theme-root">
                          <ThemeEngine key={`theme-engine-${selectedServerId}`} scopeSelector=".preview-theme-root" />
                          <LandingPageView 
                            key={`preview-${renameRoomTopic.length}-${renameRoomStyleContent?.length}`}
                            topic={renameRoomTopic} 
                            styleContent={renameRoomStyleContent} 
                            serverId={selectedServerId!} 
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="tabs">
                        <button 
                          className={cn("tab-button", roomSettingsTab === "general" && "active")}
                          onClick={() => setRoomSettingsTab("general")}
                        >
                          General
                        </button>
                        <button 
                          className={cn("tab-button", roomSettingsTab === "permissions" && "active")}
                          onClick={() => setRoomSettingsTab("permissions")}
                        >
                          Permissions
                        </button>
                      </div>

                      {roomSettingsTab === "general" && (
                        <div className="constrained-stack">
                          <form className="constrained-stack" style={{ width: '100%' }} onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
                            void handleRenameRoom(event);
                          }}>
                            <p>Editing Room: <strong>{channels.find(c => c.id === renameRoomId)?.name}</strong></p>
                            <label htmlFor="rename-room-modal">Room Name</label>
                            <input
                              id="rename-room-modal"
                              autoFocus
                              value={renameRoomName}
                              onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: e.target.value, type: renameRoomType, categoryId: renameRoomCategoryId, topic: renameRoomTopic, styleContent: renameRoomStyleContent } })}
                              minLength={2}
                              maxLength={80}
                              required
                            />

                            <label htmlFor="rename-room-topic">Room Topic</label>
                            <input
                              id="rename-room-topic"
                              value={renameRoomTopic}
                              onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: renameRoomCategoryId, topic: e.target.value, styleContent: renameRoomStyleContent } })}
                              maxLength={255}
                              placeholder="Set a topic for this room..."
                            />

                            <label htmlFor="rename-room-type">Type</label>
                            <select
                              id="rename-room-type"
                              value={renameRoomType}
                              onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: e.target.value as any, categoryId: renameRoomCategoryId, topic: renameRoomTopic, styleContent: renameRoomStyleContent } })}
                            >
                              <option value="text">Text Room</option>
                              <option value="announcement">Announcement Room</option>
                              <option value="forum">Forum Room</option>
                              <option value="voice">Voice Room</option>
                              <option value="landing">Landing Page</option>
                            </select>

                            <label htmlFor="rename-room-category">Category</label>
                            <select
                              id="rename-room-category"
                              value={renameRoomCategoryId || ""}
                              onChange={(e) => dispatch({ type: "SET_RENAME_ROOM", payload: { id: renameRoomId, name: renameRoomName, type: renameRoomType, categoryId: e.target.value || null, topic: renameRoomTopic, styleContent: renameRoomStyleContent } })}
                            >
                              <option value="">No Category</option>
                              {categories
                                .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                                .map((cat) => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>

                            <button type="submit" disabled={mutatingStructure}>Save Changes</button>
                          </form>

                          <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", width: '100%' }}>
                            <p>Reorder Room</p>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button
                                type="button"
                                disabled={mutatingStructure}
                                onClick={() => moveChannelPosition(renameRoomId, "up")}
                              >
                                Move Up
                              </button>
                              <button
                                type="button"
                                disabled={mutatingStructure}
                                onClick={() => moveChannelPosition(renameRoomId, "down")}
                              >
                                Move Down
                              </button>
                            </div>
                          </div>

                          <div className="constrained-stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", width: '100%' }}>
                            <p>Danger Zone</p>
                            <button
                              type="button"
                              className="danger"
                              disabled={mutatingStructure}
                              onClick={() => {
                                if (confirm(`Are you sure you want to delete the room "${renameRoomName}"? All messages and content will be lost.`)) {
                                  void performDeleteRoom(selectedServerId!, renameRoomId);
                                  dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
                                }
                              }}
                            >
                              Delete Room
                            </button>
                          </div>
                        </div>
                      )}

                      {roomSettingsTab === "permissions" && (
                        <PermissionsEditor 
                          serverId={activeChannel?.serverId ?? renameSpaceId}
                          channelId={renameRoomId}
                          initialAccess={{
                            hubAdminAccess: activeChannel?.hubAdminAccess ?? 'chat',
                            spaceMemberAccess: activeChannel?.spaceMemberAccess ?? 'chat',
                            hubMemberAccess: activeChannel?.hubMemberAccess ?? 'chat',
                            visitorAccess: activeChannel?.visitorAccess ?? 'hidden'
                          }}
                          onSaveDefaults={async (access) => {
                            await updateChannelSettings(renameRoomId, {
                              serverId: activeChannel?.serverId ?? selectedServerId ?? "",
                              ...access
                            });
                            showToast("Permissions updated", "success");
                            void refreshChatState();
                          }}
                        />
                      )}
                    </>
                  )}
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


      {/* Invite Modal */}
      {isInviting && (
        <div className="modal-backdrop" onClick={() => setIsInviting(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
            <header className="modal-header">
              <h2>Invite to DM</h2>
              <button type="button" className="ghost" onClick={() => setIsInviting(false)}>×</button>
            </header>
            <div className="stack" style={{ padding: "1rem" }}>
              <input
                type="text"
                placeholder="Search by username..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                autoFocus
                style={{ width: "100%" }}
              />
              <div className="search-results scroller" style={{ maxHeight: "300px", marginTop: "1rem", border: "1px solid var(--border)", borderRadius: "4px" }}>
                {userSearchResults.length > 0 ? (
                  userSearchResults.map((user) => (
                    <div key={user.productUserId} style={{ padding: "0.75rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{user.preferredUsername}</span>
                      <button
                        className="ghost"
                        onClick={async () => {
                          try {
                            if (!selectedChannelId) return;
                            await inviteToChannel(selectedChannelId, user.productUserId);
                            showToast(`Invited ${user.preferredUsername}`, "success");
                            setIsInviting(false);
                            // The member list should update via the real-time stream or next poll.
                          } catch (err) {
                            showToast("Invite failed", "error");
                          }
                        }}
                      >
                        Invite
                      </button>
                    </div>
                  ))
                ) : (
                  <p style={{ padding: "1rem", textAlign: "center", opacity: 0.6 }}>No users found</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hub Invite Modal */}
      {isCreatingHubInvite && (
        <div className="modal-backdrop" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
            <header className="modal-header">
              <h2>Invite to {activeServer?.name}</h2>
              <button type="button" className="ghost" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>×</button>
            </header>
            <div className="stack" style={{ padding: "1.5rem", textAlign: "center" }}>
              {!lastInviteUrl ? (
                <>
                  <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1.5rem" }}>
                    This will create a link that anyone can use to join this hub.
                  </p>
                  <button
                    className="primary"
                    onClick={async () => {
                      try {
                        const hubId = activeServer?.id;
                        if (!hubId) return;
                        const invite = await createHubInvite(hubId);
                        const url = `${window.location.origin}/invite/${invite.id}`;
                        setLastInviteUrl(url);
                      } catch (e) {
                        showToast("Failed to create invite", "error");
                      }
                    }}
                    style={{ width: "100%" }}
                  >
                    Generate Invite Link
                  </button>
                </>
              ) : (
                <div className="stack" style={{ gap: "1rem" }}>
                  <div style={{ background: "var(--surface-alt)", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="text"
                      readOnly
                      value={lastInviteUrl}
                      style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: "0.9rem" }}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(lastInviteUrl);
                        showToast("Copied to clipboard", "success");
                      }}
                      className="primary"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                    >
                      Copy
                    </button>
                  </div>
                  <p style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                    Share this link with your friends!
                  </p>
                  <button className="ghost" onClick={() => { setIsCreatingHubInvite(false); setLastInviteUrl(null); }}>Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </main >
  );
}
