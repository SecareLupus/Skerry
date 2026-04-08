import crypto from "node:crypto";
import type { ChatMessage } from "@skerry/shared";
import { withDb } from "../../db/client.js";
import { config } from "../../config.js";
import { listUserPresence } from "../presence-service.js";
import { sendMentionNotification } from "../email-service.js";
import { processMessageContentForLinks } from "../link-service.js";
import { 
  ChatMessageRow, 
  ReactionRow, 
  mapChatMessage, 
  randomId 
} from "./mapping-helpers.js";

export async function listMessages(input: {
  channelId: string;
  limit: number;
  before?: string;
  parentId?: string | null;
  viewerUserId?: string;
}): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    let query = `
      select * from chat_messages
      where channel_id = $1 and deleted_at is null
    `;
    const params: unknown[] = [input.channelId];

    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        query += ` and parent_id is null`;
      } else {
        query += ` and parent_id = $${params.length + 1}`;
        params.push(input.parentId);
      }
    }

    if (input.viewerUserId) {
      query += ` and author_user_id not in (select blocked_user_id from user_blocks where blocker_user_id = $${params.length + 1})`;
      params.push(input.viewerUserId);
    }

    if (input.before) {
      query += ` and created_at < $${params.length + 1}::timestamptz`;
      params.push(input.before);
    }

    query += ` order by created_at desc limit $${params.length + 1}`;
    params.push(input.limit);

    const rows = await db.query<ChatMessageRow>(query, params);

    const messageIds = rows.rows.map(r => r.id);
    let repliesCountMap: Record<string, number> = {};

    if (messageIds.length > 0) {
      const counts = await db.query<{ parent_id: string; count: string }>(
        "select parent_id, count(*) from chat_messages where parent_id = any($1) group by parent_id",
        [messageIds]
      );
      for (const row of counts.rows) {
        repliesCountMap[row.parent_id] = parseInt(row.count, 10);
      }
    }

    let reactionsMap: Record<string, ReactionRow[]> = {};
    if (messageIds.length > 0) {
      const reactionsResult = await db.query<ReactionRow>(
        `select mr.message_id, mr.emoji, mr.user_id, 
           coalesce(
             (select preferred_username 
              from identity_mappings 
              where product_user_id = mr.user_id 
              order by (preferred_username is not null) desc, updated_at desc, created_at asc 
              limit 1),
             'user-' || substr(mr.user_id, 1, 8)
           ) as display_name
         from message_reactions mr 
         where mr.message_id = any($1)`,
        [messageIds]
      );

      for (const r of reactionsResult.rows) {
        if (!reactionsMap[r.message_id]) {
          reactionsMap[r.message_id] = [];
        }
        reactionsMap[r.message_id]!.push(r);
      }
    }

    return rows.rows.reverse().map((row) => mapChatMessage(row, repliesCountMap, reactionsMap, input.viewerUserId));
  });
}

export async function searchMessages(input: {
  channelId?: string;
  serverId?: string;
  query: string;
  limit: number;
  before?: string;
  viewerUserId: string;
}): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    let query = `
      select m.*, c.server_id from chat_messages m
      join channels c on c.id = m.channel_id
    `;
    const params: any[] = [];
    query += ` where m.deleted_at is null`;

    if (input.channelId) {
      params.push(input.channelId);
      query += ` and m.channel_id = $${params.length}`;
    } else if (input.serverId) {
      params.push(input.serverId);
      query += ` and c.server_id = $${params.length}`;
    }

    const searchPattern = `%${input.query}%`;
    params.push(searchPattern);
    query += ` and m.content ilike $${params.length}`;

    if (input.before) {
      params.push(input.before);
      query += ` and m.created_at < $${params.length}::timestamptz`;
    }

    if (input.viewerUserId) {
      params.push(input.viewerUserId);
      query += ` and m.author_user_id not in (select blocked_user_id from user_blocks where blocker_user_id = $${params.length})`;
    }

    query += ` order by m.created_at desc limit $${params.length + 1}`;
    params.push(input.limit);

    const rows = await db.query<ChatMessageRow & { server_id: string }>(query, params);
    return rows.rows.map(row => ({
      ...mapChatMessage(row, {}, {}, input.viewerUserId),
      serverId: row.server_id
    }));
  });
}

