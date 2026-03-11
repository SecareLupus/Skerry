"use client";

import { useEffect } from "react";
import { useChat } from "../context/chat-context";

export function useNotificationBadge() {
  const { state } = useChat();
  const { mentionCountByChannel, unreadCountByChannel, muteStatusByChannel } = state;

  useEffect(() => {
    let totalMentions = 0;
    for (const [channelId, count] of Object.entries(mentionCountByChannel)) {
      if (!muteStatusByChannel[channelId]) {
        totalMentions += count;
      }
    }

    const baseTitle = "Hatch";
    if (totalMentions > 0) {
      document.title = `(${totalMentions}) ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }, [mentionCountByChannel, muteStatusByChannel]);
}
