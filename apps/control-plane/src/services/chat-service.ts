import crypto from "node:crypto";
import type { Category, Channel, ChannelReadState, ChatMessage, MentionMarker, Server } from "@skerry/shared";
import { withDb } from "../db/client.js";

interface ChannelRow {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  type: Channel["type"];
  matrix_room_id: string | null;
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

export async function listServers(): Promise<Server[]> {
  return withDb(async (db) => {
    const rows = await db.query<{
      id: string;
      hub_id: string;
      name: string;
      type: "default" | "dm";
      matrix_space_id: string | null;
      created_by_user_id: string;
      owner_user_id: string;
      created_at: string;
    }>("select * from servers order by created_at asc");

    return rows.rows.map((row) => ({
      id: row.id,
      hubId: row.hub_id,
      name: row.name,
      type: row.type || "default",
      matrixSpaceId: row.matrix_space_id,
      createdByUserId: row.created_by_user_id,
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at
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
      "select * from channels where server_id = $1 order by position asc, created_at asc",
      [serverId]
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
  viewerUserId?: string;
}): Promise<ChatMessage[]> {
  return withDb(async (db) => {
    let query = `
      select * from chat_messages
      where channel_id = $1 and deleted_at is null
    `;
    const params: any[] = [input.channelId];

    if (input.viewerUserId) {
      query += ` and author_user_id not in (select blocked_user_id from user_blocks where blocker_user_id = $2)`;
      params.push(input.viewerUserId);
    }

    if (input.before) {
      query += ` and created_at < $${params.length + 1}::timestamptz`;
      params.push(input.before);
    }

    query += ` order by created_at desc limit $${params.length + 1}`;
    params.push(input.limit);

    const rows = await db.query<{
      id: string;
      channel_id: string;
      author_user_id: string;
      author_display_name: string;
      content: string;
      attachments: any;
      is_relay: boolean;
      created_at: string;
      updated_at?: string;
      deleted_at?: string;
    }>(query, params);

    const messageIds = rows.rows.map(r => r.id);
    let reactionsMap: Record<string, any[]> = {};

    if (messageIds.length > 0) {
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

    return rows.rows.reverse().map((row) => {
      const rawReactions = reactionsMap[row.id] ?? [];
      const reactionsByEmoji: Record<string, any> = {};

      for (const r of rawReactions) {
        if (!reactionsByEmoji[r.emoji]) {
          reactionsByEmoji[r.emoji] = {
            emoji: r.emoji,
            count: 0,
            me: false,
            userIds: [],
            displayNames: []
          };
        }
        reactionsByEmoji[r.emoji].count++;
        reactionsByEmoji[r.emoji].userIds.push(r.user_id);
        reactionsByEmoji[r.emoji].displayNames.push(r.display_name);
        if (input.viewerUserId && r.user_id === input.viewerUserId) {
          reactionsByEmoji[r.emoji].me = true;
        }
      }

      return {
        id: row.id,
        channelId: row.channel_id,
        authorUserId: row.author_user_id,
        authorDisplayName: row.author_display_name,
        content: row.content,
        attachments: row.attachments,
        reactions: Object.values(reactionsByEmoji),
        isRelay: row.is_relay,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at
      };
    });
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

      // Outbound Discord Relay Logic
      if (!input.isRelay) {
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
                avatarUrl
              });
            }
          }
        } catch (error) {
          // Don't block message creation if relay fails
          console.error("Failed to relay message to Discord:", error);
        }
      }

      const created = await db.query<{
        id: string;
        channel_id: string;
        author_user_id: string;
        author_display_name: string;
        content: string;
        attachments: any;
        is_relay: boolean;
        external_author_id: string | null;
        external_provider: string | null;
        external_author_name: string | null;
        external_author_avatar_url: string | null;
        created_at: string;
      }>(
        `insert into chat_messages (
          id, channel_id, author_user_id, author_display_name, content, attachments, is_relay,
          external_author_id, external_provider, external_author_name, external_author_avatar_url
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning *`,
        [
          `msg_${crypto.randomUUID().replaceAll("-", "")}`,
          input.channelId,
          input.actorUserId,
          authorDisplayName,
          input.content,
          JSON.stringify(input.attachments ?? []),
          Boolean(input.isRelay),
          input.externalAuthorId ?? null,
          input.externalProvider ?? null,
          input.externalAuthorName ?? null,
          input.externalAuthorAvatarUrl ?? null
        ]
      );

      const row = created.rows[0];
      if (!row) {
        throw new Error("Message was not created.");
      }

      const message = {
        id: row.id,
        channelId: row.channel_id,
        authorUserId: row.author_user_id,
        authorDisplayName: row.author_display_name,
        content: row.content,
        attachments: row.attachments,
        reactions: [],
        isRelay: row.is_relay,
        createdAt: row.created_at
      };

      const mentionHandles = [...new Set((input.content.match(/@([a-zA-Z0-9._-]{3,40})/g) ?? []).map((token) => token.slice(1).toLowerCase()))];
      if (mentionHandles.length > 0) {
        const mentionRows = await db.query<{ product_user_id: string }>(
          `select distinct product_user_id
         from identity_mappings
         where lower(preferred_username) = any($1::text[])`,
          [mentionHandles]
        );

        for (const mentioned of mentionRows.rows) {
          if (!mentioned.product_user_id || mentioned.product_user_id === input.actorUserId) {
            continue;
          }

          await db.query(
            `insert into mention_markers (id, channel_id, message_id, mentioned_user_id)
           values ($1, $2, $3, $4)`,
            [
              `mm_${crypto.randomUUID().replaceAll("-", "")}`,
              input.channelId,
              message.id,
              mentioned.product_user_id
            ]
          );
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
        "insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id) values ($1, $2, $3, $4, $5, $6)",
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
      "insert into channels (id, server_id, name, type, topic) values ($1, $2, $3, 'dm', null)",
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
      updated_at: string;
    }>(
      `select rs.channel_id, rs.product_user_id, rs.last_read_at, rs.updated_at
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
      updatedAt: row.updated_at
    }));
  });
}

export async function upsertChannelReadState(input: {
  productUserId: string;
  channelId: string;
  at?: string;
}): Promise<ChannelReadState> {
  return withDb(async (db) => {
    const rows = await db.query<{
      channel_id: string;
      product_user_id: string;
      last_read_at: string;
      updated_at: string;
    }>(
      `insert into channel_read_states (product_user_id, channel_id, last_read_at)
       values ($1, $2, coalesce($3::timestamptz, now()))
       on conflict (product_user_id, channel_id)
       do update set last_read_at = excluded.last_read_at, updated_at = now()
       returning channel_id, product_user_id, last_read_at, updated_at`,
      [input.productUserId, input.channelId, input.at ?? null]
    );

    const row = rows.rows[0];
    if (!row) {
      throw new Error("Read state was not updated.");
    }

    return {
      channelId: row.channel_id,
      userId: row.product_user_id,
      lastReadAt: row.last_read_at,
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
         and ($2::text is null or mm.channel_id = $2)
         and ($3::text is null or ch.server_id = $3)
         and (rs.last_read_at is null or mm.created_at > rs.last_read_at)
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
      `insert into categories (id, server_id, name, matrix_subspace_id)
       values ($1, $2, $3, null)
       returning *`,
      [`cat_${crypto.randomUUID().replaceAll("-", "")}`, input.serverId, input.name]
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
       returning *`,
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
       returning *`,
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
      type: "default" | "dm";
      created_by_user_id: string;
      owner_user_id: string;
      created_at: string;
    }>(
      `update servers
       set name = $1
       where id = $2
       returning *`,
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
       returning *`,
      [input.channelId, input.serverId, input.videoEnabled, input.maxVideoParticipants ?? null]
    );

    const updated = row.rows[0];
    if (!updated) {
      throw new Error("Voice channel not found.");
    }
    return mapChannel(updated);
  });
}

export async function listChannelMembers(channelId: string): Promise<{ 
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

    const serverRow = await db.query<{ type: string, owner_user_id: string }>(
      "select type, owner_user_id from servers where id = $1",
      [channel.server_id]
    );
    const server = serverRow.rows[0];
    if (!server) return [];

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

    // --- GROUP 1 & 3: Local Users ---
    let localProductUserIds: string[] = [];
    if (server.type === 'dm' || channel.type === 'dm') {
      const members = await db.query<{ product_user_id: string }>(
        "select product_user_id from channel_members where channel_id = $1",
        [channelId]
      );
      localProductUserIds = members.rows.map(m => m.product_user_id);
    } else {
      const members = await db.query<{ product_user_id: string }>(
        `select distinct product_user_id from role_bindings where server_id = $1 or channel_id = $2
         union
         select owner_user_id from servers where id = $3`,
        [channel.server_id, channelId, channel.server_id]
      );
      localProductUserIds = members.rows.map(m => m.product_user_id);
    }

    // Fetch local user details and presence
    const localUserRows = await db.query<{ 
      product_user_id: string; 
      preferred_username: string | null; 
      email: string | null;
      avatar_url: string | null;
      last_seen_at: string | null;
    }>(
      `select im.product_user_id, im.preferred_username, im.email, im.avatar_url, up.last_seen_at
       from (select distinct product_user_id from identity_mappings where product_user_id = any($1)) ids
       join identity_mappings im on im.product_user_id = ids.product_user_id
       left join user_presence up on up.product_user_id = im.product_user_id
       where im.id = (
         select id from identity_mappings 
         where product_user_id = im.product_user_id 
         order by (preferred_username is not null) desc, updated_at desc, created_at asc 
         limit 1
       )`,
      [localProductUserIds]
    );

    const localMembers = localUserRows.rows.map(r => ({
      productUserId: r.product_user_id,
      displayName: r.preferred_username ?? r.email?.split('@')[0] ?? `user-${r.product_user_id.slice(0, 8)}`,
      avatarUrl: r.avatar_url ?? undefined,
      isOnline: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime() < ONLINE_THRESHOLD_MS) : false,
      lastSeenAt: r.last_seen_at ?? undefined,
      isBridged: false
    }));

    // --- GROUP 2 & 4: Bridged / External Users ---
    const { listDiscordChannelMappings } = await import("./discord-bridge-service.js");
    const { getDiscordGuildPresence } = await import("./discord-bot-client.js");

    const mappings = await listDiscordChannelMappings(channel.server_id);
    const mapping = mappings.find(m => m.matrixChannelId === channelId && m.enabled);

    let bridgedMembers: typeof localMembers = [];
    let externalOfflineMembers: typeof localMembers = [];

    if (mapping) {
      const discordPresences = await getDiscordGuildPresence(mapping.guildId);
      
      // Map Discord IDs to local product user IDs
      const discordAuthMappings = await db.query<{ product_user_id: string, oidc_subject: string }>(
        "select product_user_id, oidc_subject from identity_mappings where provider = 'discord' and oidc_subject = any($1)",
        [Object.keys(discordPresences)]
      );
      const discordToLocal = new Map(discordAuthMappings.rows.map(r => [r.oidc_subject, r.product_user_id]));

      // Group 2: Logged into Discord (present via bridge) and NOT in Group 1
      for (const [discordId, p] of Object.entries(discordPresences)) {
        if (p.status === 'offline') continue;

        const localId = discordToLocal.get(discordId);
        // If they are online locally, Group 1 takes precedence
        if (localId && localMembers.find(m => m.productUserId === localId && m.isOnline)) continue;

        bridgedMembers.push({
          productUserId: localId ?? `discord_${discordId}`,
          displayName: p.username,
          avatarUrl: p.avatarUrl ?? undefined,
          isOnline: true,
          bridgedUserStatus: p.status,
          isBridged: true
        });
      }

      // Group 4: External users who posted before but are offline now
      const pastParticipants = await db.query<{ 
        external_author_id: string; 
        external_author_name: string; 
        external_author_avatar_url: string; 
      }>(
        `select distinct on (external_author_id) 
           external_author_id, external_author_name, external_author_avatar_url
         from chat_messages
         where channel_id = $1 and external_provider = 'discord' and external_author_id is not null
         order by external_author_id, created_at desc`,
        [channelId]
      );

      for (const row of pastParticipants.rows) {
        // Skip if already in Group 1 or 2
        const localId = discordToLocal.get(row.external_author_id);
        if (localId && localMembers.find(m => m.productUserId === localId)) continue;
        if (bridgedMembers.find(m => m.productUserId === (localId ?? `discord_${row.external_author_id}`))) continue;
        if (discordPresences[row.external_author_id]?.status !== 'offline') continue;

        externalOfflineMembers.push({
          productUserId: `discord_${row.external_author_id}`,
          displayName: row.external_author_name,
          avatarUrl: row.external_author_avatar_url ?? undefined,
          isOnline: false,
          isBridged: true,
          bridgedUserStatus: 'offline'
        });
      }
    }

    // Final Assembly with 4-tier Ordering
    const group1 = localMembers.filter(m => m.isOnline);
    const group2 = bridgedMembers; // already filtered for online
    const group3 = localMembers.filter(m => !m.isOnline);
    const group4 = externalOfflineMembers;

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
       where msg.author_user_id != $1 and (rs.last_read_at is null or msg.created_at > rs.last_read_at)
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
         and (rs.last_read_at is null or mm.created_at > rs.last_read_at)
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
    const result = await db.query<{
      id: string;
      channel_id: string;
      author_user_id: string;
      author_display_name: string;
      content: string;
      attachments: any;
      created_at: string;
      updated_at: string;
    }>(
      `update chat_messages
       set content = $1, updated_at = now()
       where id = $2 and author_user_id = $3
       returning *`,
      [input.content, input.messageId, input.actorUserId]
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
      attachments: row.attachments,
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
      `insert into message_reactions (id, message_id, user_id, emoji)
       values ($1, $2, $3, $4)
       on conflict (message_id, user_id, emoji) do nothing`,
      [`react_${crypto.randomUUID().replaceAll("-", "")}`, input.messageId, input.userId, input.emoji]
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
