"use client";

import { useEffect, useCallback } from "react";
import { useChat, MessageItem } from "../context/chat-context";
import { useToast } from "../components/toast-provider";
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
  const { showToast } = useToast();
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
      console.warn("[realtime] upsertChannelReadState failed", e);
    }
  }, [dispatch]);

  useEffect(() => {
    if (!canAccessWorkspace || !hubId) {
      dispatch({ type: "SET_REALTIME_STATE", payload: "disconnected" });
      return;
    }

    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let consecutivePollFailures = 0;
    let pollFailureToastShown = false;

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
            consecutivePollFailures = 0;
            pollFailureToastShown = false;
            dispatch({
              type: "UPDATE_MESSAGES",
              payload: (current: MessageItem[]) => {
                const map = new Map<string, MessageItem>();
                
                // 1. Initialize map with current state
                current.forEach((m: MessageItem) => map.set(m.id, m));
                
                // 2. Merge server state
                next.forEach((serverMsg: MessageItem) => {
                    const localMsg = map.get(serverMsg.id);
                    
                    // If we don't have it, or it's a sending/failed state, or the server version is definitively newer
                    if (!localMsg) {
                        map.set(serverMsg.id, serverMsg);
                        return;
                    }

                    // Preserve local optimistic states (sending/failed)
                    if (localMsg.clientState === "sending" || localMsg.clientState === "failed") {
                        return;
                    }

                    // Only overwrite if the server's update timestamp is newer than our local one
                    const serverUpdate = serverMsg.updatedAt ? new Date(serverMsg.updatedAt).getTime() : 0;
                    const localUpdate = localMsg.updatedAt ? new Date(localMsg.updatedAt).getTime() : 0;
                    
                    if (serverUpdate >= localUpdate) {
                        map.set(serverMsg.id, serverMsg);
                    }
                });

                return Array.from(map.values()).sort((a, b) =>
                  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );
              }
            });
          })
          .catch((err: unknown) => {
            consecutivePollFailures += 1;
            console.warn("[realtime] poll failed", { attempts: consecutivePollFailures, error: err });
            if (consecutivePollFailures >= 3 && !pollFailureToastShown) {
              pollFailureToastShown = true;
              dispatch({ type: "SET_REALTIME_STATE", payload: "disconnected" });
              showToast("Lost connection. Retrying…", "error");
            }
          });
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
              // We rely on the authoritative backend broadcast (message.updated for the parent)
              // to synchronize reply counts, preventing race conditions with local increments.
              return current;
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
            return current.map((item: MessageItem) => (item.id === updatedMessage.id ? { ...item, ...updatedMessage } : item));
          }
        });
      }
    });

    source.addEventListener("message.deleted", (event: any) => {
      const { id, channelId, parentId } = JSON.parse(event.data) as { id: string; channelId: string; parentId?: string | null };
      if (channelId === selectedChannelId) {
        dispatch({
          type: "UPDATE_MESSAGES",
          payload: (current: MessageItem[]) => {
            const wasPresent = current.some(m => m.id === id);
            const filtered = current.filter((m) => m.id !== id);
            
            // Only decrement the parent's repliesCount if the message was actually in our state
            // and removed, to avoid double-decrementing after an optimistic update.
            if (parentId && wasPresent) {
              return filtered.map(item => {
                if (item.id === parentId) {
                  return { ...item, repliesCount: Math.max(0, (item.repliesCount || 0) - 1) };
                }
                return item;
              });
            }
            return filtered;
          }
        });
        // Clear any optimistic pending-action hide as well, since the message is now gone
        dispatch({ type: "SET_PENDING_ACTION_ID", payload: { id, active: false } });
      }
    });

    source.addEventListener("channel.created", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "UPSERT_CHANNEL", payload: data });
      }
    });

    source.addEventListener("channel.updated", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "UPSERT_CHANNEL", payload: data });
      }
    });

    source.addEventListener("channel.deleted", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "DELETE_CHANNEL", payload: data.id });
      }
    });

    source.addEventListener("category.created", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "UPSERT_CATEGORY", payload: data });
      }
    });

    source.addEventListener("category.updated", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "UPSERT_CATEGORY", payload: data });
      }
    });

    source.addEventListener("category.deleted", (event: any) => {
      const data = JSON.parse(event.data);
      if (data.serverId === selectedServerId) {
        dispatch({ type: "DELETE_CATEGORY", payload: data.id });
      }
    });

    source.addEventListener("membership.updated", (event: any) => {
      const data = JSON.parse(event.data);
      const isViewer = viewer?.productUserId === data.userId;
      if (isViewer && data.state === "left") {
        showToast("You were kicked from the server.", "error");
        dispatch({ type: "SET_MEMBERSHIP_UPDATE", payload: Date.now() });
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
  }, [canAccessWorkspace, hubId, selectedServerId, selectedChannelId, dispatch, markChannelAsRead, isNearBottom, viewer?.productUserId, channels, showToast]);

  return { markChannelAsRead };
}
