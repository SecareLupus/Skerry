"use client";

import { useEffect, useCallback } from "react";
import { useChat, MessageItem } from "../context/chat-context";
import { 
  connectHubStream, 
  listMessages, 
  fetchNotificationSummary, 
  upsertChannelReadState,
  type ChatMessage 
} from "../lib/control-plane";
import { getChannelName } from "../lib/channel-utils";

export function useChatRealtime() {
  const { state, dispatch } = useChat();
  const { 
    viewer, 
    bootstrapStatus, 
    selectedChannelId, 
    selectedServerId, 
    servers, 
    channels,
    isNearBottom 
  } = state;

  const canAccessWorkspace = Boolean(viewer && !viewer.needsOnboarding && bootstrapStatus?.initialized);
  const activeServer = servers.find((s) => s.id === selectedServerId);
  const hubId = activeServer?.hubId;

  const markChannelAsRead = useCallback(async (channelId: string) => {
    if (!channelId) return;
    dispatch({ type: "CLEAR_NOTIFICATIONS", payload: { channelId } });
    try {
      await upsertChannelReadState(channelId);
    } catch (e) {
      // Ignore transient errors
    }
  }, [dispatch]);

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
        if (isNearBottom && !message.parentId) {
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
        // Clear any optimistic pending-action hide as well, since the message is now gone
        dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id, active: false } });
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
  }, [canAccessWorkspace, hubId, selectedChannelId, dispatch, markChannelAsRead, isNearBottom, viewer?.productUserId, channels]);

  return { markChannelAsRead };
}
