import crypto from "node:crypto";
import { withDb } from "../../db/client.js";
import { publishChannelMessage } from "../chat-realtime.js";
import { fetchMessage } from "./message-service.js";

export async function addReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `insert into message_reactions(id, message_id, user_id, emoji)
       values($1, $2, $3, $4)
       on conflict(message_id, user_id, emoji) do nothing`,
      [`react_${crypto.randomUUID().replaceAll("-", "")}`, input.messageId, input.userId, input.emoji]
    );

    // Emit real-time update
    const channelRes = await db.query<{ channel_id: string }>("select channel_id from chat_messages where id = $1", [input.messageId]);
    const channelId = channelRes.rows[0]?.channel_id;
    if (channelId) {
      const message = await fetchMessage(channelId, input.messageId, input.userId);
      if (message) {
        await publishChannelMessage(message, "message.updated");
      }
    }
  });
}

export async function removeReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `delete from message_reactions
       where message_id = $1 and user_id = $2 and emoji = $3`,
      [input.messageId, input.userId, input.emoji]
    );

    // Emit real-time update
    const channelRes = await db.query<{ channel_id: string }>("select channel_id from chat_messages where id = $1", [input.messageId]);
    const channelId = channelRes.rows[0]?.channel_id;
    if (channelId) {
      const message = await fetchMessage(channelId, input.messageId, input.userId);
      if (message) {
        await publishChannelMessage(message, "message.updated");
      }
    }
  });
}
