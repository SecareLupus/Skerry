import crypto from "node:crypto";
import type { Category, Channel } from "@skerry/shared";
import { withDb } from "../../db/client.js";
import { 
  ChannelRow, 
  CategoryRow, 
  mapChannel, 
  mapCategory, 
  validateChannelStyle 
} from "./mapping-helpers.js";
import type { ScopedAuthContext } from "../../auth/middleware.js";

export async function listChannels(
  serverId: string, 
  productUserId?: string,
  authContext?: ScopedAuthContext
): Promise<Channel[]> {
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

    const isMasquerading = Boolean(authContext?.isMasquerading);
    const masqueradeRole = authContext?.masqueradeRole;
    const isAdminMasquerade = masqueradeRole && ['hub_owner', 'hub_admin', 'space_owner', 'space_admin'].includes(masqueradeRole);
    const badgeIds = isMasquerading ? (authContext?.masqueradeBadgeIds || []) : null;

    const rows = await db.query<ChannelRow>(
      `select ch.* 
       from channels ch
       join servers s on s.id = ch.server_id
       where ch.server_id = $1::text 
         and (
           ch.visitor_access != 'hidden'
           or ($4::boolean = true)
           or (
             ch.visitor_access = 'hidden' and (
               -- Masquerade check
               ($3::boolean = true and (
                 exists (select 1 from channel_badge_rules cbr where cbr.channel_id = ch.id and cbr.badge_id = any($5::text[]) and cbr.access_level != 'hidden')
                 or exists (select 1 from server_badge_rules sbr where sbr.server_id = s.id and sbr.badge_id = any($5::text[]) and sbr.access_level != 'hidden')
               ))
               -- Standard check
               or ($3::boolean = false and (
                 exists (select 1 from channel_badge_rules cbr join user_badges ub on ub.badge_id = cbr.badge_id where cbr.channel_id = ch.id and ub.product_user_id = $2::text and cbr.access_level != 'hidden')
                 or exists (select 1 from server_badge_rules sbr join user_badges ub on ub.badge_id = sbr.badge_id where sbr.server_id = s.id and ub.product_user_id = $2::text and sbr.access_level != 'hidden')
               ))
             )
           )
           or ($3::boolean = false and s.owner_user_id = $2::text)
           or ($3::boolean = false and exists (select 1 from role_bindings where (server_id = $1::text or (hub_id = s.hub_id and hub_id is not null)) and product_user_id = $2::text and role in ('hub_owner', 'hub_admin', 'space_owner')))
           or ($3::boolean = false and exists (select 1 from channel_members where channel_id = ch.id and product_user_id = $2::text))
           or (ch.hub_member_access != 'hidden' and $3::boolean = false and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $2::text))
           or (ch.space_member_access != 'hidden' and $3::boolean = false and exists (select 1 from server_members where server_id = s.id and product_user_id = $2::text))
           or ($3::boolean = false and exists (
             select 1 from space_admin_assignments saa 
             where saa.server_id = s.id 
               and saa.assigned_user_id = $2::text 
               and saa.status = 'active' 
               and (saa.expires_at is null or saa.expires_at > now())
           ))
         )
       order by ch.position asc, ch.created_at asc`,
      [serverId, productUserId ?? null, isMasquerading, isAdminMasquerade, badgeIds]
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

export async function createCategory(input: {
  serverId: string;
  name: string;
}): Promise<Category> {
  return withDb(async (db) => {
    const row = await db.query<CategoryRow>(
      `insert into categories(id, server_id, name, matrix_subspace_id)
       values($1, $2, $3, null)
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
  iconUrl?: string | null;
  styleContent?: string | null;
  position?: number;
}): Promise<Channel> {
  validateChannelStyle(input.styleContent);

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
           topic = case when $8 = 'REMOVED_VAL' then null else coalesce($9, topic) end,
           icon_url = case when $12 = 'REMOVED_VAL' then null else coalesce($13, icon_url) end,
           style_content = case when $10 = 'REMOVED_VAL' then null else coalesce($11, style_content) end
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
        input.topic ?? null,
        input.styleContent === null ? "REMOVED_VAL" : "NORMAL",
        input.styleContent ?? null,
        input.iconUrl === null ? "REMOVED_VAL" : "NORMAL",
        input.iconUrl ?? null
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

export async function renameChannel(input: {
  channelId: string;
  serverId: string;
  name: string;
}): Promise<Channel> {
  return updateChannel(input);
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

    let localProductUserIds: string[] = [];
    if (channel.type === "dm") {
      const rows = await db.query<{ product_user_id: string }>(
        `select product_user_id from channel_members where channel_id = $1`,
        [channelId]
      );
      localProductUserIds = rows.rows.map(r => r.product_user_id);
    } else {
      // Membership sources, in order of increasing specificity:
      //   1. role_bindings for management roles (hub_admin, space_owner, etc.) —
      //      these users can moderate the server even if they aren't explicit members.
      //      Exclude role='user' because that's a hub-wide binding (from invite-join)
      //      and we don't want hub members to show up in unrelated server lists.
      //   2. Server/hub owners, always visible in their own scopes.
      //   3. channel_members (for DM-style channels).
      //   4. server_members (the authoritative roster — gets cleared on kick).
      const rows = await db.query<{ product_user_id: string }>(
        `select distinct product_user_id from role_bindings
           where (server_id = $1 or channel_id = $2 or hub_id = $3)
             and role != 'user'
         union
         select owner_user_id from servers where id = $1
         union
         select owner_user_id from hubs where id = $3
         union
         select product_user_id from channel_members where channel_id = $2
         union
         select product_user_id from server_members where server_id = $1`,
        [channel.server_id, channelId, server.hub_id]
      );
      localProductUserIds = rows.rows.map(m => m.product_user_id).filter(Boolean);
    }

    if (viewerUserId && !localProductUserIds.includes(viewerUserId)) {
      localProductUserIds.push(viewerUserId);
    }

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
      displayName: r.preferred_username ?? r.email?.split('@')[0] ?? `user-${r.product_user_id.slice(0, 8)}`,
      avatarUrl: r.avatar_url ?? undefined,
      isOnline: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime() < ONLINE_THRESHOLD_MS) : false,
      lastSeenAt: r.last_seen_at ?? undefined,
      isBridged: false
    }));

    const { listDiscordChannelMappings } = await import("../discord-bridge-service.js");
    const { getDiscordGuildPresence } = await import("../discord-bot-client.js");

    const mappings = await listDiscordChannelMappings(channel.server_id);
    const mapping = mappings.find(m => m.matrixChannelId === channelId && m.enabled);

    let bridgedMembers = [];
    let externalOfflineMembers = [];

    const discordAuthMappings = await db.query<{ product_user_id: string, oidc_subject: string }>(
      "select product_user_id, oidc_subject from identity_mappings where provider = 'discord'",
      []
    );
    const discordToLocal = new Map(discordAuthMappings.rows.map(r => [r.oidc_subject, r.product_user_id]));
    const localToDiscord = new Map(discordAuthMappings.rows.map(r => [r.product_user_id, r.oidc_subject]));

    if (mapping) {
      try {
        const discordPresences = await getDiscordGuildPresence(mapping.guildId);
        for (const member of localMembers) {
          const discordId = localToDiscord.get(member.productUserId);
          if (discordId) {
            const dp = discordPresences[discordId];
            if (dp) {
              if (dp.displayName) member.displayName = dp.displayName;
              if (dp.status !== 'offline' && !member.isOnline) {
                member.isOnline = true;
                member.isBridged = true;
                (member as any).bridgedUserStatus = dp.status;
              }
            }
          }
        }

        for (const [discordId, p] of Object.entries(discordPresences)) {
          if (p.status === 'offline') continue;
          if (discordToLocal.has(discordId)) continue;

          bridgedMembers.push({
            productUserId: `discord_${discordId}`,
            displayName: p.displayName || p.username,
            avatarUrl: p.avatarUrl ?? undefined,
            isOnline: true,
            bridgedUserStatus: p.status,
            isBridged: true
          });
        }
      } catch (err) {
        console.error(`Status check failed for Discord guild ${mapping.guildId}:`, err);
      }
    }

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
         and (external_provider = 'discord' or (author_user_id like 'discord_%' and is_relay = true))
       order by coalesce(external_author_id, author_user_id), created_at desc`,
      [channelId]
    );

    for (const row of pastParticipants.rows) {
      const discordId = row.external_author_id ?? row.author_user_id.replace('discord_', '');
      if (discordToLocal.has(discordId)) continue;
      if (bridgedMembers.find(m => m.productUserId === `discord_${discordId}`)) continue;

      externalOfflineMembers.push({
        productUserId: `discord_${discordId}`,
        displayName: row.external_author_name ?? row.author_display_name,
        avatarUrl: row.external_author_avatar_url ?? undefined,
        isOnline: false,
        isBridged: true,
        bridgedUserStatus: 'offline'
      });
    }

    return [
      ...localMembers.filter(m => m.isOnline),
      ...bridgedMembers,
      ...localMembers.filter(m => !m.isOnline && !bridgedMembers.find(bm => bm.productUserId === m.productUserId)),
      ...externalOfflineMembers
    ];
  });
}

export async function inviteToChannel(channelId: string, productUserId: string): Promise<void> {
  await withDb(async (db) => {
    const chRow = await db.query<{ matrix_room_id: string | null }>(
      "select matrix_room_id from channels where id = $1 limit 1",
      [channelId]
    );
    if (!chRow.rows[0]) throw new Error("Channel not found.");

    await db.query(
      "insert into channel_members (channel_id, product_user_id) values ($1, $2) on conflict do nothing",
      [channelId, productUserId]
    );

    const matrixRoomId = chRow.rows[0].matrix_room_id;
    if (matrixRoomId) {
      const { inviteUser } = await import("../../matrix/synapse-adapter.js");
      const { getIdentityByProductUserId } = await import("../identity-service.js");
      const identity = await getIdentityByProductUserId(productUserId);
      if (identity?.matrixUserId) {
        await inviteUser({ roomId: matrixRoomId, userId: identity.matrixUserId });
      }
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
        "insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id, visitor_access, auto_join_hub_members) values ($1, $2, $3, $4, $5, $6, 'hidden', false)",
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
      "insert into channels (id, server_id, name, type, topic, visitor_access) values ($1, $2, $3, 'dm', null, 'hidden')",
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
      displayName: string;
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
      displayName: (r as any).display_name
    }));

    return channel;
  });
}
