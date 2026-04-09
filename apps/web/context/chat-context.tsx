"use client";

import React, { createContext, useContext, useReducer, ReactNode } from "react";
import type {
    Category,
    Channel,
    ChannelType,
    ChatMessage,
    MentionMarker,
    ModerationAction,
    ModerationReport,
    Server,
    VoicePresenceMember,
    VoiceTokenGrant,
    Hub,
    DiscordBridgeChannelMapping,
    DiscordBridgeConnection
} from "@skerry/shared";
import type {
    AuthProvidersResponse,
    BootstrapStatus,
    ViewerRoleBinding,
    PrivilegedAction,
    ViewerSession
} from "../lib/control-plane";

export interface ChatHandlers {
    handleServerChange: (serverId: string, channelId?: string) => Promise<void>;
    handleChannelChange: (channelId: string) => Promise<void>;
    refreshChatState: (serverId: string, preferredChannelId?: string) => Promise<void>;
}

export interface MessageItem extends ChatMessage {
    clientState?: "sending" | "failed";
    replyToId?: string;
    countedReplyIds?: string[];
}

export interface ChatMember {
    productUserId: string;
    displayName: string;
    avatarUrl?: string;
    isOnline: boolean;
    lastSeenAt?: string;
    isBridged?: boolean;
    bridgedUserStatus?: string;
}

export type ModalType =
    | "create-space"
    | "create-category"
    | "create-room"
    | "rename-space"
    | "rename-category"
    | "rename-room"
    | "profile"
    | "dm-picker"
    | "search"
    | "moderation"
    | "grant-role"
    | "masquerade"
    | "confirmation"
    | null;

export interface ConfirmationContext {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    requiresReason?: boolean;
    reasonPlaceholder?: string;
    onConfirm: (reason?: string) => void;
    onCancel?: () => void;
}

export interface ChatState {
    viewer: ViewerSession | null;
    providers: AuthProvidersResponse | null;
    bootstrapStatus: BootstrapStatus | null;
    servers: Server[];
    channels: Channel[];
    categories: Category[];
    messages: MessageItem[];
    hubs: Hub[];
    viewerRoles: ViewerRoleBinding[];
    selectedServerId: string | null;
    selectedChannelId: string | null;
    loading: boolean;
    error: string | null;
    realtimeState: "disconnected" | "polling" | "live";
    allowedActions: PrivilegedAction[];
    activeModal: ModalType;
    isDetailsOpen: boolean;
    isSidebarOpen: boolean;
    isAddMenuOpen: boolean;
    theme: "light" | "dark";
    activeChannelData: Channel | null;
    discordMappings: DiscordBridgeChannelMapping[];
    discordConnection: DiscordBridgeConnection | null;
    // UI states that might be useful globally
    lastReadByChannel: Record<string, string>;
    mentionCountByChannel: Record<string, number>;
    unreadCountByChannel: Record<string, number>;
    muteStatusByChannel: Record<string, boolean>;
    notificationPreferenceByChannel: Record<string, 'all' | 'mentions' | 'none'>;
    channelFilter: string;
    // Rename/Delete states
    renameSpaceId: string;
    renameSpaceName: string;
    renameSpaceIconUrl: string | null;
    renameCategoryId: string;
    renameCategoryName: string;
    renameRoomId: string;
    renameRoomName: string;
    renameRoomType: ChannelType;
    renameRoomCategoryId: string | null;
    renameRoomTopic: string;
    renameRoomIconUrl: string | null;
    renameRoomStyleContent: string;
    selectedCategoryIdForCreate: string;
    isNearBottom: boolean;
    pendingNewMessageCount: number;
    lastSeenMessageId: string | null;
    // Voice States
    voiceConnected: boolean;
    voiceMuted: boolean;
    voiceDeafened: boolean;
    voiceVideoEnabled: boolean;
    voiceScreenShareEnabled: boolean;
    voiceVideoQuality: "low" | "medium" | "high";
    voiceGrant: VoiceTokenGrant | null;
    voiceMembers: VoicePresenceMember[];
    // Deletion confirmation states
    deleteTargetSpaceId: string;
    deleteSpaceConfirm: string;
    deleteRoomConfirm: string;
    // Transient Structural States
    mutatingStructure: boolean;
    bootstrapping: boolean;
    creatingSpace: boolean;
    creatingRoom: boolean;
    creatingCategory: boolean;
    savingOnboarding: boolean;
    sending: boolean;
    updatingControls: boolean;
    channelScrollPositions: Record<string, number>;
    draftMessagesByChannel: Record<string, string>;
    profileUserId: string | null;
    blockedUserIds: string[];
    members: ChatMember[];
    allDmChannels: Channel[];
    lastChannelByServer: Record<string, string>;
    threadParentId: string | null;
    quotingMessage: MessageItem | null;
    typingUsersByChannel: Record<string, Record<string, { displayName: string; timestamp: number }>>;
    searchQuery: string;
    searchResults: ChatMessage[];
    isSearching: boolean;
    highlightedMessageId: string | null;
    moderationTargetUserId: string | null;
    moderationTargetDisplayName: string | null;
    moderationTargetMessageId: string | null;
    confirmationContext: ConfirmationContext | null;
    pendingActionIds: Set<string>;
    roleContext: {
        targetUserId: string;
        targetDisplayName?: string;
        scope: "hub" | "space";
        serverId?: string;
    } | null;
    switchingServer: boolean;
}

