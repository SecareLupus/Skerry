import crypto from "node:crypto";
import type { Category, Channel, ChannelReadState, ChatMessage, HubInvite, MentionMarker, Server } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { processMessageContentForLinks } from "./link-service.js";


interface ChannelRow {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  type: Channel["type"];
  matrix_room_id: string | null;
  hub_admin_access: string;
  space_member_access: string;
  hub_member_access: string;
  visitor_access: string;
  is_locked: boolean;
  slow_mode_seconds: number;
  posting_restricted_to_roles: string[] | null;
  voice_sfu_room_id: string | null;
  voice_max_participants: number | null;
  video_enabled: boolean;
  video_max_participants: number | null;
  position: number;
  topic: string | null;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  channel_id: string;
  author_user_id: string;
  author_display_name: string;
  content: string;
  attachments: ChatMessage["attachments"] | null;
  embeds: ChatMessage["embeds"] | null;
  is_relay: boolean;
  external_author_id: string | null;
  external_provider: string | null;
  external_author_name: string | null;
  external_author_avatar_url: string | null;
  parent_id: string | null;
  external_thread_id: string | null;
  external_message_id?: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}


export interface ReactionRow {
  message_id: string;
  emoji: string;
  user_id: string;
  display_name: string;
}

interface CategoryRow {
  id: string;
  server_id: string;
  name: string;
  matrix_subspace_id: string | null;
  position: number;
  created_at: string;
}

function mapChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    serverId: row.server_id,
    categoryId: row.category_id,
    name: row.name,
    type: row.type,
    matrixRoomId: row.matrix_room_id,
    isLocked: row.is_locked,
    slowModeSeconds: row.slow_mode_seconds,
    postingRestrictedToRoles: (row.posting_restricted_to_roles ?? []) as Channel["postingRestrictedToRoles"],
    voiceMetadata:
      row.voice_sfu_room_id && row.voice_max_participants
        ? {
          sfuRoomId: row.voice_sfu_room_id,
          maxParticipants: row.voice_max_participants,
          videoEnabled: row.video_enabled,
          maxVideoParticipants: row.video_max_participants
        }
        : null,
    position: row.position,
    hubAdminAccess: row.hub_admin_access as any,
    spaceMemberAccess: row.space_member_access as any,
    hubMemberAccess: row.hub_member_access as any,
    visitorAccess: row.visitor_access as any,
    topic: row.topic,
    createdAt: row.created_at
  };
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    matrixSubspaceId: row.matrix_subspace_id,
    position: row.position,
    createdAt: row.created_at
  };
}

export async function listServers(productUserId?: string): Promise<Server[]> {
  return withDb(async (db) => {
    // 1. Fetch servers. 
    // Logic: If Hidden, must be owner/admin or have a role binding or channel membership.
    // Or if Hidden but has at least one Public/Viewable channel.
    const rows = await db.query<{
      id: string;
      hub_id: string;
      name: string;
      type: "default" | "dm";
      matrix_space_id: string | null;
      icon_url: string | null;
      hub_admin_access: string;
      space_member_access: string;
      hub_member_access: string;
      visitor_access: string;
      auto_join_hub_members: boolean;
      created_by_user_id: string;
      owner_user_id: string;
      created_at: string;
      is_member: boolean;
    }>(
      `select s.*, 
              (exists (select 1 from server_members where server_id = s.id and product_user_id = $1)) as is_member
       from servers s
       where s.type = 'dm'
          or s.owner_user_id = $1
          or exists (select 1 from role_bindings where (hub_id = s.hub_id or hub_id is null) and product_user_id = $1 and role in ('hub_owner', 'hub_admin'))
          or (s.space_member_access != 'hidden' and exists (select 1 from server_members where server_id = s.id and product_user_id = $1))
          or (s.hub_member_access != 'hidden' and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1))
          or (s.visitor_access != 'hidden')
          or exists (select 1 from channels c where c.server_id = s.id and (
              c.visitor_access != 'hidden' 
              or (c.hub_member_access != 'hidden' and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1))
              or (c.space_member_access != 'hidden' and exists (select 1 from server_members where server_id = s.id and product_user_id = $1))
          ))
       order by s.created_at asc`,
      [productUserId ?? null]
    );

    return rows.rows.map((row) => ({
      id: row.id,
      hubId: row.hub_id,
      name: row.name,
      type: row.type || "default",
      matrixSpaceId: row.matrix_space_id,
      iconUrl: row.icon_url,
      hubAdminAccess: row.hub_admin_access as any,
      spaceMemberAccess: row.space_member_access as any,
      hubMemberAccess: row.hub_member_access as any,
      visitorAccess: row.visitor_access as any,
      autoJoinHubMembers: row.auto_join_hub_members,
      createdByUserId: row.created_by_user_id,
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at,
      isMember: row.is_member
    }));
  });
}

export async function listChannels(serverId: string, productUserId?: string): Promise<Channel[]> {
  return withDb(async (db) => {
    const srvRow = await db.query<{ type: string }>("select type from servers where id = $1", [serverId]);
    const isDmServer = srvRow.rows[0]?.type === 'dm';

    if (isDmServer && productUserId) {
      const rows = await db.query<ChannelRow>(
        `select ch.*
         from channels ch
         join channel_members cm on cm.channel_id = ch.id
         where ch.server_id = $1 and cm.product_user_id = $2
         order by ch.position asc, ch.created_at asc`,
        [serverId, productUserId]
      );
      const channels = rows.rows.map(mapChannel);

      if (channels.length > 0) {
        const channelIds = channels.map(c => c.id);
        const memberRows = await db.query<{
          channel_id: string;
          product_user_id: string;
          display_name: string;
        }>(
          `select cm.channel_id, cm.product_user_id,
             coalesce(
               (select preferred_username 
                from identity_mappings 
                where product_user_id = cm.product_user_id 
                order by (preferred_username is not null) desc, updated_at desc, created_at asc 
                limit 1),
               'user-' || substr(cm.product_user_id, 1, 8)
             ) as display_name
           from channel_members cm
           where cm.channel_id = any($1)`,
          [channelIds]
        );

        const memberMap = new Map<string, { productUserId: string; displayName: string }[]>();
        for (const row of memberRows.rows) {
          const list = memberMap.get(row.channel_id) ?? [];
          list.push({ productUserId: row.product_user_id, displayName: row.display_name });
          memberMap.set(row.channel_id, list);
        }

        for (const channel of channels) {
          channel.participants = memberMap.get(channel.id) ?? [];
        }
      }

      return channels;
    }

    const rows = await db.query<ChannelRow>(
      `select ch.* 
       from channels ch
       join servers s on s.id = ch.server_id
       where ch.server_id = $1 
         and (
           ch.privacy_tier != 'hidden'
           or s.owner_user_id = $2
           or exists (select 1 from role_bindings where (server_id = $1 or hub_id = s.hub_id) and product_user_id = $2)
           or exists (select 1 from channel_members where channel_id = ch.id and product_user_id = $2)
         )
       order by ch.position asc, ch.created_at asc`,
      [serverId, productUserId ?? null]
    );
    return rows.rows.map(mapChannel);
  });
}

