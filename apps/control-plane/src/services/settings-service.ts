import { withDb } from "../db/client.js";
import type { Hub, Server, Channel } from "@skerry/shared";

export async function getHubSettings(hubId: string): Promise<Partial<Hub>> {
  return withDb(async (db) => {
    const res = await db.query(
      `select theme, space_customization_limits, oidc_config, allow_space_discord_bridge, 
              is_suspended, suspended_at, suspension_expires_at, unlock_code_hash
       from hubs where id = $1`,
      [hubId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Hub not found");
    return {
      theme: row.theme,
      spaceCustomizationLimits: row.space_customization_limits,
      oidcConfig: row.oidc_config,
      allowSpaceDiscordBridge: row.allow_space_discord_bridge,
      suspension: {
        isSuspended: row.is_suspended,
        suspendedAt: row.suspended_at,
        expiresAt: row.suspension_expires_at,
        unlockCodeHash: row.unlock_code_hash
      }
    };
  });
}

export async function updateHubSettings(hubId: string, settings: {
  theme?: any;
  spaceCustomizationLimits?: any;
  oidcConfig?: any;
  allowSpaceDiscordBridge?: boolean;
  suspension?: {
    isSuspended?: boolean;
    suspendedAt?: string | null;
    expiresAt?: string | null;
    unlockCodeHash?: string | null;
  };
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `update hubs set 
        theme = case when $2::jsonb is not null then $2::jsonb else theme end,
        space_customization_limits = case when $3::jsonb is not null then $3::jsonb else space_customization_limits end,
        oidc_config = case when $4::jsonb is not null then $4::jsonb else oidc_config end,
        allow_space_discord_bridge = coalesce($5, allow_space_discord_bridge),
        is_suspended = coalesce($6, is_suspended),
        suspended_at = case when $7::text is not null or $10::boolean then $7::timestamptz else suspended_at end,
        suspension_expires_at = case when $8::text is not null or $11::boolean then $8::timestamptz else suspension_expires_at end,
        unlock_code_hash = case when $9::text is not null or $12::boolean then $9::text else unlock_code_hash end
      where id = $1`,
      [
        hubId,
        settings.theme ? JSON.stringify(settings.theme) : null,
        settings.spaceCustomizationLimits ? JSON.stringify(settings.spaceCustomizationLimits) : null,
        settings.oidcConfig ? JSON.stringify(settings.oidcConfig) : null,
        settings.allowSpaceDiscordBridge,
        settings.suspension?.isSuspended,
        settings.suspension?.suspendedAt,
        settings.suspension?.expiresAt,
        settings.suspension?.unlockCodeHash,
        settings.suspension?.suspendedAt === null,
        settings.suspension?.expiresAt === null,
        settings.suspension?.unlockCodeHash === null
      ]
    );
  });
}

export async function getServerSettings(serverId: string): Promise<Partial<Server>> {
  return withDb(async (db) => {
    const res = await db.query(
      "select starting_channel_id, icon_url, auto_join_hub_members, join_policy from servers where id = $1",
      [serverId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Server not found");

    // P2.cleanup: legacy *_access columns are gone. All tier levels
    // come from `space_access_rules`.
    const ruleRows = await db.query<{ audience_tier: string; level: string }>(
      "select audience_tier, level from space_access_rules where server_id = $1",
      [serverId]
    );
    const tierLevels: Record<string, string> = {};
    for (const r of ruleRows.rows) tierLevels[r.audience_tier] = r.level;

    return {
      startingChannelId: row.starting_channel_id,
      iconUrl: row.icon_url,
      hubAdminAccess: (tierLevels.hub_admin ?? "chat") as any,
      spaceAdminAccess: (tierLevels.space_admin ?? "chat") as any,
      spaceModeratorAccess: (tierLevels.space_moderator ?? "chat") as any,
      spaceMemberAccess: (tierLevels.space_member ?? "chat") as any,
      hubMemberAccess: (tierLevels.hub_member ?? "chat") as any,
      visitorAccess: (tierLevels.visitor ?? "hidden") as any,
      autoJoinHubMembers: row.auto_join_hub_members,
      joinPolicy: row.join_policy as any
    };
  });
}

export async function updateServerSettings(serverId: string, settings: {
  startingChannelId?: string | null;
  iconUrl?: string | null;
  hubAdminAccess?: string;
  spaceMemberAccess?: string;
  hubMemberAccess?: string;
  visitorAccess?: string;
  spaceAdminAccess?: string;
  spaceModeratorAccess?: string;
  autoJoinHubMembers?: boolean;
  joinPolicy?: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `update servers set
        starting_channel_id = case when $2::text is not null or $6::boolean then $2::text else starting_channel_id end,
        icon_url = case when $3::text is not null or $7::boolean then $3::text else icon_url end,
        auto_join_hub_members = coalesce($4, auto_join_hub_members),
        join_policy = coalesce($5, join_policy)
      where id = $1`,
      [
        serverId,
        settings.startingChannelId,
        settings.iconUrl,
        settings.autoJoinHubMembers,
        settings.joinPolicy,
        settings.startingChannelId === null,
        settings.iconUrl === null
      ]
    );

    // P2.cleanup: all access fields go to space_access_rules.
    await upsertSpaceAccessRules(db, serverId, {
      visitor: settings.visitorAccess,
      hub_member: settings.hubMemberAccess,
      space_member: settings.spaceMemberAccess,
      space_moderator: settings.spaceModeratorAccess,
      space_admin: settings.spaceAdminAccess,
      hub_admin: settings.hubAdminAccess
    });
  });
}