export async function listMessagesAround(messageId: string, channelId: string, limit: number, viewerUserId: string): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    const targetRow = await db.query<{ created_at: string }>(
      "select created_at from chat_messages where id = $1 and channel_id = $2 and deleted_at is null",
      [messageId, channelId]
    );

    if (targetRow.rows.length === 0) return [];

    const targetCreatedAt = targetRow.rows[0]!.created_at;
    const halfLimit = Math.floor(limit / 2);

    const beforeRows = await db.query<ChatMessageRow>(
      `select * from chat_messages 
       where channel_id = $1 and deleted_at is null and created_at <= $2
       and author_user_id not in (select blocked_user_id from user_blocks where blocker_user_id = $3)
       order by created_at desc limit $4`,
      [channelId, targetCreatedAt, viewerUserId, halfLimit + 1]
    );

    const afterRows = await db.query<ChatMessageRow>(
      `select * from chat_messages 
       where channel_id = $1 and deleted_at is null and created_at > $2
       and author_user_id not in (select blocked_user_id from user_blocks where blocker_user_id = $3)
       order by created_at asc limit $4`,
      [channelId, targetCreatedAt, viewerUserId, halfLimit]
    );

    const allRows = [...afterRows.rows.reverse(), ...beforeRows.rows].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return allRows.map(row => mapChatMessage(row, {}, {}, viewerUserId));
  });
}

export async function fetchMessage(channelId: string, messageId: string, viewerUserId?: string): Promise<ChatMessage | null> {
  return withDb(async (db) => {
    const rows = await db.query<ChatMessageRow>(
      "select * from chat_messages where id = $1 and channel_id = $2 and deleted_at is null",
      [messageId, channelId]
    );

    if (rows.rows.length === 0) return null;

    const row = rows.rows[0]!;
    const countsResult = await db.query<{ count: string }>(
      "select count(*) from chat_messages where parent_id = $1",
      [messageId]
    );
    const repliesCount = parseInt(countsResult.rows[0]?.count || "0", 10);

    const reactionsResult = await db.query<ReactionRow>(
      `select mr.message_id, mr.emoji, mr.user_id, 
         coalesce(
           (select preferred_username 
            from identity_mappings 
            where product_user_id = mr.user_id 
            order by (preferred_username is not null) desc, updated_at desc, created_at asc 
            limit 1),
           'user-' || substr(mr.user_id, 1, 8)
         ) as display_name
       from message_reactions mr 
       where mr.message_id = $1`,
      [messageId]
    );

    return mapChatMessage(row, { [messageId]: repliesCount }, { [messageId]: reactionsResult.rows }, viewerUserId);
  });
}