export async function listCategories(serverId: string): Promise<Category[]> {
  return withDb(async (db) => {
    const rows = await db.query<CategoryRow>(
      "select * from categories where server_id = $1 order by position asc, created_at asc",
      [serverId]
    );
    return rows.rows.map(mapCategory);
  });
}

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

    // Wrap query in percentage for ILIKE
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

    if (targetRow.rows.length === 0) {
      return [];
    }

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

export async function getFirstUnreadMessageId(channelId: string, userId: string): Promise<string | null> {
  return withDb(async (db) => {
    const readState = await db.query<{ last_read_at: string }>(
      "select last_read_at from channel_read_states where channel_id = $1 and product_user_id = $2",
      [channelId, userId]
    );

    if (readState.rows.length === 0) {
      return null;
    }

    const lastReadAt = readState.rows[0]?.last_read_at;

    const msg = await db.query<{ id: string }>(
      `select id from chat_messages 
       where channel_id = $1 and deleted_at is null and created_at > $2
       order by created_at asc limit 1`,
      [channelId, lastReadAt]
    );

    return msg.rows[0]?.id ?? null;
  });
}


function mapChatMessage(row: ChatMessageRow, repliesCountMap: Record<string, number>, reactionsMap: Record<string, ReactionRow[]>, viewerUserId?: string): ChatMessage {
  const rawReactions = reactionsMap[row.id] ?? [];
  const reactionsByEmoji: Record<string, NonNullable<ChatMessage["reactions"]>[number]> = {};

  for (const r of rawReactions) {
    let reaction = reactionsByEmoji[r.emoji];
    if (!reaction) {
      reaction = {
        emoji: r.emoji,
        count: 0,
        me: false,
        userIds: []
      };
      reactionsByEmoji[r.emoji] = reaction;
    }
    reaction.count++;
    reaction.userIds.push(r.user_id);
    if (viewerUserId && r.user_id === viewerUserId) {
      reaction.me = true;
    }
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    content: row.content,
    attachments: row.attachments ?? undefined,
    embeds: row.embeds ?? undefined,
    reactions: Object.values(reactionsByEmoji),
    isRelay: row.is_relay,
    externalProvider: row.external_provider ?? undefined,
    externalAuthorName: row.external_author_name ?? undefined,
    externalAuthorAvatarUrl: row.external_author_avatar_url ?? undefined,
    parentId: row.parent_id ?? undefined,
    externalThreadId: row.external_thread_id ?? undefined,
    repliesCount: repliesCountMap[row.id] || 0,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };


}

