import crypto from "node:crypto";
import type { AccessLevel, AudienceTier, Server, HubInvite } from "@skerry/shared";
import { withDb } from "../../db/client.js";
import { ServerRow } from "./mapping-helpers.js";
import type { ScopedAuthContext } from "../../auth/middleware.js";
import { joinHub } from "../membership-service.js";

type AccessRulesByResource = Map<string, Partial<Record<AudienceTier, AccessLevel>>>;

/**
 * Bulk-fetch space access rules for a list of server ids. Returns a
 * Map keyed by `server_id` whose value is a partial record from
 * audience_tier → level. Used to avoid N+1 queries when surfacing
 * the legacy `*Access` fields on `Server` responses post-P2.cleanup.
 */
export async function fetchSpaceAccessRules(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  serverIds: string[]
): Promise<AccessRulesByResource> {
  if (serverIds.length === 0) return new Map();
  const res = await db.query<{ server_id: string; audience_tier: string; level: string }>(
    `select server_id, audience_tier, level
       from space_access_rules
      where server_id = any($1::text[])`,
    [serverIds]
  );
  const map: AccessRulesByResource = new Map();
  for (const row of res.rows) {
    let entry = map.get(row.server_id);
    if (!entry) {
      entry = {};
      map.set(row.server_id, entry);
    }
    entry[row.audience_tier as AudienceTier] = row.level as AccessLevel;
  }
  return map;
}

/** Same shape as fetchSpaceAccessRules but for `channel_access_rules`. */
export async function fetchChannelAccessRules(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  channelIds: string[]
): Promise<AccessRulesByResource> {
  if (channelIds.length === 0) return new Map();
  const res = await db.query<{ channel_id: string; audience_tier: string; level: string }>(
    `select channel_id, audience_tier, level
       from channel_access_rules
      where channel_id = any($1::text[])`,
    [channelIds]
  );
  const map: AccessRulesByResource = new Map();
  for (const row of res.rows) {
    let entry = map.get(row.channel_id);
    if (!entry) {
      entry = {};
      map.set(row.channel_id, entry);
    }
    entry[row.audience_tier as AudienceTier] = row.level as AccessLevel;
  }
  return map;
}

const DEFAULT_LEVEL_BY_TIER: Record<AudienceTier, AccessLevel> = {
  visitor: "hidden",
  hub_member: "chat",
  space_member: "chat",
  space_moderator: "chat",
  space_admin: "chat",
  hub_admin: "chat"
};

