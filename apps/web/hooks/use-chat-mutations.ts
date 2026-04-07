"use client";

import { useState, useCallback } from "react";
import { useChat } from "../context/chat-context";
import { useToast } from "../components/toast-provider";
import type { ChannelType } from "@skerry/shared";
import { 
  createServer,
  deleteServer,
  renameServer,
  createChannel,
  deleteChannel,
  renameChannel,
  createCategory,
  deleteCategory,
  renameCategory,
  moveChannelCategory,
  uploadMedia,
  updateServerSettings
} from "../lib/control-plane";

interface UseChatMutationsProps {
  refreshChatState: (serverId?: string, channelId?: string, messageId?: string, force?: boolean) => Promise<void>;
  handleChannelChange: (channelId: string) => Promise<void>;
}

export function useChatMutations({
  refreshChatState,
  handleChannelChange
}: UseChatMutationsProps) {
  const { state, dispatch } = useChat();
  const { showToast } = useToast();
  
  const { 
    selectedServerId, 
    selectedChannelId, 
    servers, 
    channels, 
    categories, 
    hubs,
    renameSpaceId,
    renameSpaceName,
    renameSpaceIconUrl,
    renameRoomId,
    renameRoomName,
    renameRoomType,
    renameRoomCategoryId,
    renameRoomTopic,
    renameRoomIconUrl,
    renameRoomStyleContent,
    selectedCategoryIdForCreate,
    deleteTargetSpaceId,
    deleteSpaceConfirm,
    deleteRoomConfirm
  } = state;

  // Local state for forms
  const [spaceName, setSpaceName] = useState("New Space");
  const [roomName, setRoomName] = useState("new-room");
  const [roomType, setRoomType] = useState<ChannelType>("text");
  const [roomIcon, setRoomIcon] = useState("");
  const [selectedHubIdForCreate, setSelectedHubIdForCreate] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("New Category");
  const [spaceSettingsTab, setSpaceSettingsTab] = useState<"general" | "permissions">("general");
  const [roomSettingsTab, setRoomSettingsTab] = useState<"general" | "permissions" | "preview">("general");
  const [iconFile, setIconFile] = useState<File | null>(null);

  const handleCreateSpace = useCallback(async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedHubIdForCreate || !spaceName.trim()) {
      return;
    }

    dispatch({ type: "SET_CREATING_SPACE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const server = await createServer({
        hubId: selectedHubIdForCreate,
        name: spaceName.trim()
      });
      setSpaceName("New Space");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      showToast("Space created successfully", "success");
      await refreshChatState(server.id, undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create space." });
      showToast(cause instanceof Error ? cause.message : "Failed to create space.", "error");
    } finally {
      dispatch({ type: "SET_CREATING_SPACE", payload: false });
    }
  }, [selectedHubIdForCreate, spaceName, dispatch, showToast, refreshChatState]);

  const handleRenameSpace = useCallback(async (event: React.FormEvent): Promise<void> => {
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

      await renameServer({
        serverId: renameSpaceId,
        name: renameSpaceName.trim()
      });

      dispatch({ type: "SET_RENAME_SPACE", payload: { id: renameSpaceId, name: "", iconUrl: null } });
      setIconFile(null);
      showToast("Space renamed successfully", "success");
      await refreshChatState(renameSpaceId, selectedChannelId ?? undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to rename space." });
      showToast(cause instanceof Error ? cause.message : "Failed to rename space.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [renameSpaceId, renameSpaceName, renameSpaceIconUrl, iconFile, dispatch, showToast, refreshChatState, selectedChannelId]);

  const performDeleteSpace = useCallback(async (serverId: string): Promise<void> => {
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await deleteServer(serverId);
      dispatch({ type: "SET_DELETE_SPACE_CONFIRM", payload: "" });
      showToast("Space deleted successfully", "success");
      const remainingServers = servers.filter((s) => s.id !== serverId);
      await refreshChatState(remainingServers[0]?.id, undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete space." });
      showToast(cause instanceof Error ? cause.message : "Failed to delete space.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [dispatch, showToast, servers, refreshChatState]);

  const handleDeleteSpace = useCallback(async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const targetServerId = deleteTargetSpaceId || renameSpaceId || selectedServerId;
    if (!targetServerId) return;
    if (deleteSpaceConfirm.trim() !== "DELETE SPACE") {
      dispatch({ type: "SET_ERROR", payload: "Type DELETE SPACE to confirm." });
      return;
    }
    await performDeleteSpace(targetServerId);
    dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
  }, [deleteTargetSpaceId, renameSpaceId, selectedServerId, deleteSpaceConfirm, dispatch, performDeleteSpace]);

  const handleCreateRoom = useCallback(async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedServerId || !roomName.trim()) {
      return;
    }

    dispatch({ type: "SET_CREATING_ROOM", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const channel = await createChannel({
        serverId: selectedServerId,
        name: roomName.trim(),
        type: roomType,
        categoryId: selectedCategoryIdForCreate || undefined
      });
      setRoomName("new-room");
      setRoomIcon("");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      showToast("Room created successfully", "success");
      await refreshChatState(selectedServerId, channel.id, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create room." });
      showToast(cause instanceof Error ? cause.message : "Failed to create room.", "error");
    } finally {
      dispatch({ type: "SET_CREATING_ROOM", payload: false });
    }
  }, [selectedServerId, roomName, roomType, selectedCategoryIdForCreate, roomIcon, dispatch, showToast, refreshChatState]);

  const handleRenameRoom = useCallback(async (event: React.FormEvent): Promise<void> => {
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
        categoryId: renameRoomCategoryId || undefined,
        topic: renameRoomTopic || undefined,
        iconUrl: renameRoomIconUrl || undefined,
        styleContent: renameRoomStyleContent || undefined
      });
      showToast("Room updated successfully", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      await refreshChatState(selectedServerId, renameRoomId, undefined, true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Failed to update room.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [renameRoomId, renameRoomName, selectedServerId, renameRoomType, renameRoomCategoryId, renameRoomTopic, renameRoomIconUrl, renameRoomStyleContent, dispatch, showToast, refreshChatState]);

  const performDeleteRoom = useCallback(async (serverId: string, channelId: string): Promise<void> => {
    dispatch({ type: "SET_MUTATING_STRUCTURE", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      await deleteChannel({ serverId, channelId });
      dispatch({ type: "SET_DELETE_ROOM_CONFIRM", payload: "" });
      showToast("Room deleted successfully", "success");
      const remainingChannels = channels.filter((c) => c.id !== channelId);
      await refreshChatState(serverId, remainingChannels[0]?.id, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete room." });
      showToast(cause instanceof Error ? cause.message : "Failed to delete room.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [dispatch, showToast, channels, refreshChatState]);

  const handleDeleteRoom = useCallback(async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedChannelId || !selectedServerId) return;
    if (deleteRoomConfirm.trim() !== "DELETE ROOM") {
      dispatch({ type: "SET_ERROR", payload: "Type DELETE ROOM to confirm." });
      return;
    }
    await performDeleteRoom(selectedServerId, selectedChannelId);
    dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
  }, [selectedChannelId, selectedServerId, deleteRoomConfirm, dispatch, performDeleteRoom]);

  const handleCreateCategory = useCallback(async (event: React.FormEvent): Promise<void> => {
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
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      showToast("Category created successfully", "success");
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to create category." });
      showToast(cause instanceof Error ? cause.message : "Failed to create category.", "error");
    } finally {
      dispatch({ type: "SET_CREATING_CATEGORY", payload: false });
    }
  }, [selectedServerId, categoryName, dispatch, showToast, refreshChatState, selectedChannelId]);

  const handleDeleteCategory = useCallback(async (categoryId: string): Promise<void> => {
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
      showToast("Category deleted successfully", "success");
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to delete category." });
      showToast(cause instanceof Error ? cause.message : "Failed to delete category.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, dispatch, showToast, refreshChatState, selectedChannelId]);

  const handleMoveSelectedRoomCategory = useCallback(async (event: React.FormEvent): Promise<void> => {
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
      showToast("Room moved successfully", "success");
      dispatch({ type: "SET_ACTIVE_MODAL", payload: null });
      await refreshChatState(selectedServerId, selectedChannelId, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to move room." });
      showToast(cause instanceof Error ? cause.message : "Failed to move room.", "error");
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, selectedChannelId, selectedCategoryIdForCreate, dispatch, showToast, refreshChatState]);

  const moveCategoryPosition = useCallback(async (categoryId: string, direction: "up" | "down"): Promise<void> => {
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
      await Promise.all([
        renameCategory({ categoryId: current.id, serverId: selectedServerId, position: neighbor.position }),
        renameCategory({ categoryId: neighbor.id, serverId: selectedServerId, position: current.position })
      ]);
      await refreshChatState(selectedServerId, selectedChannelId ?? undefined, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to reorder category." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, categories, dispatch, refreshChatState, selectedChannelId]);

  const moveChannelPosition = useCallback(async (channelId: string, direction: "up" | "down"): Promise<void> => {
    if (!selectedServerId) return;
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

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
      await refreshChatState(selectedServerId, channelId, undefined, true);
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to reorder room." });
    } finally {
      dispatch({ type: "SET_MUTATING_STRUCTURE", payload: false });
    }
  }, [selectedServerId, channels, dispatch, refreshChatState]);

  return {
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
    spaceSettingsTab,
    setSpaceSettingsTab,
    roomSettingsTab,
    setRoomSettingsTab
  };
}