export async function fetchMessage(channelId: string, messageId: string, viewerUserId?: string): Promise<ChatMessage | null> {
  return withDb(async (db) => {
    const rows = await db.query<ChatMessageRow>(
      "select * from chat_messages where id = $1 and channel_id = $2 and deleted_at is null",
      [messageId, channelId]
    );

    if (rows.rows.length === 0) {
      return null;
    }

    const row = rows.rows[0]!;

    // Get replies count
    const counts = await db.query<{ count: string }>(
      "select count(*) from chat_messages where parent_id = $1",
      [messageId]
    );
    const repliesCount = parseInt(counts.rows[0]?.count || "0", 10);

    // Get reactions
    const reactionsResult = await db.query<{
      message_id: string;
      emoji: string;
      user_id: string;
      display_name: string;
    }>(
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

    const reactionsMap = { [messageId]: reactionsResult.rows };
    const repliesCountMap = { [messageId]: repliesCount };

    return mapChatMessage(row, repliesCountMap, reactionsMap, viewerUserId);
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
  externalThreadId?: string;
  externalMessageId?: string;
}): Promise<ChatMessage> {
  return withDb(async (db) => {
    try {
      const identity = await db.query<{ preferred_username: string | null; email: string | null; avatar_url: string | null }>(
        `select preferred_username, email, avatar_url
       from identity_mappings
       where product_user_id = $1
       order by (preferred_username is not null) desc, updated_at desc, created_at asc
       limit 1`,
        [input.actorUserId]
      );

      const profile = identity.rows[0];
      const fallbackName = profile?.email?.split("@")[0] ?? `user-${input.actorUserId.slice(0, 8)}`;
      const authorDisplayName = profile?.preferred_username ?? fallbackName;
      const avatarUrl = profile?.avatar_url ?? undefined;

      // Automatically resolve parentId from externalThreadId if not provided
      if (!input.parentId && input.externalThreadId) {
        console.log(`[Bridge] Parent Linkage Diagnostic - Start`);
        console.log(`[Bridge] Input: externalThreadId=${input.externalThreadId}, channelId=${input.channelId}, provider=${input.externalProvider || 'discord'}`);

        // Find a candidate parent (either the root starter or a reply in the same thread)
        const parentCandidate = await db.query<{ id: string, parent_id: string | null, external_thread_id: string | null, external_message_id: string | null, external_provider: string | null }>(
          `select id, parent_id, external_thread_id, external_message_id, external_provider from chat_messages 
           where (external_thread_id = $1 or external_message_id = $1) 
           and (external_provider = $2 or external_provider is null)
           order by created_at asc limit 1`,
          [input.externalThreadId, input.externalProvider || 'discord']
        );

        const firstMatch = parentCandidate.rows[0];
        if (firstMatch) {
          console.log(`[Bridge] Linkage SUCCESS: Found candidate match ${firstMatch.id}`);
          console.log(`[Bridge] Match Details: msg_id=${firstMatch.external_message_id}, thread_id=${firstMatch.external_thread_id}, provider=${firstMatch.external_provider}`);

          let root: { id: string; parent_id: string | null } = { id: firstMatch.id, parent_id: firstMatch.parent_id };
          let depth = 0;
          while (root.parent_id && depth < 10) {
            const upRow = await db.query<{ id: string, parent_id: string | null }>(
              "select id, parent_id from chat_messages where id = $1 limit 1",
              [root.parent_id]
            );
            const parent = upRow.rows[0];
            if (parent) {
              root = { id: parent.id, parent_id: parent.parent_id };
              depth++;
            } else {
              break;
            }
          }
          input.parentId = root.id;
          console.log(`[Bridge] Final Parent ID: ${input.parentId} (traversal depth: ${depth})`);
        } else {
          console.warn(`[Bridge] Linkage FAILURE: Failed to find parent for external ID ${input.externalThreadId}`);

          // Debug: Dump recent messages in this channel to see what we DO have
          const recent = await db.query<{ id: string, external_message_id: string | null, external_thread_id: string | null, external_provider: string | null }>(
            "select id, external_message_id, external_thread_id, external_provider from chat_messages where channel_id = $1 order by created_at desc limit 5",
            [input.channelId]
          );
          console.log(`[Bridge] Diagnostic - Recent messages in ${input.channelId}:`, JSON.stringify(recent.rows, null, 2));
        }
        console.log(`[Bridge] Parent Linkage Diagnostic - End`);
      }

      const embeds = await processMessageContentForLinks(input.content);

      const created = await db.query<ChatMessageRow>(
        `insert into chat_messages(
            id, channel_id, author_user_id, author_display_name, content, attachments, embeds, is_relay,
            external_author_id, external_provider, external_author_name, external_author_avatar_url,
            parent_id, external_thread_id, external_message_id
          )
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning * `,
        [
          `msg_${crypto.randomUUID().replaceAll("-", "")} `,
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
          input.externalThreadId ?? null,
          input.externalMessageId ?? null
        ]
      );


      const row = created.rows[0];
      if (!row) {
        throw new Error("Message was not created.");
      }

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


      const mentionHandles = [...new Set((input.content.match(/@([a-zA-Z0-9._-]{3,40})/g) ?? []).map((token) => token.slice(1).toLowerCase()))];
      if (mentionHandles.length > 0) {
        const mentionRows = await db.query<{ product_user_id: string }>(
          `select distinct product_user_id
         from identity_mappings
         where lower(preferred_username) = any($1:: text[])`,
          [mentionHandles]
        );

        for (const mentioned of mentionRows.rows) {
          if (!mentioned.product_user_id || mentioned.product_user_id === input.actorUserId) {
            continue;
          }

          await db.query(
            `insert into mention_markers(id, channel_id, message_id, mentioned_user_id)
        values($1, $2, $3, $4)`,
            [
              `mm_${crypto.randomUUID().replaceAll("-", "")} `,
              input.channelId,
              message.id,
              mentioned.product_user_id
            ]
          );
        }
      }
      // Outbound Discord Relay Logic
      if (!row.is_relay) {
        try {
          const { listDiscordChannelMappings } = await import("./discord-bridge-service.js");
          const { relayMatrixMessageToDiscord } = await import("./discord-bot-client.js");

          // We need to find which server this channel belongs to
          const channelRow = await db.query<{ server_id: string }>(
            "select server_id from channels where id = $1 limit 1",
            [input.channelId]
          );
          const serverId = channelRow.rows[0]?.server_id;

          if (serverId) {
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
                messageId: row.id // Pass the persisted message ID
              });
            }
          }
        } catch (error) {
          console.error("Failed to relay message to Discord:", error);
        }
      }

      return message;
    } catch (e) {
      console.error("CREATE_MESSAGE_ERROR", e);
      throw e;
    }
  });
}

export async function getOrCreateDMChannel(hubId: string, productUserIds: string[]): Promise<Channel> {
  return withDb(async (db) => {
    const dmSrvRow = await db.query<{ id: string }>(
      "select id from servers where hub_id = $1 and type = 'dm' limit 1",
      [hubId]
    );
    let dmServerId = dmSrvRow.rows[0]?.id;

    if (!dmServerId) {
      dmServerId = `srv_${crypto.randomUUID().replaceAll("-", "")}`;
      await db.query(
        "insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id, privacy_tier, auto_join_hub_members) values ($1, $2, $3, $4, $5, $6, 'hidden', false)",
        [dmServerId, hubId, "Direct Messages", "dm", productUserIds[0], productUserIds[0]]
      );
    }

    const sortedUserIds = [...new Set(productUserIds)].sort();
    const existingRow = await db.query<{ id: string }>(
      `select ch.id
       from channels ch
       join channel_members cm on cm.channel_id = ch.id
       where ch.server_id = $1 and ch.type = 'dm'
       group by ch.id
       having count(cm.product_user_id) = $2
          and array_agg(cm.product_user_id order by cm.product_user_id) = $3::text[]`,
      [dmServerId, sortedUserIds.length, sortedUserIds]
    );

    if (existingRow.rows[0]) {
      const channelId = existingRow.rows[0].id;
      const chRow = await db.query<ChannelRow>("select * from channels where id = $1", [channelId]);
      const channel = mapChannel(chRow.rows[0]!);

      const memberRows = await db.query<{
        product_user_id: string;
        display_name: string;
      }>(
        `select cm.product_user_id,
          coalesce(
            (select preferred_username 
              from identity_mappings 
              where product_user_id = cm.product_user_id 
              order by (preferred_username is not null) desc, updated_at desc, created_at asc 
              limit 1),
          'user-' || substr(cm.product_user_id, 1, 8)
           ) as display_name
         from channel_members cm
         where cm.channel_id = $1`,
        [channelId]
      );
      channel.participants = memberRows.rows.map(r => ({
        productUserId: r.product_user_id,
        displayName: r.display_name
      }));

      return channel;
    }

    const channelId = `chn_${crypto.randomUUID().replaceAll("-", "")}`;
    const name = `DM: ${sortedUserIds.length} members`;
    await db.query(
      "insert into channels (id, server_id, name, type, topic, privacy_tier) values ($1, $2, $3, 'dm', null, 'hidden')",
      [channelId, dmServerId, name]
    );

    for (const userId of sortedUserIds) {
      await db.query(
        "insert into channel_members (channel_id, product_user_id) values ($1, $2)",
        [channelId, userId]
      );
    }

    const chRow = await db.query<ChannelRow>("select * from channels where id = $1", [channelId]);
    const channel = mapChannel(chRow.rows[0]!);

    const memberRows = await db.query<{
      product_user_id: string;
      display_name: string;
    }>(
      `select cm.product_user_id,
    coalesce(
      (select preferred_username 
            from identity_mappings 
            where product_user_id = cm.product_user_id 
            order by(preferred_username is not null) desc, updated_at desc, created_at asc 
            limit 1),
    'user-' || substr(cm.product_user_id, 1, 8)
         ) as display_name
       from channel_members cm
       where cm.channel_id = $1`,
      [channelId]
    );
    channel.participants = memberRows.rows.map(r => ({
      productUserId: r.product_user_id,
      displayName: r.display_name
    }));

    return channel;
  });
}