type ChatAction =
    | { type: "SET_VIEWER"; payload: ViewerSession | null }
    | { type: "SET_PROVIDERS"; payload: AuthProvidersResponse | null }
    | { type: "SET_BOOTSTRAP_STATUS"; payload: BootstrapStatus | null }
    | { type: "SET_SERVERS"; payload: Server[] }
    | { type: "SET_CHANNELS"; payload: Channel[] }
    | { type: "SET_CATEGORIES"; payload: Category[] }
    | { type: "SET_MESSAGES"; payload: MessageItem[] }
    | { type: "SET_HUBS"; payload: Hub[] }
    | { type: "SET_VIEWER_ROLES"; payload: ViewerRoleBinding[] }
    | { type: "SET_SELECTED_SERVER_ID"; payload: string | null }
    | { type: "SET_SELECTED_CHANNEL_ID"; payload: string | null }
    | { type: "SET_LOADING"; payload: boolean }
    | { type: "SET_ERROR"; payload: string | null }
    | { type: "SET_REALTIME_STATE"; payload: "disconnected" | "polling" | "live" }
    | { type: "SET_ALLOWED_ACTIONS"; payload: PrivilegedAction[] }
    | { type: "SET_ACTIVE_MODAL"; payload: ModalType }
    | { type: "SET_DETAILS_OPEN"; payload: boolean }
    | { type: "SET_SIDEBAR_OPEN"; payload: boolean }
    | { type: "SET_ADD_MENU_OPEN"; payload: boolean }
    | { type: "SET_THEME"; payload: "light" | "dark" }
    | { type: "SET_ACTIVE_CHANNEL_DATA"; payload: Channel | null }
    | { type: "SET_DISCORD_MAPPINGS"; payload: DiscordBridgeChannelMapping[] }
    | { type: "SET_DISCORD_CONNECTION"; payload: DiscordBridgeConnection | null }
    | { type: "UPDATE_MESSAGES"; payload: (current: MessageItem[]) => MessageItem[] }
    | { type: "SET_LAST_READ"; payload: { channelId: string; lastSeenId: string } }
    | { type: "SET_MENTION_COUNTS"; payload: Record<string, number> }
    | { type: "SET_UNREAD_COUNTS"; payload: Record<string, number> }
    | { type: "SET_CHANNEL_FILTER"; payload: string }
    | { type: "SET_RENAME_SPACE"; payload: { id: string; name: string; iconUrl?: string | null } }
    | { type: "SET_RENAME_CATEGORY"; payload: { id: string; name: string } }
    | { type: "SET_RENAME_ROOM"; payload: { id: string; name: string; type: ChannelType; categoryId: string | null; topic?: string | null; iconUrl?: string | null; styleContent?: string | null } }
    | { type: "SET_SELECTED_CATEGORY_FOR_CREATE"; payload: string }
    | { type: "SET_NEAR_BOTTOM"; payload: boolean }
    | { type: "SET_PENDING_NEW_MESSAGE_COUNT"; payload: number }
    | { type: "SET_LAST_SEEN_MESSAGE_ID"; payload: string | null }
    | { type: "SET_VOICE_SESSION"; payload: { connected: boolean; grant: VoiceTokenGrant | null } }
    | { type: "SET_VOICE_CONNECTED"; payload: boolean }
    | { type: "SET_VOICE_MUTED"; payload: boolean }
    | { type: "SET_VOICE_DEAFENED"; payload: boolean }
    | { type: "SET_VOICE_VIDEO_ENABLED"; payload: boolean }
    | { type: "SET_VOICE_SCREEN_SHARE_ENABLED"; payload: boolean }
    | { type: "SET_VOICE_VIDEO_QUALITY"; payload: "low" | "medium" | "high" }
    | { type: "SET_VOICE_GRANT"; payload: VoiceTokenGrant | null }
    | { type: "SET_VOICE_MEMBERS"; payload: VoicePresenceMember[] }
    | { type: "SET_DELETE_TARGET_SPACE_ID"; payload: string }
    | { type: "SET_DELETE_SPACE_CONFIRM"; payload: string }
    | { type: "SET_DELETE_ROOM_CONFIRM"; payload: string }
    | { type: "SET_MUTATING_STRUCTURE"; payload: boolean }
    | { type: "SET_BOOTSTRAPPING"; payload: boolean }
    | { type: "SET_CREATING_SPACE"; payload: boolean }
    | { type: "SET_CREATING_ROOM"; payload: boolean }
    | { type: "SET_CREATING_CATEGORY"; payload: boolean }
    | { type: "SET_SAVING_ONBOARDING"; payload: boolean }
    | { type: "SET_SENDING"; payload: boolean }
    | { type: "SET_UPDATING_CONTROLS"; payload: boolean }
    | { type: "SET_NOTIFICATIONS"; payload: Record<string, { unreadCount: number; mentionCount: number; isMuted: boolean }> }
    | { type: "CLEAR_NOTIFICATIONS"; payload: { channelId: string } }
    | { type: "SET_CHANNEL_SCROLL_POSITION"; payload: { channelId: string; position: number } }
    | { type: "SET_CHANNEL_DRAFT"; payload: { channelId: string; draft: string } }
    | { type: "SET_PROFILE_USER_ID"; payload: string | null }
    | { type: "SET_BLOCKED_USER_IDS"; payload: string[] }
    | { type: "BLOCK_USER"; payload: string }
    | { type: "UNBLOCK_USER"; payload: string }
    | { type: "SET_MEMBERS"; payload: ChatMember[] }
    | { type: "SET_ALL_DM_CHANNELS", payload: Channel[] }
    | { type: "SET_LAST_CHANNEL_BY_SERVER", payload: { serverId: string; channelId: string } }
    | { type: "SET_THREAD_PARENT_ID", payload: string | null }
    | { type: "SET_QUOTING_MESSAGE", payload: MessageItem | null }
    | { type: "SET_TYPING_USER", payload: { channelId: string; userId: string; displayName: string; isTyping: boolean } }
    | { type: "PRUNE_TYPING_USERS" }
    | { type: "SET_SEARCH_QUERY", payload: string }
    | { type: "SET_SEARCH_RESULTS", payload: ChatMessage[] }
    | { type: "SET_IS_SEARCHING", payload: boolean }
    | { type: "SET_HIGHLIGHTED_MESSAGE_ID", payload: string | null }
    | { type: "SET_MODERATION_TARGET", payload: { userId: string | null; displayName: string | null; messageId?: string | null } }
    | { type: "SET_NOTIFICATION_PREFERENCE", payload: { channelId: string; preference: 'all' | 'mentions' | 'none'; isMuted?: boolean } }
    | { type: "SET_CONFIRMATION", payload: ConfirmationContext | null }
    | { type: "SET_PENDING_ACTION_ID", payload: { id: string; active: boolean } }
    | { type: "SET_ROLE_CONTEXT", payload: ChatState["roleContext"] }
    | { type: "SET_SWITCHING_SERVER", payload: boolean }
    | { 
        type: "SET_CHAT_INITIAL_DATA"; 
        payload: { 
            servers?: Server[]; 
            channels?: Channel[]; 
            categories?: Category[]; 
            viewerRoles?: ViewerRoleBinding[];
            selectedServerId?: string | null;
            selectedChannelId?: string | null;
            activeChannelData?: Channel | null;
            messages?: MessageItem[];
            members?: ChatMember[];
            permissions?: PrivilegedAction[];
            highlightedMessageId?: string | null;
            error?: string | null;
        } 
      };


