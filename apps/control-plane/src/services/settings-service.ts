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
      "select starting_channel_id, icon_url, hub_admin_access, space_member_access, hub_member_access, visitor_access, auto_join_hub_members from servers where id = $1",
      [serverId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Server not found");
    return {
      startingChannelId: row.starting_channel_id,
      iconUrl: row.icon_url,
      hubAdminAccess: row.hub_admin_access as any,
      spaceMemberAccess: row.space_member_access as any,
      hubMemberAccess: row.hub_member_access as any,
      visitorAccess: row.visitor_access as any,
      autoJoinHubMembers: row.auto_join_hub_members
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
  autoJoinHubMembers?: boolean;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `update servers set 
        starting_channel_id = case when $2::text is not null or $6::boolean then $2::text else starting_channel_id end,
        icon_url = case when $3::text is not null or $7::boolean then $3::text else icon_url end,
        hub_admin_access = coalesce($4, hub_admin_access),
        space_member_access = coalesce($5, space_member_access),
        hub_member_access = coalesce($8, hub_member_access),
        visitor_access = coalesce($10, visitor_access),
        auto_join_hub_members = coalesce($9, auto_join_hub_members)
      where id = $1`,
      [
        serverId,
        settings.startingChannelId,
        settings.iconUrl,
        settings.hubAdminAccess,
        settings.spaceMemberAccess,
        settings.startingChannelId === null,
        settings.iconUrl === null,
        settings.hubMemberAccess,
        settings.autoJoinHubMembers,
        settings.visitorAccess
      ]
    );
  });
}

export async function getChannelSettings(channelId: string): Promise<Partial<Channel>> {
  return withDb(async (db) => {
    const res = await db.query(
      "select restricted_visibility, hub_admin_access, space_member_access, hub_member_access, visitor_access from channels where id = $1",
      [channelId]
    );
    const row = res.rows[0];
    if (!row) throw new Error("Channel not found");
    return {
      restrictedVisibility: row.restricted_visibility,
      hubAdminAccess: row.hub_admin_access as any,
      spaceMemberAccess: row.space_member_access as any,
      hubMemberAccess: row.hub_member_access as any,
      visitorAccess: row.visitor_access as any
    };
  });
}

export async function updateChannelSettings(channelId: string, settings: {
  restrictedVisibility?: boolean;
  hubAdminAccess?: string;
  spaceMemberAccess?: string;
  hubMemberAccess?: string;
  visitorAccess?: string;
}): Promise<void> {
  return withDb(async (db) => {
    await db.query(
      `update channels set 
        restricted_visibility = coalesce($2, restricted_visibility),
        hub_admin_access = coalesce($3, hub_admin_access),
        space_member_access = coalesce($4, space_member_access),
        hub_member_access = coalesce($5, hub_member_access),
        visitor_access = coalesce($6, visitor_access)
      where id = $1`,
      [
        channelId,
        settings.restrictedVisibility,
        settings.hubAdminAccess,
        settings.spaceMemberAccess,
        settings.hubMemberAccess,
        settings.visitorAccess
      ]
    );
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
