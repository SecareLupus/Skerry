"use client";

import { useChat, MessageItem } from "../context/chat-context";
import { sendMessage, logout } from "../lib/control-plane";
import type { ChatMessage } from "@skerry/shared";

interface UseChatHandlersProps {
  selectedChannelId: string | null;
  messageInputRef: React.RefObject<HTMLTextAreaElement>;
  initialize: () => Promise<void>;
  draftMessage: string;
  setDraftMessage: (val: string) => void;
}

export function useChatMessaging({
  selectedChannelId,
  messageInputRef,
  initialize,
  draftMessage,
  setDraftMessage
}: UseChatHandlersProps) {
  const { state, dispatch } = useChat();

  async function sendContentWithOptimistic(content: string, attachments: any[] = [], existingMessageId?: string, parentId?: string, replyToId?: string): Promise<void> {
    if (!selectedChannelId || !state.viewer || (!content.trim() && attachments.length === 0)) {
      return;
    }

    const tempId = existingMessageId ?? `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: MessageItem = {
      id: tempId,
      channelId: selectedChannelId,
      authorUserId: state.viewer.productUserId,
      authorDisplayName: state.viewer.identity?.preferredUsername ?? "You",
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
        persisted = await sendMessage(selectedChannelId, content.trim(), attachments, parentId, replyToId);
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
    const replyToId = state.quotingMessage?.id;
    if (state.quotingMessage) {
      dispatch({ type: "SET_QUOTING_MESSAGE", payload: null });
    }
    await sendContentWithOptimistic(finalContent, attachments, undefined, undefined, replyToId);
  }

  async function handleSendMessage(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await submitDraftMessage();
  }

  async function handleLogout(): Promise<void> {
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("masquerade_token");
      }
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

  return {
    draftMessage,
    setDraftMessage,
    handleSendMessage,
    submitDraftMessage,
    sendContentWithOptimistic,
    handleLogout
  };
}