export async function createMessage(input: {
  channelId: string;
  actorUserId: string;
  content: string;
  attachments?: ChatMessage["attachments"];
  isRelay?: boolean;
  externalAuthorId?: string;
  externalProvider?: string;
  externalAuthorName?: string;
  externalAuthorAvatarUrl?: string;
  parentId?: string;
  replyToId?: string;
  externalThreadId?: string;
  externalMessageId?: string;
}): Promise<ChatMessage> {
  return withDb(async (db) => {
    const identityResult = await db.query<{ preferred_username: string | null; email: string | null; avatar_url: string | null }>(
      `select preferred_username, email, avatar_url
       from identity_mappings
       where product_user_id = $1
       order by (preferred_username is not null) desc, updated_at desc, created_at asc
       limit 1`,
      [input.actorUserId]
    );

    const profile = identityResult.rows[0];
    const fallbackName = profile?.email?.split("@")[0] ?? `user-${input.actorUserId.slice(0, 8)}`;
    const authorDisplayName = profile?.preferred_username ?? fallbackName;
    const avatarUrl = profile?.avatar_url ?? undefined;

    if (!input.parentId && input.externalThreadId) {
      const parentCandidate = await db.query<{ id: string, parent_id: string | null }>(
        `select id, parent_id from chat_messages 
         where (external_thread_id = $1 or external_message_id = $1) 
           and (external_provider = $2 or external_provider is null)
         order by created_at asc limit 1`,
        [input.externalThreadId, input.externalProvider || 'discord']
      );

      let firstMatch = parentCandidate.rows[0];
      if (firstMatch) {
         let root = { id: firstMatch.id, parent_id: firstMatch.parent_id };
         let depth = 0;
         while (root.parent_id && depth < 10) {
           const upRow = await db.query<{ id: string, parent_id: string | null }>(
             "select id, parent_id from chat_messages where id = $1 limit 1",
             [root.parent_id]
           );
           if (upRow.rows[0]) {
             root = upRow.rows[0];
             depth++;
           } else break;
         }
         input.parentId = root.id;
      }
    }

    const embeds = await processMessageContentForLinks(input.content);

    const created = await db.query<ChatMessageRow>(
      `insert into chat_messages(
          id, channel_id, author_user_id, author_display_name, content, attachments, embeds, is_relay,
          external_author_id, external_provider, external_author_name, external_author_avatar_url,
          parent_id, reply_to_id, external_thread_id, external_message_id
        )
       values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning * `,
      [
        randomId("msg"),
        input.channelId,
        input.actorUserId,
        authorDisplayName,
        input.content,
        JSON.stringify(input.attachments ?? []),
        JSON.stringify(embeds),
        Boolean(input.isRelay),
        input.externalAuthorId ?? null,
        input.externalProvider ?? null,
        input.externalAuthorName ?? null,
        input.externalAuthorAvatarUrl ?? null,
        input.parentId ?? null,
        input.replyToId ?? null,
        input.externalThreadId ?? null,
        input.externalMessageId ?? null
      ]
    );

    const row = created.rows[0]!;
    const message: ChatMessage = {
      id: row.id,
      channelId: row.channel_id,
      authorUserId: row.author_user_id,
      authorDisplayName: row.author_display_name,
      content: row.content,
      attachments: row.attachments ?? undefined,
      embeds: row.embeds ?? undefined,
      reactions: [],
      isRelay: row.is_relay,
      externalProvider: row.external_provider ?? undefined,
      externalAuthorName: row.external_author_name ?? undefined,
      externalAuthorAvatarUrl: row.external_author_avatar_url ?? undefined,
      parentId: row.parent_id ?? undefined,
      externalThreadId: row.external_thread_id ?? undefined,
      createdAt: row.created_at
    };

    const chInfo = await db.query<{ name: string, server_id: string }>("select name, server_id from channels where id = $1", [input.channelId]);
    const channelName = chInfo.rows[0]?.name || "unknown";
    const serverId = chInfo.rows[0]?.server_id;

    const mentionHandles = [...new Set((input.content.match(/@([a-zA-Z0-9._-]{3,40})/g) ?? []).map((token) => token.slice(1).toLowerCase()))];
    if (mentionHandles.length > 0) {
      const mentionRows = await db.query<{ product_user_id: string, email: string | null }>(
        `select distinct product_user_id, email from identity_mappings where lower(preferred_username) = any($1::text[])`,
        [mentionHandles]
      );
      const mentionedUserIds = mentionRows.rows.map(r => r.product_user_id).filter(id => id && id !== input.actorUserId);
      if (mentionedUserIds.length > 0) {
        const presence = await listUserPresence(mentionedUserIds);
        for (const mentioned of mentionRows.rows) {
          if (!mentioned.product_user_id || mentioned.product_user_id === input.actorUserId) continue;
          await db.query("insert into mention_markers(id, channel_id, message_id, mentioned_user_id) values($1, $2, $3, $4)",
            [`mm_${crypto.randomUUID().replaceAll("-", "")}`, input.channelId, message.id, mentioned.product_user_id]);

          const userPresence = presence[mentioned.product_user_id];
          if ((!userPresence || !userPresence.isOnline) && mentioned.email && serverId) {
             sendMentionNotification(mentioned.email, authorDisplayName, channelName, input.content.slice(0, 200), `${config.webBaseUrl}/channels/${serverId}/${input.channelId}/${message.id}`).catch(err => console.error(err));
          }
        }
      }
    }

    if (!row.is_relay && serverId) {
       try {
         if (input.content.toLowerCase().includes("@house bot") || input.content.toLowerCase().startsWith("!hb")) {
            const { processLLMInteraction } = await import("../house-bot-service.js");
            const response = await processLLMInteraction(serverId, input.channelId, input.content);
            if (response) {
               await createMessage({
                 channelId: input.channelId,
                 actorUserId: "house_bot",
                 content: response,
                 isRelay: true,
                 externalProvider: "house_bot",
                 externalAuthorName: "House Bot"
               });
            }
         }
         const { listDiscordChannelMappings } = await import("../discord-bridge-service.js");
         const { relayMatrixMessageToDiscord } = await import("../discord-bot-client.js");
         const mappings = await listDiscordChannelMappings(serverId);
         const mappedChannels = mappings.filter(m => m.matrixChannelId === input.channelId && m.enabled);
         for (const m of mappedChannels) {
           await relayMatrixMessageToDiscord({
             serverId,
             discordChannelId: m.discordChannelId,
             authorName: authorDisplayName,
             content: input.content,
             avatarUrl,
             attachments: input.attachments,
             parentId: input.parentId,
             externalThreadId: input.externalThreadId,
             messageId: row.id
           });
         }
       } catch (err) { console.error("Relay error:", err); }
    }

    return message;
  });
}