const initialState: ChatState = {
    viewer: null,
    providers: null,
    bootstrapStatus: null,
    servers: [],
    channels: [],
    categories: [],
    messages: [],
    hubs: [],
    viewerRoles: [],
    selectedServerId: null,
    selectedChannelId: null,
    loading: true,
    error: null,
    realtimeState: "disconnected",
    allowedActions: [],
    activeModal: null,
    isDetailsOpen: true,
    isSidebarOpen: false,
    isAddMenuOpen: false,
    theme: "light",
    activeChannelData: null,
    discordMappings: [],
    discordConnection: null,
    lastReadByChannel: {},
    mentionCountByChannel: {},
    unreadCountByChannel: {},
    muteStatusByChannel: {},
    notificationPreferenceByChannel: {},
    channelFilter: "",
    renameSpaceId: "",
    renameSpaceName: "",
    renameSpaceIconUrl: null,
    renameCategoryId: "",
    renameCategoryName: "",
    renameRoomId: "",
    renameRoomName: "",
    renameRoomType: "text",
    renameRoomCategoryId: null,
    renameRoomTopic: "",
    renameRoomIconUrl: null,
    renameRoomStyleContent: "",
    selectedCategoryIdForCreate: "",
    isNearBottom: true,
    pendingNewMessageCount: 0,
    lastSeenMessageId: null,
    voiceConnected: false,
    voiceMuted: false,
    voiceDeafened: false,
    voiceVideoEnabled: false,
    voiceScreenShareEnabled: false,
    voiceVideoQuality: "medium",
    voiceGrant: null,
    voiceMembers: [],
    deleteTargetSpaceId: "",
    deleteSpaceConfirm: "",
    deleteRoomConfirm: "",
    mutatingStructure: false,
    bootstrapping: false,
    creatingSpace: false,
    creatingRoom: false,
    creatingCategory: false,
    savingOnboarding: false,
    sending: false,
    updatingControls: false,
    channelScrollPositions: {},
    draftMessagesByChannel: {},
    profileUserId: null,
    blockedUserIds: [],
    members: [],
    allDmChannels: [],
    lastChannelByServer: {},
    threadParentId: null,
    quotingMessage: null,
    typingUsersByChannel: {},
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    highlightedMessageId: null,
    moderationTargetUserId: null,
    moderationTargetDisplayName: null,
    moderationTargetMessageId: null,
    confirmationContext: null,
    pendingActionIds: new Set(),
    roleContext: null,
    switchingServer: false
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
    switch (action.type) {
        case "SET_VOICE_SESSION":
            return {
                ...state,
                voiceConnected: action.payload.connected,
                voiceGrant: action.payload.grant
            };
        case "SET_VIEWER":
            return { ...state, viewer: action.payload };
        case "SET_PROVIDERS":
            return { ...state, providers: action.payload };
        case "SET_BOOTSTRAP_STATUS":
            return { ...state, bootstrapStatus: action.payload };
        case "SET_SERVERS":
            return { ...state, servers: action.payload };
        case "SET_CHANNELS":
            return { ...state, channels: action.payload };
        case "SET_CATEGORIES":
            return { ...state, categories: action.payload };
        case "SET_MESSAGES":
            return { ...state, messages: action.payload };
        case "SET_HUBS":
            return { ...state, hubs: action.payload };
        case "SET_VIEWER_ROLES":
            return { ...state, viewerRoles: action.payload };
        case "SET_SELECTED_SERVER_ID":
            return { ...state, selectedServerId: action.payload };
        case "SET_SELECTED_CHANNEL_ID":
            return { ...state, selectedChannelId: action.payload };
        case "SET_LOADING":
            return { ...state, loading: action.payload };
        case "SET_ERROR":
            return { ...state, error: action.payload };
        case "SET_REALTIME_STATE":
            return { ...state, realtimeState: action.payload };
        case "SET_ALLOWED_ACTIONS":
            return { ...state, allowedActions: action.payload };
        case "SET_ACTIVE_MODAL":
            return { ...state, activeModal: action.payload };
        case "SET_DETAILS_OPEN":
            return { ...state, isDetailsOpen: action.payload };
        case "SET_SIDEBAR_OPEN":
            return { ...state, isSidebarOpen: action.payload };
        case "SET_ADD_MENU_OPEN":
            return { ...state, isAddMenuOpen: action.payload };
        case "SET_THEME":
            return { ...state, theme: action.payload };
        case "SET_ACTIVE_CHANNEL_DATA":
            return { ...state, activeChannelData: action.payload };
        case "SET_DISCORD_MAPPINGS":
            return { ...state, discordMappings: action.payload };
        case "SET_DISCORD_CONNECTION":
            return { ...state, discordConnection: action.payload };
        case "SET_CHANNEL_FILTER":
            return { ...state, channelFilter: action.payload };
        case "SET_RENAME_SPACE":
            return {
                ...state,
                renameSpaceId: action.payload.id,
                renameSpaceName: action.payload.name,
                renameSpaceIconUrl: action.payload.iconUrl !== undefined ? action.payload.iconUrl : state.renameSpaceIconUrl
            };
        case "SET_RENAME_CATEGORY":
            return { ...state, renameCategoryId: action.payload.id, renameCategoryName: action.payload.name };
        case "SET_RENAME_ROOM":
            return {
                ...state,
                renameRoomId: action.payload.id,
                renameRoomName: action.payload.name !== undefined ? action.payload.name : state.renameRoomName,
                renameRoomType: action.payload.type !== undefined ? action.payload.type : state.renameRoomType,
                renameRoomCategoryId: action.payload.categoryId !== undefined ? action.payload.categoryId : state.renameRoomCategoryId,
                renameRoomTopic: action.payload.topic !== undefined ? (action.payload.topic ?? "") : state.renameRoomTopic,
                renameRoomIconUrl: action.payload.iconUrl !== undefined ? action.payload.iconUrl : state.renameRoomIconUrl,
                renameRoomStyleContent: action.payload.styleContent !== undefined ? (action.payload.styleContent ?? "") : state.renameRoomStyleContent
            };
        case "SET_SELECTED_CATEGORY_FOR_CREATE":
            return { ...state, selectedCategoryIdForCreate: action.payload };
        case "SET_NEAR_BOTTOM":
            return { ...state, isNearBottom: action.payload };
        case "SET_PENDING_NEW_MESSAGE_COUNT":
            return { ...state, pendingNewMessageCount: action.payload };
        case "SET_LAST_SEEN_MESSAGE_ID":
            return { ...state, lastSeenMessageId: action.payload };
        case "UPDATE_MESSAGES":
            return { ...state, messages: action.payload(state.messages) };
        case "SET_LAST_READ":
            return {
                ...state,
                lastReadByChannel: {
                    ...state.lastReadByChannel,
                    [action.payload.channelId]: action.payload.lastSeenId
                }
            };
        case "SET_MENTION_COUNTS":
            return { ...state, mentionCountByChannel: action.payload };
        case "SET_UNREAD_COUNTS":
            return { ...state, unreadCountByChannel: action.payload };
        case "SET_NOTIFICATIONS": {
            const payload = action.payload as Record<string, { unreadCount: number; mentionCount: number; isMuted: boolean; notificationPreference?: 'all' | 'mentions' | 'none' }>;
            const unreadCounts: Record<string, number> = {};
            const mentionCounts: Record<string, number> = {};
            const muteStatuses: Record<string, boolean> = {};
            const preferences: Record<string, 'all' | 'mentions' | 'none'> = {};
            for (const [channelId, data] of Object.entries(payload)) {
                unreadCounts[channelId] = data.unreadCount;
                mentionCounts[channelId] = data.mentionCount;
                muteStatuses[channelId] = data.isMuted;
                preferences[channelId] = data.notificationPreference || 'all';
            }
            return {
                ...state,
                unreadCountByChannel: unreadCounts,
                mentionCountByChannel: mentionCounts,
                muteStatusByChannel: muteStatuses,
                notificationPreferenceByChannel: preferences
            };
        }
        case "CLEAR_NOTIFICATIONS": {
            return {
                ...state,
                unreadCountByChannel: {
                    ...state.unreadCountByChannel,
                    [action.payload.channelId]: 0
                },
                mentionCountByChannel: {
                    ...state.mentionCountByChannel,
                    [action.payload.channelId]: 0
                }
            };
        }
        case "SET_VOICE_CONNECTED":
            return { ...state, voiceConnected: action.payload };
        case "SET_VOICE_MUTED":
            return { ...state, voiceMuted: action.payload };
        case "SET_VOICE_DEAFENED":
            return { ...state, voiceDeafened: action.payload };
        case "SET_VOICE_VIDEO_ENABLED":
            return { ...state, voiceVideoEnabled: action.payload };
        case "SET_VOICE_SCREEN_SHARE_ENABLED":
            return { ...state, voiceScreenShareEnabled: action.payload };
        case "SET_VOICE_VIDEO_QUALITY":
            return { ...state, voiceVideoQuality: action.payload };
        case "SET_VOICE_GRANT":
            return { ...state, voiceGrant: action.payload };
        case "SET_VOICE_MEMBERS":
            return { ...state, voiceMembers: action.payload };
        case "SET_DELETE_TARGET_SPACE_ID":
            return { ...state, deleteTargetSpaceId: action.payload };
        case "SET_DELETE_SPACE_CONFIRM":
            return { ...state, deleteSpaceConfirm: action.payload };
        case "SET_DELETE_ROOM_CONFIRM":
            return { ...state, deleteRoomConfirm: action.payload };
        case "SET_MUTATING_STRUCTURE":
            return { ...state, mutatingStructure: action.payload };
        case "SET_BOOTSTRAPPING":
            return { ...state, bootstrapping: action.payload };
        case "SET_CREATING_SPACE":
            return { ...state, creatingSpace: action.payload };
        case "SET_CREATING_ROOM":
            return { ...state, creatingRoom: action.payload };
        case "SET_CREATING_CATEGORY":
            return { ...state, creatingCategory: action.payload };
        case "SET_SAVING_ONBOARDING":
            return { ...state, savingOnboarding: action.payload };
        case "SET_SENDING":
            return { ...state, sending: action.payload };
        case "SET_UPDATING_CONTROLS":
            return { ...state, updatingControls: action.payload };
        case "SET_CHANNEL_SCROLL_POSITION":
            return {
                ...state,
                channelScrollPositions: {
                    ...state.channelScrollPositions,
                    [action.payload.channelId]: action.payload.position
                }
            };
        case "SET_NOTIFICATION_PREFERENCE":
            return {
                ...state,
                muteStatusByChannel: {
                    ...state.muteStatusByChannel,
                    [action.payload.channelId]: action.payload.isMuted ?? !!state.muteStatusByChannel[action.payload.channelId]
                },
                notificationPreferenceByChannel: {
                    ...state.notificationPreferenceByChannel,
                    [action.payload.channelId]: action.payload.preference
                }
            };
        case "SET_CHANNEL_DRAFT":
            return {
                ...state,
                draftMessagesByChannel: {
                    ...state.draftMessagesByChannel,
                    [action.payload.channelId]: action.payload.draft
                }
            };
        case "SET_PROFILE_USER_ID":
            return { ...state, profileUserId: action.payload };
        case "SET_BLOCKED_USER_IDS":
            return { ...state, blockedUserIds: action.payload };
        case "BLOCK_USER":
            return { ...state, blockedUserIds: [...new Set([...state.blockedUserIds, action.payload])] };
        case "UNBLOCK_USER":
            return { ...state, blockedUserIds: state.blockedUserIds.filter(id => id !== action.payload) };
        case "SET_MEMBERS":
            return { ...state, members: action.payload };
        case "SET_ALL_DM_CHANNELS":
            return { ...state, allDmChannels: action.payload };
        case "SET_LAST_CHANNEL_BY_SERVER":
            return {
                ...state,
                lastChannelByServer: {
                    ...state.lastChannelByServer,
                    [action.payload.serverId]: action.payload.channelId
                }
            };
        case "SET_THREAD_PARENT_ID":
            return { ...state, threadParentId: action.payload };
        case "SET_QUOTING_MESSAGE":
            return { ...state, quotingMessage: action.payload };
        case "SET_TYPING_USER": {
            const { channelId, userId, displayName, isTyping } = action.payload;
            const channelTyping = { ...(state.typingUsersByChannel[channelId] || {}) };
            if (isTyping) {
                channelTyping[userId] = { displayName, timestamp: Date.now() };
            } else {
                delete channelTyping[userId];
            }
            return {
                ...state,
                typingUsersByChannel: {
                    ...state.typingUsersByChannel,
                    [channelId]: channelTyping
                }
            };
        }
        case "PRUNE_TYPING_USERS": {
            const now = Date.now();
            const newTypingByChannel: Record<string, Record<string, { displayName: string; timestamp: number }>> = {};
            let changed = false;

            Object.entries(state.typingUsersByChannel).forEach(([channelId, users]) => {
                const newUsers: Record<string, { displayName: string; timestamp: number }> = {};
                let channelChanged = false;
                Object.entries(users).forEach(([userId, data]) => {
                    if (now - data.timestamp < 10000) {
                        newUsers[userId] = data;
                    } else {
                        channelChanged = true;
                        changed = true;
                    }
                });
                if (Object.keys(newUsers).length > 0) {
                    newTypingByChannel[channelId] = newUsers;
                } else if (channelChanged) {
                    changed = true;
                }
            });

            if (!changed) return state;
            return { ...state, typingUsersByChannel: newTypingByChannel };
        }
        case "SET_SEARCH_QUERY":
            return { ...state, searchQuery: action.payload };
        case "SET_SEARCH_RESULTS":
            return { ...state, searchResults: action.payload };
        case "SET_IS_SEARCHING":
            return { ...state, isSearching: action.payload };
        case "SET_HIGHLIGHTED_MESSAGE_ID":
            return { ...state, highlightedMessageId: action.payload };
        case "SET_MODERATION_TARGET":
            return {
                ...state,
                moderationTargetUserId: action.payload.userId,
                moderationTargetDisplayName: action.payload.displayName,
                moderationTargetMessageId: action.payload.messageId ?? null
            };
        case "SET_CONFIRMATION":
            return {
                ...state,
                confirmationContext: action.payload
            };
        case "SET_PENDING_ACTION_ID": {
            const next = new Set(state.pendingActionIds);
            if (action.payload.active) next.add(action.payload.id);
            else next.delete(action.payload.id);
            return {
                ...state,
                pendingActionIds: next
            };
        }
        case "SET_ROLE_CONTEXT":
            return { ...state, roleContext: action.payload };
        case "SET_SWITCHING_SERVER":
            return { ...state, switchingServer: action.payload };
        case "SET_CHAT_INITIAL_DATA":
            return {
                ...state,
                ...(action.payload.servers !== undefined && { servers: action.payload.servers }),
                ...(action.payload.channels !== undefined && { channels: action.payload.channels }),
                ...(action.payload.categories !== undefined && { categories: action.payload.categories }),
                ...(action.payload.viewerRoles !== undefined && { viewerRoles: action.payload.viewerRoles }),
                ...(action.payload.selectedServerId !== undefined && { selectedServerId: action.payload.selectedServerId }),
                ...(action.payload.selectedChannelId !== undefined && { selectedChannelId: action.payload.selectedChannelId }),
                ...(action.payload.activeChannelData !== undefined && { activeChannelData: action.payload.activeChannelData }),
                ...(action.payload.messages !== undefined && { messages: action.payload.messages }),
                ...(action.payload.members !== undefined && { members: action.payload.members }),
                ...(action.payload.permissions !== undefined && { permissions: action.payload.permissions }),
                ...(action.payload.highlightedMessageId !== undefined && { highlightedMessageId: action.payload.highlightedMessageId }),
                ...(action.payload.error !== undefined && { error: action.payload.error })
            };
        default:
            return state;
    }
}

interface ChatContextType {
    state: ChatState;
    dispatch: React.Dispatch<ChatAction>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(chatReducer, initialState);

    React.useEffect(() => {
        const interval = setInterval(() => {
            dispatch({ type: "PRUNE_TYPING_USERS" });
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <ChatContext.Provider value={{ state, dispatch }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error("useChat must be used within a ChatProvider");
    }
    return context;
}

const ChatHandlersContext = createContext<ChatHandlers | undefined>(undefined);

export function ChatHandlersProvider({ children, value }: { children: ReactNode; value: ChatHandlers }) {
    return (
        <ChatHandlersContext.Provider value={value}>
            {children}
        </ChatHandlersContext.Provider>
    );
}

export function useChatHandlers() {
    const context = useContext(ChatHandlersContext);
    if (context === undefined) {
        throw new Error("useChatHandlers must be used within a ChatHandlersProvider");
    }
    return context;
}