type AccessTierKey =
  | "visitor"
  | "hub_member"
  | "space_member"
  | "space_moderator"
  | "space_admin"
  | "hub_admin";

async function upsertSpaceAccessRules(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  serverId: string,
  byTier: Partial<Record<AccessTierKey, string | undefined>>
): Promise<void> {
  for (const [tier, level] of Object.entries(byTier)) {
    if (!level) continue;
    await db.query(
      `insert into space_access_rules (server_id, audience_tier, level)
       values ($1, $2, $3)
       on conflict (server_id, audience_tier)
       do update set level = excluded.level, updated_at = now()`,
      [serverId, tier, level]
    );
  }
}

async function upsertChannelAccessRules(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  channelId: string,
  byTier: Partial<Record<AccessTierKey, string | undefined>>
): Promise<void> {
  for (const [tier, level] of Object.entries(byTier)) {
    if (!level) continue;
    await db.query(
      `insert into channel_access_rules (channel_id, audience_tier, level)
       values ($1, $2, $3)
       on conflict (channel_id, audience_tier)
       do update set level = excluded.level, updated_at = now()`,
      [channelId, tier, level]
    );
  }
}

export async function getChannelSettings(channelId: string): Promise<Partial<Channel>> {
  return withDb(async (db) => {
    const res = await db.query(
      "select restricted_visibility from channels where id = $1",
      [channelId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Channel not found");

    const ruleRows = await db.query<{ audience_tier: string; level: string }>(
      "select audience_tier, level from channel_access_rules where channel_id = $1",
      [channelId]
    );
    const tierLevels: Record<string, string> = {};
    for (const r of ruleRows.rows) tierLevels[r.audience_tier] = r.level;

    return {
      restrictedVisibility: row.restricted_visibility,
      hubAdminAccess: (tierLevels.hub_admin ?? "chat") as any,
      spaceAdminAccess: (tierLevels.space_admin ?? "chat") as any,
      spaceModeratorAccess: (tierLevels.space_moderator ?? "chat") as any,
      spaceMemberAccess: (tierLevels.space_member ?? "chat") as any,
      hubMemberAccess: (tierLevels.hub_member ?? "chat") as any,
      visitorAccess: (tierLevels.visitor ?? "hidden") as any
    };
  });
}

export async function updateChannelSettings(channelId: string, settings: {
  restrictedVisibility?: boolean;
  hubAdminAccess?: string;
  spaceMemberAccess?: string;
  hubMemberAccess?: string;
  visitorAccess?: string;
  spaceAdminAccess?: string;
  spaceModeratorAccess?: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `update channels set
        restricted_visibility = coalesce($2, restricted_visibility)
      where id = $1`,
      [channelId, settings.restrictedVisibility]
    );

    await upsertChannelAccessRules(db, channelId, {
      visitor: settings.visitorAccess,
      hub_member: settings.hubMemberAccess,
      space_member: settings.spaceMemberAccess,
      space_moderator: settings.spaceModeratorAccess,
      space_admin: settings.spaceAdminAccess,
      hub_admin: settings.hubAdminAccess
    });
  });
}

export async function getUserSettings(productUserId: string): Promise<Record<string, any>> {
  return withDb(async (db) => {
    const res = await db.query(
      "select settings from identity_mappings where product_user_id = $1 limit 1",
      [productUserId]
    );
    const row = res.rows[0];
    return row?.settings || {};
  });
}

export async function updateUserSettings(productUserId: string, settings: Record<string, any>): Promise<void> {
  return withDb(async (db) => {
    // Update all identity mappings for this product user
    await db.query(
      "update identity_mappings set settings = $2 where product_user_id = $1",
      [productUserId, JSON.stringify(settings)]
    );
  });
}