export async function updateMessage(input: {
  messageId: string;
  actorUserId: string;
  content: string;
}): Promise<ChatMessage> {
  return withDb(async (db) => {
    const embeds = await processMessageContentForLinks(input.content);
    const result = await db.query<ChatMessageRow>(
      `update chat_messages set content = $1, embeds = $4, updated_at = now() where id = $2 and author_user_id = $3 returning *`,
      [input.content, input.messageId, input.actorUserId, JSON.stringify(embeds)]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Message not found or not authored by user.");
    return {
      id: row.id,
      channelId: row.channel_id,
      authorUserId: row.author_user_id,
      authorDisplayName: row.author_display_name,
      content: row.content,
      attachments: row.attachments ?? undefined,
      embeds: row.embeds ?? undefined,
      reactions: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

export async function deleteMessage(input: {
  messageId: string;
  actorUserId: string;
  isModerator?: boolean;
}): Promise<void> {
  return withDb(async (db) => {
    let query = "update chat_messages set deleted_at = now() where id = $1";
    const params = [input.messageId];
    if (!input.isModerator) {
      query += " and author_user_id = $2";
      params.push(input.actorUserId);
    }
    const result = await db.query(query, params);
    if (result.rowCount === 0) throw new Error("Message not found or permission denied.");
  });
}

export async function pinMessage(input: { messageId: string; actorUserId: string }): Promise<ChatMessage> {
  return withDb(async (db) => {
    const res = await db.query("update chat_messages set is_pinned = true, updated_at = now() where id = $1 returning *", [input.messageId]);
    if (!res.rows[0]) throw new Error("Message not found");
    return fetchMessage(res.rows[0].channel_id, res.rows[0].id, input.actorUserId) as any;
  });
}

export async function unpinMessage(input: { messageId: string; actorUserId: string }): Promise<ChatMessage> {
  return withDb(async (db) => {
    const res = await db.query("update chat_messages set is_pinned = false, updated_at = now() where id = $1 returning *", [input.messageId]);
    if (!res.rows[0]) throw new Error("Message not found");
    return fetchMessage(res.rows[0].channel_id, res.rows[0].id, input.actorUserId) as any;
  });
}

export async function listPins(channelId: string): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    const res = await db.query<ChatMessageRow>(
      "select * from chat_messages where channel_id = $1 and is_pinned = true and deleted_at is null order by created_at desc",
      [channelId]
    );
    return res.rows.map(row => mapChatMessage(row, {}, {}));
  });
}

export async function getAnnouncementFeed(productUserId: string, limit = 50): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    const row = await db.query<ChatMessageRow>(
      `select m.* from chat_messages m join channels c on c.id = m.channel_id join followed_announcements fa on fa.source_space_id = c.server_id where fa.product_user_id = $1 and c.type = 'announcement' order by m.created_at desc limit $2`,
      [productUserId, limit]
    );
    return row.rows.map(r => mapChatMessage(r, {}, {}, productUserId));
  });
}
