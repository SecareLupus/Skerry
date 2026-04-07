"use client";

import { useCallback, useMemo, useState } from "react";
import { useChat } from "../context/chat-context";
import {
  blockUser,
  unblockUser,
  performModerationAction,
  createDMChannel
} from "../lib/control-plane";
import { useToast } from "../components/toast-provider";
import { ContextMenuItem } from "../components/context-menu";

export function useModeration(setUrlSelection: (serverId: string | null, channelId: string | null) => void, refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>) {
  const { state, dispatch } = useChat();
  const { showToast } = useToast();
  const {
    viewer,
    allowedActions,
    selectedServerId,
    blockedUserIds
  } = state;

  const [userContextMenu, setUserContextMenu] = useState<{ x: number; y: number; userId: string; displayName: string } | null>(null);

  const handleUserContextMenu = useCallback((event: React.MouseEvent, member: { id: string, displayName: string }) => {
    event.preventDefault();
    setUserContextMenu({ x: event.clientX, y: event.clientY, userId: member.id, displayName: member.displayName });
  }, []);

  const userContextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!userContextMenu) return [];
    const isModerator = allowedActions.includes("moderation.kick") || 
                       allowedActions.includes("moderation.ban") ||
                       allowedActions.includes("moderation.warn") ||
                       allowedActions.includes("moderation.strike");
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
          // We need a hub ID for DM creation. 
          // For now, we take the hub ID from the first server if available.
          const hubId = state.servers[0]?.hubId;
          if (!hubId) return;
          try {
            const channel = await createDMChannel(hubId, [userContextMenu.userId]);
            setUrlSelection(channel.serverId, channel.id);
            void refreshChatState(channel.serverId, channel.id, undefined, true);
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
        label: "Moderate User...",
        icon: "🛡️",
        danger: true,
        onClick: () => {
          dispatch({ 
            type: "SET_MODERATION_TARGET", 
            payload: { userId: userContextMenu.userId, displayName: userContextMenu.displayName } 
          });
          dispatch({ type: "SET_ACTIVE_MODAL", payload: "moderation" });
        }
      });

      items.push({
        label: "Timeout (Shadow Mute)",
        icon: "⏳",
        danger: true,
        onClick: () => {
          void performModerationAction({
            action: "timeout",
            hubId: undefined,
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
            hubId: undefined,
            serverId: selectedServerId || "",
            targetUserId: userContextMenu.userId,
            reason: "Kick requested via context menu"
          });
        }
      });
    }

    return items;
  }, [userContextMenu, allowedActions, viewer, selectedServerId, dispatch, blockedUserIds, state.servers, setUrlSelection, refreshChatState, showToast]);

  return {
    userContextMenu,
    setUserContextMenu,
    handleUserContextMenu,
    userContextMenuItems
  };
}
