"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChat } from "../context/chat-context";
import {
  issueVoiceTokenWithVideo,
  joinVoicePresence,
  leaveVoicePresence,
  listVoicePresence,
  updateVoicePresenceState,
  updateChannelVideoControls
} from "../lib/control-plane";

export function useVoice() {
  const { state, dispatch } = useChat();
  const {
    selectedServerId,
    selectedChannelId,
    activeChannelData,
    voiceConnected,
    voiceMuted,
    voiceDeafened,
    voiceVideoEnabled,
    voiceVideoQuality,
    voiceGrant,
    voiceMembers
  } = state;

  const previousServerIdRef = useRef<string | null>(null);

  // Reset voice state ONLY if the server actually changed
  useEffect(() => {
    if (previousServerIdRef.current !== selectedServerId) {
      console.log("[useVoice] Voice reset effect: Server changed. Previous:", previousServerIdRef.current, "New:", selectedServerId);
      dispatch({ type: "SET_VOICE_CONNECTED", payload: false });
      dispatch({ type: "SET_VOICE_MUTED", payload: false });
      dispatch({ type: "SET_VOICE_DEAFENED", payload: false });
      dispatch({ type: "SET_VOICE_GRANT", payload: null });
      dispatch({ type: "SET_VOICE_MEMBERS", payload: [] });
      previousServerIdRef.current = selectedServerId;
    }
  }, [selectedServerId, dispatch]);

  // Periodic voice presence refresh
  useEffect(() => {
    if (!voiceConnected || !selectedServerId || !selectedChannelId || activeChannelData?.type !== "voice") {
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
          if (stopped) return;
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
  }, [voiceConnected, selectedServerId, selectedChannelId, activeChannelData?.type, dispatch]);

  const handleJoinVoice = useCallback(async () => {
    if (!selectedServerId || !selectedChannelId || activeChannelData?.type !== "voice") {
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
  }, [selectedServerId, selectedChannelId, activeChannelData?.type, voiceVideoQuality, voiceMuted, voiceDeafened, voiceVideoEnabled, dispatch]);

  const handleLeaveVoice = useCallback(async () => {
    if (!selectedServerId || !selectedChannelId || !voiceConnected) {
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

  const handleToggleMuteDeafen = async (nextMuted: boolean, nextDeafened: boolean) => {
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
  };

  const handleToggleVideo = async (nextVideoEnabled: boolean) => {
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
  };

  const handleSetVoiceChannelVideoDefaults = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedServerId || !selectedChannelId || activeChannelData?.type !== "voice") {
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
    } catch (cause) {
      dispatch({ type: "SET_ERROR", payload: cause instanceof Error ? cause.message : "Failed to update voice defaults." });
    }
  };

  return {
    handleJoinVoice,
    handleLeaveVoice,
    handleToggleMuteDeafen,
    handleToggleVideo,
    handleSetVoiceChannelVideoDefaults,
    voiceConnected,
    voiceMuted,
    voiceDeafened,
    voiceVideoEnabled,
    voiceGrant,
    voiceMembers,
    voiceVideoQuality
  };
}
