import crypto from "node:crypto";
import { withDb } from "../../db/client.js";
import { publishChannelMessage } from "../chat-realtime.js";
import { fetchMessage } from "./message-service.js";

export async function addReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
  isRelay?: boolean;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `insert into message_reactions(id, message_id, user_id, emoji)
       values($1, $2, $3, $4)
       on conflict(message_id, user_id, emoji) do nothing`,
      [`react_${crypto.randomUUID().replaceAll("-", "")}`, input.messageId, input.userId, input.emoji]
    );

    // Mirror to Discord if NOT a relay and message has a Discord ID
    if (!input.isRelay) {
      try {
        const msgRes = await db.query<{ external_message_id: string, external_provider: string, channel_id: string }>(
          "select external_message_id, external_provider, channel_id from chat_messages where id = $1",
          [input.messageId]
        );
        const msg = msgRes.rows[0];
        if (msg?.external_message_id && msg.external_provider === "discord") {
          const chRes = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [msg.channel_id]);
          const serverId = chRes.rows[0]?.server_id;
          if (serverId) {
            const { relayMatrixReactionToDiscord } = await import("../discord-bot-client.js");
            const { listDiscordChannelMappings } = await import("../discord-bridge-service.js");
            const mappings = await listDiscordChannelMappings(serverId);
            const mapping = mappings.find(m => m.matrixChannelId === msg.channel_id && m.enabled);
            if (mapping) {
              await relayMatrixReactionToDiscord({
                serverId,
                discordChannelId: mapping.discordChannelId,
                externalMessageId: msg.external_message_id,
                emoji: input.emoji,
                action: "add"
              });
            }
          }
        }
      } catch (err) {
        console.error("[Discord Bridge] Failed to relay reaction add:", err);
      }
    }

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
  isRelay?: boolean;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `delete from message_reactions
       where message_id = $1 and user_id = $2 and emoji = $3`,
      [input.messageId, input.userId, input.emoji]
    );

    // Mirror to Discord if NOT a relay
    if (!input.isRelay) {
      try {
        const msgRes = await db.query<{ external_message_id: string, external_provider: string, channel_id: string }>(
          "select external_message_id, external_provider, channel_id from chat_messages where id = $1",
          [input.messageId]
        );
        const msg = msgRes.rows[0];
        if (msg?.external_message_id && msg.external_provider === "discord") {
          const chRes = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [msg.channel_id]);
          const serverId = chRes.rows[0]?.server_id;
          if (serverId) {
            const { relayMatrixReactionToDiscord } = await import("../discord-bot-client.js");
            const { listDiscordChannelMappings } = await import("../discord-bridge-service.js");
            const mappings = await listDiscordChannelMappings(serverId);
            const mapping = mappings.find(m => m.matrixChannelId === msg.channel_id && m.enabled);
            if (mapping) {
              await relayMatrixReactionToDiscord({
                serverId,
                discordChannelId: mapping.discordChannelId,
                externalMessageId: msg.external_message_id,
                emoji: input.emoji,
                action: "remove"
              });
            }
          }
        }
      } catch (err) {
        console.error("[Discord Bridge] Failed to relay reaction remove:", err);
      }
    }

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