export async function listChannelReadStates(input: {
  productUserId: string;
  serverId: string;
}): Promise<ChannelReadState[]> {
  return withDb(async (db) => {
    const rows = await db.query<{
      channel_id: string;
      product_user_id: string;
      last_read_at: string;
      is_muted: boolean;
      notification_preference: "all" | "mentions" | "none";
      updated_at: string;
    }>(
      `select rs.channel_id, rs.product_user_id, rs.last_read_at, rs.is_muted, rs.notification_preference, rs.updated_at
       from channel_read_states rs
       join channels ch on ch.id = rs.channel_id
       where rs.product_user_id = $1 and ch.server_id = $2
       order by rs.updated_at desc`,
      [input.productUserId, input.serverId]
    );

    return rows.rows.map((row) => ({
      channelId: row.channel_id,
      userId: row.product_user_id,
      lastReadAt: row.last_read_at,
      isMuted: row.is_muted,
      notificationPreference: row.notification_preference,
      updatedAt: row.updated_at
    }));
  });
}

export async function upsertChannelReadState(input: {
  productUserId: string;
  channelId: string;
  at?: string;
  isMuted?: boolean;
  notificationPreference?: "all" | "mentions" | "none";
}): Promise<ChannelReadState> {
  return withDb(async (db) => {
    const rows = await db.query<{
      channel_id: string;
      product_user_id: string;
      last_read_at: string;
      is_muted: boolean;
      notification_preference: "all" | "mentions" | "none";
      updated_at: string;
    }>(
      `insert into channel_read_states(product_user_id, channel_id, last_read_at, is_muted, notification_preference)
  values($1, $2, coalesce($3:: timestamptz, now()), coalesce($4, false), coalesce($5, 'all'))
       on conflict(product_user_id, channel_id)
  do update set 
    last_read_at = case when excluded.last_read_at is not null then excluded.last_read_at else channel_read_states.last_read_at end,
    is_muted = coalesce(excluded.is_muted, channel_read_states.is_muted),
    notification_preference = coalesce(excluded.notification_preference, channel_read_states.notification_preference),
    updated_at = now()
       returning channel_id, product_user_id, last_read_at, is_muted, notification_preference, updated_at`,
      [input.productUserId, input.channelId, input.at ?? null, input.isMuted ?? null, input.notificationPreference ?? null]
    );

    const row = rows.rows[0];
    if (!row) {
      throw new Error("Read state was not updated.");
    }

    return {
      channelId: row.channel_id,
      userId: row.product_user_id,
      lastReadAt: row.last_read_at,
      isMuted: row.is_muted,
      notificationPreference: row.notification_preference,
      updatedAt: row.updated_at
    };
  });
}

export async function listMentionMarkers(input: {
  productUserId: string;
  channelId?: string;
  serverId?: string;
  limit?: number;
}): Promise<MentionMarker[]> {
  return withDb(async (db) => {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 300);
    const rows = await db.query<{
      id: string;
      channel_id: string;
      message_id: string;
      mentioned_user_id: string;
      created_at: string;
    }>(
      `select mm.id, mm.channel_id, mm.message_id, mm.mentioned_user_id, mm.created_at
       from mention_markers mm
       join channels ch on ch.id = mm.channel_id
       left join channel_read_states rs
         on rs.channel_id = mm.channel_id
        and rs.product_user_id = mm.mentioned_user_id
       where mm.mentioned_user_id = $1
  and($2:: text is null or mm.channel_id = $2)
  and($3:: text is null or ch.server_id = $3)
  and(rs.last_read_at is null or mm.created_at > rs.last_read_at)
       order by mm.created_at desc
       limit $4`,
      [input.productUserId, input.channelId ?? null, input.serverId ?? null, limit]
    );

    return rows.rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      messageId: row.message_id,
      mentionedUserId: row.mentioned_user_id,
      createdAt: row.created_at
    }));
  });
}

export async function createCategory(input: {
  serverId: string;
  name: string;
}): Promise<Category> {
  return withDb(async (db) => {
    const row = await db.query<CategoryRow>(
      `insert into categories(id, server_id, name, matrix_subspace_id)
  values($1, $2, $3, null)
  returning * `,
      [`cat_${crypto.randomUUID().replaceAll("-", "")} `, input.serverId, input.name]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Category was not created.");
    }

    return mapCategory(value);
  });
}

export async function updateCategory(input: {
  categoryId: string;
  serverId: string;
  name?: string;
  position?: number;
}): Promise<Category> {
  return withDb(async (db) => {
    const row = await db.query<CategoryRow>(
      `update categories
       set name = coalesce($1, name),
    position = coalesce($2, position)
       where id = $3 and server_id = $4
  returning * `,
      [input.name ?? null, input.position ?? null, input.categoryId, input.serverId]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Category not found.");
    }

    return mapCategory(value);
  });
}