function tierLevel(
  rules: Partial<Record<AudienceTier, AccessLevel>> | undefined,
  tier: AudienceTier
): AccessLevel {
  return rules?.[tier] ?? DEFAULT_LEVEL_BY_TIER[tier];
}

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

    // P2.cleanup: visibility predicates that used to read `s.visitor_access`
    // etc. now consult `space_access_rules` / `channel_access_rules`. The
    // shape of the predicate is unchanged — only the source.
    let query = `select s.*,
              (exists (select 1 from server_members where server_id = s.id and product_user_id = $1::text)) as is_member
       from servers s
       where (s.type = 'dm'
          or ($2::boolean = false and s.owner_user_id = $1::text)
          or ($3::boolean = true)
          or ($2::boolean = false and exists (select 1 from role_bindings where (hub_id = s.hub_id or hub_id is null) and product_user_id = $1::text and role in ('hub_owner', 'hub_admin')))
          or ($2::boolean = false and exists (
            select 1 from space_access_rules sar
            where sar.server_id = s.id and sar.audience_tier = 'space_member' and sar.level != 'hidden'
              and exists (select 1 from server_members where server_id = s.id and product_user_id = $1::text)
          ))
          or ($2::boolean = false and exists (
            select 1 from space_access_rules sar
            where sar.server_id = s.id and sar.audience_tier = 'hub_member' and sar.level != 'hidden'
              and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1::text)
          ))
          or exists (select 1 from space_access_rules sar where sar.server_id = s.id and sar.audience_tier = 'visitor' and sar.level != 'hidden')
          or exists (
              select 1 from space_access_rules sar
              where sar.server_id = s.id and sar.audience_tier = 'visitor' and sar.level = 'hidden'
                and (
                  ($2::boolean = true and exists (select 1 from server_badge_rules sbr where sbr.server_id = s.id and sbr.badge_id = any($4::text[]) and sbr.access_level != 'hidden'))
                  or ($2::boolean = false and exists (select 1 from server_badge_rules sbr join user_badges ub on ub.badge_id = sbr.badge_id where sbr.server_id = s.id and ub.product_user_id = $1::text and sbr.access_level != 'hidden'))
                )
          )
          or exists (select 1 from channels c where c.server_id = s.id and (
              exists (select 1 from channel_access_rules car where car.channel_id = c.id and car.audience_tier = 'visitor' and car.level != 'hidden')
              or exists (
                  select 1 from channel_access_rules car
                  where car.channel_id = c.id and car.audience_tier = 'visitor' and car.level = 'hidden'
                    and (
                      ($2::boolean = true and exists (select 1 from channel_badge_rules cbr where cbr.channel_id = c.id and cbr.badge_id = any($4::text[]) and cbr.access_level != 'hidden'))
                      or ($2::boolean = false and exists (select 1 from channel_badge_rules cbr join user_badges ub on ub.badge_id = cbr.badge_id where cbr.channel_id = c.id and ub.product_user_id = $1::text and cbr.access_level != 'hidden'))
                    )
              )
              or ($2::boolean = false and exists (
                  select 1 from channel_access_rules car
                  where car.channel_id = c.id and car.audience_tier = 'hub_member' and car.level != 'hidden'
                    and exists (select 1 from hub_members where hub_id = s.hub_id and product_user_id = $1::text)
              ))
              or ($2::boolean = false and exists (
                  select 1 from channel_access_rules car
                  where car.channel_id = c.id and car.audience_tier = 'space_member' and car.level != 'hidden'
                    and exists (select 1 from server_members where server_id = s.id and product_user_id = $1::text)
              ))
          ))
          or ($2::boolean = false and exists (
            select 1 from space_admin_assignments saa
            where saa.server_id = s.id
              and saa.assigned_user_id = $1::text
              and saa.status = 'active'
              and (saa.expires_at is null or saa.expires_at > now())
          )))`;

    const params: any[] = [productUserId, isMasquerading, isAdminMasquerade, badgeIds];
    if (hubId) {
      query += ` and s.hub_id = $5::text`;
      params.push(hubId);
    }

    const rows = await db.query<ServerRow>(query + ` order by s.created_at asc`, params);
    const rulesByServer = await fetchSpaceAccessRules(db, rows.rows.map((r) => r.id));

    return rows.rows.map((row) => {
      const rules = rulesByServer.get(row.id);
      return {
        id: row.id,
        hubId: row.hub_id,
        name: row.name,
        type: row.type || "default",
        matrixSpaceId: row.matrix_space_id,
        iconUrl: row.icon_url,
        hubAdminAccess: tierLevel(rules, "hub_admin"),
        spaceAdminAccess: tierLevel(rules, "space_admin"),
        spaceModeratorAccess: tierLevel(rules, "space_moderator"),
        spaceMemberAccess: tierLevel(rules, "space_member"),
        hubMemberAccess: tierLevel(rules, "hub_member"),
        visitorAccess: tierLevel(rules, "visitor"),
        autoJoinHubMembers: row.auto_join_hub_members,
        createdByUserId: row.created_by_user_id,
        ownerUserId: row.owner_user_id,
        createdAt: row.created_at,
        isMember: row.is_member,
        joinPolicy: row.join_policy as any
      };
    });
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

    const rulesByServer = await fetchSpaceAccessRules(db, [value.id]);
    const rules = rulesByServer.get(value.id);

    return {
      id: value.id,
      hubId: value.hub_id,
      name: value.name,
      type: value.type,
      matrixSpaceId: value.matrix_space_id,
      iconUrl: value.icon_url,
      hubAdminAccess: tierLevel(rules, "hub_admin"),
      spaceAdminAccess: tierLevel(rules, "space_admin"),
      spaceModeratorAccess: tierLevel(rules, "space_moderator"),
      spaceMemberAccess: tierLevel(rules, "space_member"),
      hubMemberAccess: tierLevel(rules, "hub_member"),
      visitorAccess: tierLevel(rules, "visitor"),
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
  preferredUsername: string | null;
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
      preferredUsername: r.preferred_username,
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
      preferredUsername: string | null;
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
              preferredUsername: null,
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

const INVITE_RETURNING_COLUMNS = `
  id,
  hub_id as "hubId",
  created_by_user_id as "createdByUserId",
  expires_at as "expiresAt",
  max_uses as "maxUses",
  uses_count as "usesCount",
  created_at as "createdAt",
  default_role as "defaultRole",
  default_server_id as "defaultServerId",
  revoked_at as "revokedAt"
`;

type InviteRowWithoutBadges = Omit<HubInvite, "defaultBadgeIds">;

async function loadDefaultBadgeIds(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  inviteIds: string[]
): Promise<Map<string, string[]>> {
  if (inviteIds.length === 0) return new Map();
  const res = await db.query<{ invite_id: string; badge_id: string }>(
    `select invite_id, badge_id
       from hub_invite_default_badges
      where invite_id = any($1::text[])`,
    [inviteIds]
  );
  const map = new Map<string, string[]>();
  for (const row of res.rows) {
    const list = map.get(row.invite_id) ?? [];
    list.push(row.badge_id);
    map.set(row.invite_id, list);
  }
  return map;
}

export async function createHubInvite(input: {
  hubId: string;
  createdByUserId: string;
  expiresAt?: string | null;
  maxUses?: number | null;
  defaultRole?: HubInvite["defaultRole"] | null;
  defaultServerId?: string | null;
  defaultBadgeIds?: string[];
}): Promise<HubInvite> {
  return withDb(async (db) => {
    const id = `inv_${crypto.randomUUID().replaceAll("-", "")}`;
    const res = await db.query<InviteRowWithoutBadges>(
      `insert into hub_invites
         (id, hub_id, created_by_user_id, expires_at, max_uses, default_role, default_server_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning ${INVITE_RETURNING_COLUMNS}`,
      [
        id,
        input.hubId,
        input.createdByUserId,
        input.expiresAt ?? null,
        input.maxUses ?? null,
        input.defaultRole ?? null,
        input.defaultServerId ?? null
      ]
    );
    const row = res.rows[0]!;

    const badgeIds = (input.defaultBadgeIds ?? []).filter(Boolean);
    if (badgeIds.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [id];
      badgeIds.forEach((badgeId, idx) => {
        params.push(badgeId);
        values.push(`($1, $${idx + 2})`);
      });
      await db.query(
        `insert into hub_invite_default_badges (invite_id, badge_id)
         values ${values.join(", ")}
         on conflict (invite_id, badge_id) do nothing`,
        params
      );
    }

    return { ...row, defaultBadgeIds: [...badgeIds] };
  });
}

export async function getHubInvite(inviteId: string): Promise<HubInvite | null> {
  return withDb(async (db) => {
    const res = await db.query<InviteRowWithoutBadges>(
      `select ${INVITE_RETURNING_COLUMNS}
         from hub_invites
        where id = $1
          and revoked_at is null`,
      [inviteId]
    );
    const row = res.rows[0];
    if (!row) return null;
    const badgeMap = await loadDefaultBadgeIds(db, [row.id]);
    return { ...row, defaultBadgeIds: badgeMap.get(row.id) ?? [] };
  });
}

/** Hub-manager listing of active invites (revoked invites are excluded). */
export async function listHubInvites(hubId: string): Promise<HubInvite[]> {
  return withDb(async (db) => {
    const res = await db.query<InviteRowWithoutBadges>(
      `select ${INVITE_RETURNING_COLUMNS}
         from hub_invites
        where hub_id = $1
          and revoked_at is null
        order by created_at desc`,
      [hubId]
    );
    if (res.rows.length === 0) return [];
    const badgeMap = await loadDefaultBadgeIds(db, res.rows.map((r) => r.id));
    return res.rows.map((row) => ({
      ...row,
      defaultBadgeIds: badgeMap.get(row.id) ?? []
    }));
  });
}

export async function revokeHubInvite(input: { inviteId: string; hubId: string }): Promise<boolean> {
  return withDb(async (db) => {
    const res = await db.query(
      `update hub_invites
          set revoked_at = now()
        where id = $1
          and hub_id = $2
          and revoked_at is null`,
      [input.inviteId, input.hubId]
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function useHubInvite(input: { inviteId: string; productUserId: string }): Promise<{ hubId: string }> {
  return withDb(async (db) => {
    // `getHubInvite` already filters out revoked invites — a revoked invite
    // is treated identically to one that never existed (404).
    const invite = await getHubInvite(input.inviteId);
    if (!invite) throw new Error("Invite not found");

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw new Error("Invite expired");
    }
    if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) {
      throw new Error("Invite reached max uses");
    }

    // Permissions sprint P1: a redeemer no longer gets an automatic
    // role='user' binding. Plain hub membership (the `joinHub` call below)
    // is sufficient for "Member" tier. Only an explicitly-set
    // `defaultRole` (space_moderator | space_admin) writes a binding.
    const role = invite.defaultRole;
    if (role) {
      const isSpaceScopedRole = role.startsWith("space_");
      const serverIdForBinding = isSpaceScopedRole ? invite.defaultServerId : null;

      // Idempotent role binding insert. The `role_bindings_natural_key`
      // unique index added in migration 033 makes the conflict target
      // meaningful: a user re-redeeming the same invite gets exactly one
      // binding, not N.
      const bindingRes = await db.query<{ id: string }>(
        `insert into role_bindings (id, product_user_id, role, hub_id, server_id)
         values ($1, $2, $3, $4, $5)
         on conflict (product_user_id, role,
                      coalesce(hub_id, ''),
                      coalesce(server_id, ''),
                      coalesce(channel_id, ''))
         do nothing
         returning id`,
        [
          `rb_${crypto.randomUUID().replaceAll("-", "")}`,
          input.productUserId,
          role,
          invite.hubId,
          serverIdForBinding
        ]
      );

      // Audit only if a new binding actually landed. Inviter is actor;
      // redeemer is target. Same shape as explicit /v1/roles/grant audit
      // entries so downstream tooling doesn't need to special-case
      // invite-driven grants.
      if (bindingRes.rowCount && bindingRes.rowCount > 0) {
        await db.query(
          `insert into role_assignment_audit_logs
             (id, actor_user_id, target_user_id, role, hub_id, server_id, channel_id, outcome, reason)
           values ($1, $2, $3, $4, $5, $6, null, 'granted', $7)`,
          [
            `raal_${crypto.randomUUID().replaceAll("-", "")}`,
            invite.createdByUserId,
            input.productUserId,
            role,
            invite.hubId,
            serverIdForBinding,
            `invite ${invite.id}`
          ]
        );
      }
    }

    // Apply default badges. NB: `user_badges` has a unique
    // (product_user_id, badge_id) constraint, so re-redemption is naturally
    // idempotent here too.
    if (invite.defaultBadgeIds.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [input.productUserId];
      invite.defaultBadgeIds.forEach((badgeId, idx) => {
        params.push(badgeId);
        values.push(`($1, $${idx + 2})`);
      });
      await db.query(
        `insert into user_badges (product_user_id, badge_id)
         values ${values.join(", ")}
         on conflict (product_user_id, badge_id) do nothing`,
        params
      );
    }

    await db.query("update hub_invites set uses_count = uses_count + 1 where id = $1", [input.inviteId]);

    // Ensure full membership state is created (hub_members, server_members
    // for any auto_join_hub_members servers). NB: when `defaultServerId` is
    // set, the named server is joined unconditionally below — this
    // intentionally bypasses the server's `join_policy` (open/approval/invite),
    // because the invite link IS the consent mechanism. The hub admin who
    // issued the invite stands in for any per-server approval that would
    // otherwise apply.
    await joinHub(invite.hubId, input.productUserId);

    if (invite.defaultServerId) {
      await db.query(
        `insert into server_members (server_id, product_user_id)
         values ($1, $2)
         on conflict (server_id, product_user_id) do nothing`,
        [invite.defaultServerId, input.productUserId]
      );
    }

    return { hubId: invite.hubId };
  });
}
