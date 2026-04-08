import crypto from "node:crypto";
import type { Server, HubInvite } from "@skerry/shared";
import { withDb } from "../../db/client.js";
import { ServerRow } from "./mapping-helpers.js";
import type { ScopedAuthContext } from "../../auth/middleware.js";

export async function listServers(
  productUserId?: string, 
  hubId?: string,
  authContext?: ScopedAuthContext
): Promise<Server[]> {
  return withDb(async (db) => {
    const isMasquerading = Boolean(authContext?.isMasquerading);
    const masqueradeRole = authContext?.masqueradeRole;
    const isAdminMasquerade = masqueradeRole && ["hub_owner", "hub_admin", "space_owner", "space_admin"].includes(masqueradeRole);
    const badgeIds = isMasquerading ? (authContext?.masqueradeBadgeIds || []) : null;

    let query = `select s.*, 
              (exists (select 1 from server_members where server_id = s.id and product_user_id = $1)) as is_member
       from servers s
       where (s.type = 'dm'
          or ($3 = false and s.owner_user_id = $1)
          or ($4 = true)
          or ($3 = false and exists (select 1 from role_bindings where (hub_id = s.hub_id or hub_id is null) and product_user_id = $1 and role in ('hub_owner', 'hub_admin')))
          or (s.space_member_access != 'hidden' and $3 = false and exists (select 1 from server_members where server_id = s.id and product_user_id = $1))
          or (s.hub_member_access != 'hidden' and $3 = false and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1))
          or (s.visitor_access != 'hidden')
          or (s.visitor_access = 'hidden' and (
              ($3 = true and exists (select 1 from server_badge_rules sbr where sbr.server_id = s.id and sbr.badge_id = any($5) and sbr.access_level != 'hidden'))
              or ($3 = false and exists (select 1 from server_badge_rules sbr join user_badges ub on ub.badge_id = sbr.badge_id where sbr.server_id = s.id and ub.product_user_id = $1 and sbr.access_level != 'hidden'))
          ))
          or exists (select 1 from channels c where c.server_id = s.id and (
              c.visitor_access != 'hidden' 
              or (c.visitor_access = 'hidden' and (
                  ($3 = true and exists (select 1 from channel_badge_rules cbr where cbr.channel_id = c.id and cbr.badge_id = any($5) and cbr.access_level != 'hidden'))
                  or ($3 = false and exists (select 1 from channel_badge_rules cbr join user_badges ub on ub.badge_id = cbr.badge_id where cbr.channel_id = c.id and ub.product_user_id = $1 and cbr.access_level != 'hidden'))
              ))
              or (c.hub_member_access != 'hidden' and $3 = false and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1))
              or (c.space_member_access != 'hidden' and $3 = false and exists (select 1 from server_members where server_id = s.id and product_user_id = $1))
          ))
          or ($3 = false and exists (
            select 1 from space_admin_assignments saa 
            where saa.server_id = s.id 
              and saa.assigned_user_id = $1 
              and saa.status = 'active' 
              and (saa.expires_at is null or saa.expires_at > now())
          )))`;
          
    const params: any[] = [productUserId, hubId, isMasquerading, isAdminMasquerade, badgeIds];
    if (hubId) {
      query += ` and s.hub_id = $2`;
      params.push(hubId);
    }

    const rows = await db.query<ServerRow>(query + ` order by s.created_at asc`, params);

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
      isMember: row.is_member,
      joinPolicy: row.join_policy as any
    }));
  });
}

export async function renameServer(input: { serverId: string; name: string }): Promise<Server> {
  return withDb(async (db) => {
    const row = await db.query<ServerRow>(
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
      iconUrl: value.icon_url,
      hubAdminAccess: value.hub_admin_access as any,
      spaceMemberAccess: value.space_member_access as any,
      hubMemberAccess: value.hub_member_access as any,
      visitorAccess: value.visitor_access as any,
      autoJoinHubMembers: value.auto_join_hub_members,
      createdByUserId: value.created_by_user_id,
      ownerUserId: value.owner_user_id,
      createdAt: value.created_at,
      joinPolicy: value.join_policy as any
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
      displayName: r.preferred_username ?? r.email?.split('@')[0] ?? `user-${r.product_user_id.slice(0, 8)}`,
      avatarUrl: r.avatar_url ?? undefined,
      isOnline: r.last_seen_at ? (now - new Date(r.last_seen_at).getTime() < ONLINE_THRESHOLD_MS) : false,
      isBridged: false
    }));

    // 2. Bridged Members
    const { getDiscordBridgeConnection } = await import("../discord-bridge-service.js");
    const { getDiscordBotClient } = await import("../discord-bot-client.js");

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
          const membersResult = await guild.members.fetch({ withPresences: true });

          const discordAuthMappings = await db.query<{ product_user_id: string, oidc_subject: string }>(
            "select product_user_id, oidc_subject from identity_mappings where provider = 'discord'",
            []
          );
          const discordToLocal = new Map(discordAuthMappings.rows.map(r => [r.oidc_subject, r.product_user_id]));

          for (const [id, member] of membersResult) {
            if (discordToLocal.has(id)) continue;

            bridgedMembers.push({
              productUserId: `discord_${id}`,
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

    await db.query(
      `insert into role_bindings (id, product_user_id, role, hub_id)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      [`rb_${crypto.randomUUID().replaceAll("-", "")}`, input.productUserId, "user", invite.hubId]
    );

    await db.query("update hub_invites set uses_count = uses_count + 1 where id = $1", [input.inviteId]);

    return { hubId: invite.hubId };
  });
}