export async function renameCategory(input: {
  categoryId: string;
  serverId: string;
  name: string;
}): Promise<Category> {
  return updateCategory(input);
}

export async function deleteCategory(input: { categoryId: string; serverId: string }): Promise<void> {
  await withDb(async (db) => {
    await db.query("begin");
    try {
      // First, move all channels in this category to null category (uncategorized)
      await db.query(
        "update channels set category_id = null where category_id = $1 and server_id = $2",
        [input.categoryId, input.serverId]
      );

      const deleted = await db.query(
        "delete from categories where id = $1 and server_id = $2 returning id",
        [input.categoryId, input.serverId]
      );

      if (deleted.rowCount === 0) {
        throw new Error("Category not found.");
      }

      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

export async function updateChannel(input: {
  channelId: string;
  serverId: string;
  name?: string;
  type?: Channel["type"];
  categoryId?: string | null;
  topic?: string | null;
  position?: number;
}): Promise<Channel> {
  return withDb(async (db) => {
    if (input.categoryId) {
      const category = await db.query<{ id: string }>(
        "select id from categories where id = $1 and server_id = $2 limit 1",
        [input.categoryId, input.serverId]
      );
      if (!category.rows[0]) {
        throw new Error("Category not found for server.");
      }
    }

    const row = await db.query<ChannelRow>(
      `update channels
       set name = coalesce($1, name),
    type = coalesce($2, type),
    category_id = case when $3 = 'REMOVED_VAL' then null else coalesce($4, category_id) end,
      position = coalesce($5, position),
      topic = case when $8 = 'REMOVED_VAL' then null else coalesce($9, topic) end
       where id = $6 and server_id = $7
  returning * `,
      [
        input.name ?? null,
        input.type ?? null,
        input.categoryId === null ? "REMOVED_VAL" : "NORMAL",
        input.categoryId ?? null,
        input.position ?? null,
        input.channelId,
        input.serverId,
        input.topic === null ? "REMOVED_VAL" : "NORMAL",
        input.topic ?? null
      ]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Channel not found.");
    }

    return mapChannel(value);
  });
}

export async function moveChannelToCategory(input: {
  channelId: string;
  serverId: string;
  categoryId: string | null;
}): Promise<Channel> {
  return updateChannel(input);
}

export async function renameServer(input: { serverId: string; name: string }): Promise<Server> {
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      hub_id: string;
      name: string;
      matrix_space_id: string | null;
      icon_url: string | null;
      type: "default" | "dm";
      hub_admin_access: string;
      space_member_access: string;
      hub_member_access: string;
      visitor_access: string;
      auto_join_hub_members: boolean;
      created_by_user_id: string;
      owner_user_id: string;
      created_at: string;
    }>(
      `update servers
       set name = $1
       where id = $2
  returning * `,
      [input.name, input.serverId]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Server not found.");
    }

    return {
      id: value.id,
      hubId: value.hub_id,
      name: value.name,
      type: value.type,
      matrixSpaceId: value.matrix_space_id,
      iconUrl: value.icon_url,
      hubAdminAccess: value.hub_admin_access as any,
      spaceMemberAccess: value.space_member_access as any,
      hubMemberAccess: value.hub_member_access as any,
      visitorAccess: value.visitor_access as any,
      autoJoinHubMembers: value.auto_join_hub_members,
      createdByUserId: value.created_by_user_id,
      ownerUserId: value.owner_user_id,
      createdAt: value.created_at
    };
  });
}

export async function deleteServer(serverId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query("begin");
    try {
      const channelIds = await db.query<{ id: string }>(
        "select id from channels where server_id = $1",
        [serverId]
      );
      const ids = channelIds.rows.map((row) => row.id);

      if (ids.length > 0) {
        await db.query("delete from role_bindings where channel_id = any($1::text[])", [ids]);
        await db.query("delete from chat_messages where channel_id = any($1::text[])", [ids]);
      }

      await db.query("delete from role_bindings where server_id = $1", [serverId]);
      await db.query("delete from channels where server_id = $1", [serverId]);
      await db.query("delete from categories where server_id = $1", [serverId]);

      const deleted = await db.query("delete from servers where id = $1 returning id", [serverId]);
      if (deleted.rowCount === 0) {
        throw new Error("Server not found.");
      }

      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

export async function renameChannel(input: {
  channelId: string;
  serverId: string;
  name: string;
}): Promise<Channel> {
  return updateChannel(input);
}

export async function updateChannelVideoControls(input: {
  channelId: string;
  serverId: string;
  videoEnabled: boolean;
  maxVideoParticipants?: number;
}): Promise<Channel> {
  return withDb(async (db) => {
    const row = await db.query<ChannelRow>(
      `update channels
       set video_enabled = $3,
    video_max_participants = $4
       where id = $1 and server_id = $2 and type = 'voice'
  returning * `,
      [input.channelId, input.serverId, input.videoEnabled, input.maxVideoParticipants ?? null]
    );

    const updated = row.rows[0];
    if (!updated) {
      throw new Error("Voice channel not found.");
    }
    return mapChannel(updated);
  });
}

export async function listChannelMembers(channelId: string, viewerUserId?: string): Promise<{
  productUserId: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  lastSeenAt?: string;
  isBridged?: boolean;
  bridgedUserStatus?: string;
}[]> {
  return withDb(async (db) => {
    // 1. Get channel info and server type
    const chRow = await db.query<{ server_id: string, type: string }>(
      "select server_id, type from channels where id = $1",
      [channelId]
    );
    const channel = chRow.rows[0];
    if (!channel) return [];

    const serverRow = await db.query<{ type: string, owner_user_id: string, hub_id: string }>(
      "select type, owner_user_id, hub_id from servers where id = $1",
      [channel.server_id]
    );
    const server = serverRow.rows[0];
    if (!server) return [];

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

    // --- GROUP 1 & 3: Local Users ---
    // A user is "allowed" if they have any role in the hub/server/channel,
    // are the hub or server owner, or are an explicit channel member (DMs).
    let localProductUserIds: string[] = [];
    let membersRow;
    if (channel.type === "dm") {
      membersRow = await db.query<{ product_user_id: string }>(
        `select product_user_id from channel_members where channel_id = $1`,
        [channelId]
      );
    } else {
      membersRow = await db.query<{ product_user_id: string }>(
        `select distinct product_user_id from role_bindings where server_id = $1 or channel_id = $2 or hub_id = $3
  union
         select owner_user_id from servers where id = $1
  union
         select owner_user_id from hubs where id = $3
  union
         select product_user_id from channel_members where channel_id = $2
  union
         select author_user_id from chat_messages
           where channel_id = $2
             and is_relay = false
  and(external_provider is null or external_provider = '')
             and author_user_id not like 'discord_%'
  union
         select distinct product_user_id from identity_mappings where product_user_id is not null`,
        [channel.server_id, channelId, server.hub_id]
      );
    }
    const members = membersRow;
    localProductUserIds = members.rows.map(m => m.product_user_id).filter(Boolean);
    // Always include the viewing user (they may have no roles yet)
    if (viewerUserId && !localProductUserIds.includes(viewerUserId)) {
      localProductUserIds.push(viewerUserId);
    }
    console.log(`[Presence Debug] Channel ${channelId}: found ${localProductUserIds.length} local product user IDs`);

    // Fetch local user details and presence
    const localUserRows = await db.query<{
      product_user_id: string;
      preferred_username: string | null;
      email: string | null;
      avatar_url: string | null;
      last_seen_at: string | null;
    }>(
      `select distinct on(im.product_user_id)
  im.product_user_id, im.preferred_username, im.email, im.avatar_url, up.last_seen_at
       from identity_mappings im
       left join user_presence up on up.product_user_id = im.product_user_id
       where im.product_user_id = any($1)
       order by im.product_user_id, (preferred_username is not null) desc, im.updated_at desc, im.created_at asc`,
      [localProductUserIds]
    );

    type Member = {
      productUserId: string;
      displayName: string;
      avatarUrl?: string;
      isOnline: boolean;
      lastSeenAt?: string;
      isBridged?: boolean;
      bridgedUserStatus?: string;
    };

    const localMembers: Member[] = localUserRows.rows.map(r => ({
      productUserId: r.product_user_id,
      displayName: r.preferred_username ?? r.email?.split('@')[0] ?? `user - ${r.product_user_id.slice(0, 8)} `,
      avatarUrl: r.avatar_url ?? undefined,
      isOnline: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime() < ONLINE_THRESHOLD_MS) : false,
      lastSeenAt: r.last_seen_at ?? undefined,
      isBridged: false
    }));
    console.log(`[Presence Debug] Resolved ${localMembers.length} local member profiles`);

    // --- GROUP 2 & 4: Bridged / External Users ---
    const { listDiscordChannelMappings } = await import("./discord-bridge-service.js");
    const { getDiscordGuildPresence } = await import("./discord-bot-client.js");

    const mappings = await listDiscordChannelMappings(channel.server_id);
    const mapping = mappings.find(m => m.matrixChannelId === channelId && m.enabled);

    let bridgedMembers: Member[] = [];
    let externalOfflineMembers: Member[] = [];

    // Always build the Discord→local account map so G4 works even without an active bridge
    const discordAuthMappings = await db.query<{ product_user_id: string, oidc_subject: string }>(
      "select product_user_id, oidc_subject from identity_mappings where provider = 'discord'",
      []
    );
    const discordToLocal = new Map(discordAuthMappings.rows.map(r => [r.oidc_subject, r.product_user_id]));
    const localToDiscord = new Map(discordAuthMappings.rows.map(r => [r.product_user_id, r.oidc_subject]));

    if (mapping) {
      try {
        const discordPresences = await getDiscordGuildPresence(mapping.guildId);

        // Merge Discord presence and nicknames into local users who are linked
        for (const member of localMembers) {
          const discordId = localToDiscord.get(member.productUserId);
          if (discordId) {
            const dp = discordPresences[discordId];
            if (dp) {
              // Always respect the guild nickname if available in the bridge cache
              if (dp.displayName) {
                member.displayName = dp.displayName;
              }

              if (dp.status !== 'offline') {
                // If they were offline locally, they become "online" via the bridge
                // and we show their specific Discord status and the "Bridged" badge.
                if (!member.isOnline) {
                  member.isOnline = true;
                  member.isBridged = true;
                  member.bridgedUserStatus = dp.status;
                }
              }
            }
          }
        }

        // Group 2: Online on Discord AND not mapped to any local account
        for (const [discordId, p] of Object.entries(discordPresences)) {
          if (p.status === 'offline') continue;
          // If this Discord user has a local product account, skip them — they
          // will already appear (or not) in the local groups.
          if (discordToLocal.has(discordId)) continue;

          bridgedMembers.push({
            productUserId: `discord_${discordId} `,
            displayName: p.displayName || p.username,
            avatarUrl: p.avatarUrl ?? undefined,
            isOnline: true,
            bridgedUserStatus: p.status,
            isBridged: true
          });
        }
      } catch (err) {
        console.error(`[Presence Debug] Failed to fetch Discord guild presence for ${mapping.guildId}: `, err);
      }
    }

    // Group 4: Offline Discord-only participants who have spoken in this channel.
    // Runs regardless of whether the bridge is currently active.
    const pastParticipants = await db.query<{
      external_author_id: string | null;
      author_user_id: string;
      author_display_name: string;
      external_author_name: string | null;
      external_author_avatar_url: string | null;
    }>(
      `select distinct on(coalesce(external_author_id, author_user_id))
  external_author_id, author_user_id, author_display_name, external_author_name, external_author_avatar_url
       from chat_messages
       where channel_id = $1
  and(external_provider = 'discord' or(author_user_id like 'discord_%' and is_relay = true))
       order by coalesce(external_author_id, author_user_id), created_at desc`,
      [channelId]
    );

    for (const row of pastParticipants.rows) {
      const discordId = row.external_author_id ?? row.author_user_id.replace('discord_', '');
      // Skip if this Discord user has a local product account (they're in G1/G3)
      if (discordToLocal.has(discordId)) continue;
      // Skip if already in Group 2 (online bridged)
      if (bridgedMembers.find(m => m.productUserId === `discord_${discordId} `)) continue;

      externalOfflineMembers.push({
        productUserId: `discord_${discordId} `,
        displayName: row.external_author_name ?? row.author_display_name,
        avatarUrl: row.external_author_avatar_url ?? undefined,
        isOnline: false,
        isBridged: true,
        bridgedUserStatus: 'offline'
      });
    }
    console.log(`[Presence Debug] Found ${externalOfflineMembers.length} offline Discord - only participants`);

    // Final Assembly with 4-tier Ordering
    const group1 = localMembers.filter(m => m.isOnline);
    const group2 = bridgedMembers;
    const group3 = localMembers.filter(m => !m.isOnline && !bridgedMembers.find(bm => bm.productUserId === m.productUserId));
    const group4 = externalOfflineMembers;

    console.log(`[Presence Debug] Final counts - G1: ${group1.length}, G2: ${group2.length}, G3: ${group3.length}, G4: ${group4.length} `);

    return [...group1, ...group2, ...group3, ...group4];
  });
}

export async function inviteToChannel(channelId: string, productUserId: string): Promise<void> {
  await withDb(async (db) => {
    // 1. Check if channel exists and get Matrix room ID
    const chRow = await db.query<{ matrix_room_id: string | null }>(
      "select matrix_room_id from channels where id = $1 limit 1",
      [channelId]
    );
    if (!chRow.rows[0]) {
      throw new Error("Channel not found.");
    }

    // 2. Add to channel_members in DB
    await db.query(
      "insert into channel_members (channel_id, product_user_id) values ($1, $2) on conflict do nothing",
      [channelId, productUserId]
    );

    // 3. Matrix invite if room ID exists
    const matrixRoomId = chRow.rows[0].matrix_room_id;
    if (matrixRoomId) {
      const { inviteUser } = await import("../matrix/synapse-adapter.js");
      const { getIdentityByProductUserId } = await import("./identity-service.js");
      const identity = await getIdentityByProductUserId(productUserId);

      // If the user has a matrix ID, invite them. 
      // In a real scenario, we might need more logic or mapping.
      if (identity?.matrixUserId) {
        await inviteUser({ roomId: matrixRoomId, userId: identity.matrixUserId });
      }
    }
  });
}

export async function deleteChannel(input: { channelId: string; serverId: string }): Promise<void> {
  await withDb(async (db) => {
    await db.query("begin");
    try {
      await db.query("delete from role_bindings where channel_id = $1", [input.channelId]);
      await db.query("delete from chat_messages where channel_id = $1", [input.channelId]);
      const deleted = await db.query(
        "delete from channels where id = $1 and server_id = $2 returning id",
        [input.channelId, input.serverId]
      );

      if (deleted.rowCount === 0) {
        throw new Error("Channel not found.");
      }

      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

export async function getUnreadSummary(productUserId: string): Promise<Record<string, { unreadCount: number; mentionCount: number }>> {
  return withDb(async (db) => {
    // 1. Get unread message counts per channel
    // Joined with channel_read_states to compare message creation time with last read time.
    const messageCounts = await db.query<{ channel_id: string; unread_count: number }>(
      `select ch.id as channel_id,
    (case when coalesce(rs.is_muted, false) then 0 else count(msg.id) end) as unread_count
       from channels ch
       join chat_messages msg on msg.channel_id = ch.id
       left join channel_read_states rs on rs.channel_id = ch.id and rs.product_user_id = $1
       where msg.author_user_id != $1 and(rs.last_read_at is null or msg.created_at > rs.last_read_at)
       group by ch.id, rs.is_muted`,
      [productUserId]
    );

    // 2. Get unread mention counts per channel
    // Uses the same logic: mentions created after the last read timestamp.
    const mentionCounts = await db.query<{ channel_id: string; mention_count: number }>(
      `select mm.channel_id, count(mm.id) as mention_count
       from mention_markers mm
       left join channel_read_states rs on rs.channel_id = mm.channel_id and rs.product_user_id = $1
       where mm.mentioned_user_id = $1
  and(rs.last_read_at is null or mm.created_at > rs.last_read_at)
       group by mm.channel_id`,
      [productUserId]
    );

    const summary: Record<string, { unreadCount: number; mentionCount: number; isMuted: boolean }> = {};
    const mutedStatusRows = await db.query<{ channel_id: string; is_muted: boolean }>(
      "select channel_id, is_muted from channel_read_states where product_user_id = $1",
      [productUserId]
    );
    const muteMap: Record<string, boolean> = {};
    for (const row of mutedStatusRows.rows) {
      muteMap[row.channel_id] = row.is_muted;
    }

    for (const row of messageCounts.rows) {
      summary[row.channel_id] = {
        unreadCount: Number(row.unread_count),
        mentionCount: 0,
        isMuted: muteMap[row.channel_id] ?? false
      };
    }

    for (const row of mentionCounts.rows) {
      if (!summary[row.channel_id]) {
        summary[row.channel_id] = {
          unreadCount: 0,
          mentionCount: 0,
          isMuted: muteMap[row.channel_id] ?? false
        };
      }
      summary[row.channel_id]!.mentionCount = Number(row.mention_count);
    }

    return summary;
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
      `update chat_messages
       set content = $1, embeds = $4, updated_at = now()
       where id = $2 and author_user_id = $3
  returning * `,
      [input.content, input.messageId, input.actorUserId, JSON.stringify(embeds)]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Message not found or not authored by user.");
    }

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
    if (result.rowCount === 0) {
      throw new Error("Message not found or permission denied.");
    }
  });
}

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
      [`react_${crypto.randomUUID().replaceAll("-", "")} `, input.messageId, input.userId, input.emoji]
    );
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
  });
}
export async function listServerMembers(serverId: string): Promise<{
  productUserId: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  isBridged?: boolean;
  bridgedUserStatus?: string;
}[]> {
  return withDb(async (db) => {
    const serverRow = await db.query<{ hub_id: string }>(
      "select hub_id from servers where id = $1",
      [serverId]
    );
    const server = serverRow.rows[0];
    if (!server) return [];

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

    // 1. Local Members
    const members = await db.query<{ product_user_id: string }>(
      `select distinct product_user_id from role_bindings where server_id = $1 or hub_id = $2
  union
       select owner_user_id from servers where id = $1
  union
       select distinct product_user_id from identity_mappings where product_user_id is not null`,
      [serverId, server.hub_id]
    );
    const localProductUserIds = members.rows.map(m => m.product_user_id).filter(Boolean);

    const localUserRows = await db.query<{
      product_user_id: string;
      preferred_username: string | null;
      email: string | null;
      avatar_url: string | null;
      last_seen_at: string | null;
    }>(
      `select distinct on(im.product_user_id)
  im.product_user_id, im.preferred_username, im.email, im.avatar_url, up.last_seen_at
       from identity_mappings im
       left join user_presence up on up.product_user_id = im.product_user_id
       where im.product_user_id = any($1)
       order by im.product_user_id, (preferred_username is not null) desc, im.updated_at desc`,
      [localProductUserIds]
    );

    const localMembers = localUserRows.rows.map(r => ({
      productUserId: r.product_user_id,
      displayName: r.preferred_username ?? r.email?.split('@')[0] ?? `user - ${r.product_user_id.slice(0, 8)} `,
      avatarUrl: r.avatar_url ?? undefined,
      isOnline: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime() < ONLINE_THRESHOLD_MS) : false,
      isBridged: false
    }));

    // 2. Bridged Members
    const { getDiscordBridgeConnection } = await import("./discord-bridge-service.js");
    const { getDiscordBotClient } = await import("./discord-bot-client.js");

    const connection = await getDiscordBridgeConnection(serverId);
    let bridgedMembers: {
      productUserId: string;
      displayName: string;
      avatarUrl?: string;
      isOnline: boolean;
      isBridged: boolean;
      bridgedUserStatus?: string;
    }[] = [];

    if (connection && connection.guildId && connection.status === "connected") {
      const client = getDiscordBotClient();
      if (client && client.isReady()) {
        try {
          const guild = await client.guilds.fetch(connection.guildId);
          // Fetch ALL members
          const members = await guild.members.fetch({ withPresences: true });

          const discordAuthMappings = await db.query<{ product_user_id: string, oidc_subject: string }>(
            "select product_user_id, oidc_subject from identity_mappings where provider = 'discord'",
            []
          );
          const discordToLocal = new Map(discordAuthMappings.rows.map(r => [r.oidc_subject, r.product_user_id]));

          for (const [id, member] of members) {
            // Skip if already mapped to local account
            if (discordToLocal.has(id)) continue;

            bridgedMembers.push({
              productUserId: `discord_${id} `,
              displayName: member.displayName,
              avatarUrl: member.user.displayAvatarURL() ?? undefined,
              isOnline: member.presence?.status ? member.presence.status !== "offline" : false,
              isBridged: true,
              bridgedUserStatus: member.presence?.status ?? "offline"
            });
          }
        } catch (error) {
          console.error("Failed to fetch Discord members for Space list:", error);
        }
      }
    }

    return [...localMembers, ...bridgedMembers];
  });
}

