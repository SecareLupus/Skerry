"use client";

import { useCallback } from "react";
import { useChat } from "../context/chat-context";
import { useToast } from "../components/toast-provider";
import type { ChannelType } from "@skerry/shared";
import { 
  updateChannelSettings,
  renameCategory
} from "../lib/control-plane";

interface UseChatSettingsProps {
  refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
}

export function useChatSettings({
  refreshChatState
}: UseChatSettingsProps) {
  const { state, dispatch } = useChat();
  const { showToast } = useToast();
  
  const { 
    selectedServerId, 
    selectedChannelId,
    renameCategoryId,
    renameCategoryName
  } = state;

  const handleUpdateRoomTopic = useCallback(async (channelId: string, topic: string): Promise<void> => {
    if (!selectedServerId) return;
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      await updateChannelSettings(channelId, { topic, serverId: selectedServerId });
      showToast("Topic updated", "success");
      await refreshChatState(selectedServerId, channelId, undefined, true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Failed to update topic.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, dispatch, showToast, refreshChatState]);

  const handleUpdateRoomIcon = useCallback(async (channelId: string, iconUrl: string | null): Promise<void> => {
    if (!selectedServerId) return;
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      await updateChannelSettings(channelId, { iconUrl, serverId: selectedServerId });
      showToast("Icon updated", "success");
      await refreshChatState(selectedServerId, channelId, undefined, true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Failed to update icon.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, dispatch, showToast, refreshChatState]);

  const handleToggleRoomLock = useCallback(async (channelId: string, locked: boolean): Promise<void> => {
    if (!selectedServerId) return;
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      // Assuming updateChannelSettings handles locking or there's a specific endpoint
      await updateChannelSettings(channelId, { locked, serverId: selectedServerId } as any);
      showToast(locked ? "Room locked" : "Room unlocked", "success");
      await refreshChatState(selectedServerId, channelId, undefined, true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Failed to toggle lock.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, dispatch, showToast, refreshChatState]);

  const handleSetSlowmode = useCallback(async (channelId: string, slowmode: number): Promise<void> => {
    if (!selectedServerId) return;
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    try {
      await updateChannelSettings(channelId, { slowmode, serverId: selectedServerId } as any);
      showToast(`Slowmode set to ${slowmode}s`, "success");
      await refreshChatState(selectedServerId, channelId, undefined, true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Failed to set slowmode.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, dispatch, showToast, refreshChatState]);

  const handleRenameCategory = useCallback(async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedServerId || !renameCategoryId || !renameCategoryName.trim()) {
      return;
    }

    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await renameCategory({
        serverId: selectedServerId,
        categoryId: renameCategoryId,
        name: renameCategoryName.trim()
      });
      showToast("Category renamed successfully", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to rename category." });
      showToast(cause instanceof Error ? cause.message : "Failed to rename category.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, renameCategoryId, renameCategoryName, dispatch, showToast, refreshChatState, selectedChannelId]);

  return {
    handleUpdateRoomTopic,
    handleUpdateRoomIcon,
    handleToggleRoomLock,
    handleSetSlowmode,
    handleRenameCategory
  };
}