export async function pinMessage(input: { messageId: string; actorUserId: string }): Promise<ChatMessage> {
  return withDb(async (db) => {
    const res = await db.query(
      "update chat_messages set is_pinned = true, updated_at = now() where id = $1 returning *",
      [input.messageId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Message not found");

    const msg = await fetchMessage(row.channel_id, row.id, input.actorUserId);
    if (!msg) throw new Error("Failed to fetch updated message");
    return msg;
  });
}

export async function unpinMessage(input: { messageId: string; actorUserId: string }): Promise<ChatMessage> {
  return withDb(async (db) => {
    const res = await db.query(
      "update chat_messages set is_pinned = false, updated_at = now() where id = $1 returning *",
      [input.messageId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Message not found");

    const msg = await fetchMessage(row.channel_id, row.id, input.actorUserId);
    if (!msg) throw new Error("Failed to fetch updated message");
    return msg;
  });
}



export async function createHubInvite(input: {
  hubId: string;
  createdByUserId: string;
  expiresAt?: string | null;
  maxUses?: number | null;
}): Promise<HubInvite> {
  return withDb(async (db) => {
    const id = `inv_${crypto.randomUUID().replaceAll("-", "")}`;
    const res = await db.query<HubInvite>(
      `insert into hub_invites (id, hub_id, created_by_user_id, expires_at, max_uses)
       values ($1, $2, $3, $4, $5)
       returning id, hub_id as "hubId", created_by_user_id as "createdByUserId", 
                 expires_at as "expiresAt", max_uses as "maxUses", 
                 uses_count as "usesCount", created_at as "createdAt"`,
      [id, input.hubId, input.createdByUserId, input.expiresAt ?? null, input.maxUses ?? null]
    );
    return res.rows[0]!;
  });
}

export async function getHubInvite(inviteId: string): Promise<HubInvite | null> {
  return withDb(async (db) => {
    const res = await db.query(
      `select id, hub_id as "hubId", created_by_user_id as "createdByUserId", 
              expires_at as "expiresAt", max_uses as "maxUses", 
              uses_count as "usesCount", created_at as "createdAt"
       from hub_invites where id = $1`,
      [inviteId]
    );
    return res.rows[0] ?? null;
  });
}

export async function useHubInvite(input: { inviteId: string; productUserId: string }): Promise<{ hubId: string }> {
  return withDb(async (db) => {
    const invite = await getHubInvite(input.inviteId);
    if (!invite) throw new Error("Invite not found");

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new Error("Invite expired");
    }
    if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) {
      throw new Error("Invite reached max uses");
    }

    // Grant role in the hub
    await db.query(
      `insert into role_bindings (id, product_user_id, role, hub_id)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      [`rb_${crypto.randomUUID().replaceAll("-", "")}`, input.productUserId, "user", invite.hubId]
    );

    // Update uses count
    await db.query("update hub_invites set uses_count = uses_count + 1 where id = $1", [input.inviteId]);

    return { hubId: invite.hubId };
  });
}
