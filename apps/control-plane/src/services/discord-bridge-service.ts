import crypto from "node:crypto";
import { ChannelType } from "discord.js";
import type { DiscordBridgeChannelMapping, DiscordBridgeConnection } from "@skerry/shared";
import { config } from "../config.js";
import { withDb } from "../db/client.js";
import { createMessage } from "./chat-service.js";
import { publishChannelMessage } from "./chat-realtime.js";

import { getDiscordBotClient, startDiscordBot, provisionProjectEmoji } from "./discord-bot-client.js";
import { isTokenExpired } from "../auth/oidc.js";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

const oauthStateStore = new Map<
  string,
  {
    serverId: string;
    productUserId: string;
    returnTo?: string;
    createdAt: number;
  }
>();

const pendingGuildSelections = new Map<
  string,
  {
    serverId: string;
    productUserId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    discordUserId: string | null;
    discordUsername: string | null;
    guilds: Array<{ id: string; name: string }>;
  }
>();

const DISCORD_PERMISSIONS = {
  ADMINISTRATOR: BigInt(8),
  MANAGE_GUILD: BigInt(32)
} as const;

function hasDiscordGuildManagePermissions(input: {
  owner?: boolean;
  permissions?: string;
}): boolean {
  if (input.owner) {
    return true;
  }
  if (!input.permissions) {
    return false;
  }
  let perms: bigint;
  try {
    perms = BigInt(input.permissions);
  } catch {
    return false;
  }
  return (
    (perms & DISCORD_PERMISSIONS.ADMINISTRATOR) === DISCORD_PERMISSIONS.ADMINISTRATOR ||
    (perms & DISCORD_PERMISSIONS.MANAGE_GUILD) === DISCORD_PERMISSIONS.MANAGE_GUILD
  );
}

function cleanExpiredState(): void {
  const now = Date.now();
  for (const [key, value] of oauthStateStore.entries()) {
    if (now - value.createdAt > 10 * 60 * 1000) {
      oauthStateStore.delete(key);
    }
  }
}

function mapConnection(row: {
  id: string;
  server_id: string;
  connected_by_user_id: string;
  guild_id: string | null;
  guild_name: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
}): DiscordBridgeConnection {
  return {
    id: row.id,
    serverId: row.server_id,
    connectedByUserId: row.connected_by_user_id,
    guildId: row.guild_id,
    guildName: row.guild_name,
    status: row.status === "syncing" || row.status === "degraded" || row.status === "connected" ? row.status : "disconnected",
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}

function mapMapping(row: {
  id: string;
  server_id: string;
  guild_id: string;
  discord_channel_id: string;
  discord_channel_name: string;
  matrix_channel_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}): DiscordBridgeChannelMapping {
  return {
    id: row.id,
    serverId: row.server_id,
    guildId: row.guild_id,
    discordChannelId: row.discord_channel_id,
    discordChannelName: row.discord_channel_name,
    matrixChannelId: row.matrix_channel_id,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createDiscordConnectUrl(input: { serverId: string; productUserId: string; returnTo?: string }): string {
  cleanExpiredState();
  const state = randomId("dboauth");
  oauthStateStore.set(state, {
    serverId: input.serverId,
    productUserId: input.productUserId,
    returnTo: input.returnTo,
    createdAt: Date.now()
  });

  const query = new URLSearchParams({
    client_id: config.discordBridge.clientId ?? "",
    redirect_uri: config.discordBridge.callbackUrl,
    response_type: "code",
    scope: "identify guilds bot applications.commands",
    permissions: "536873984", // Read Messages, Send Messages, Manage Webhooks
    state
  });
  return `${config.discordBridge.authorizeUrl}?${query.toString()}`;
}

export function consumeDiscordOauthState(state: string): { serverId: string; productUserId: string; returnTo?: string } | null {
  cleanExpiredState();
  const value = oauthStateStore.get(state);
  if (!value) {
    return null;
  }
  oauthStateStore.delete(state);
  return {
    serverId: value.serverId,
    productUserId: value.productUserId,
    returnTo: value.returnTo
  };
}

async function exchangeDiscordOAuthCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  guilds: Array<{ id: string; name: string }>;
}> {
  if (config.discordBridge.mockMode) {
    return {
      accessToken: "mock_access_token",
      refreshToken: "mock_refresh_token",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      discordUserId: "mock_user_1",
      discordUsername: "MockDiscordUser",
      guilds: [
        { id: "mock_guild_1", name: "Mock Creator Guild" },
        { id: "mock_guild_2", name: "Backup Guild" }
      ]
    };
  }

  if (!config.discordBridge.clientId || !config.discordBridge.clientSecret) {
    throw new Error("Discord bridge OAuth credentials are not configured.");
  }

  const tokenResponse = await fetch(config.discordBridge.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discordBridge.clientId,
      client_secret: config.discordBridge.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.discordBridge.callbackUrl
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Discord bridge token exchange failed (${tokenResponse.status}).`);
  }

  const token = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const userInfoResponse = await fetch(config.discordBridge.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${token.access_token}`
    }
  });
  if (!userInfoResponse.ok) {
    throw new Error(`Discord user profile request failed (${userInfoResponse.status}).`);
  }
  const userInfo = (await userInfoResponse.json()) as {
    id: string;
    username: string;
    global_name?: string;
  };
  const guildsResponse = await fetch(config.discordBridge.userGuildsUrl, {
    headers: {
      Authorization: `Bearer ${token.access_token}`
    }
  });
  if (!guildsResponse.ok) {
    throw new Error(`Discord guild listing failed (${guildsResponse.status}).`);
  }
  const guilds = (await guildsResponse.json()) as Array<{
    id: string;
    name: string;
    owner?: boolean;
    permissions?: string;
  }>;
  const manageableGuilds = guilds.filter((guild) =>
    hasDiscordGuildManagePermissions({
      owner: guild.owner,
      permissions: guild.permissions
    })
  );
  if (manageableGuilds.length < 1) {
    throw new Error(
      "No guilds found where the authenticated Discord account has owner/admin/manage-server permissions."
    );
  }
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt,
    discordUserId: userInfo.id,
    discordUsername: userInfo.global_name ?? userInfo.username,
    guilds: manageableGuilds.map((guild) => ({ id: guild.id, name: guild.name }))
  };
}

async function refreshBridgeToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
  if (config.discordBridge.mockMode) {
    return {
      accessToken: "mock_refreshed_access_token",
      refreshToken: "mock_refreshed_refresh_token",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
  }

  if (!config.discordBridge.clientId || !config.discordBridge.clientSecret) {
    throw new Error("Discord bridge OAuth credentials are not configured.");
  }

  const response = await fetch(config.discordBridge.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discordBridge.clientId,
      client_secret: config.discordBridge.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Discord bridge token refresh failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null
  };
}

export async function ensureBridgeTokenValid(serverId: string): Promise<string | null> {
  return withDb(async (db) => {
    const row = await db.query<{
      access_token: string | null;
      refresh_token: string | null;
      token_expires_at: string | null;
    }>(
      "select access_token, refresh_token, token_expires_at from discord_bridge_connections where server_id = $1",
      [serverId]
    );

    const connection = row.rows[0];
    if (!connection || !connection.access_token) {
      return null;
    }

    if (!isTokenExpired(connection.token_expires_at)) {
      return connection.access_token;
    }

    if (!connection.refresh_token) {
      return connection.access_token;
    }

    try {
      const refreshed = await refreshBridgeToken(connection.refresh_token);
      await db.query(
        `update discord_bridge_connections
         set access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = now()
         where server_id = $4`,
        [
          refreshed.accessToken,
          refreshed.refreshToken ?? connection.refresh_token,
          refreshed.expiresAt,
          serverId
        ]
      );
      return refreshed.accessToken;
    } catch (error) {
      console.error(`Failed to refresh Discord bridge token for server ${serverId}:`, error);
      return connection.access_token;
    }
  });
}

export async function completeDiscordOauthAndListGuilds(input: {
  serverId: string;
  productUserId: string;
  code: string;
  guildId?: string;
}): Promise<{ pendingSelectionId: string; guilds: Array<{ id: string; name: string }>; selectedGuildId?: string }> {
  const exchanged = await exchangeDiscordOAuthCode(input.code);
  const pendingSelectionId = randomId("dbpending");
  pendingGuildSelections.set(pendingSelectionId, {
    serverId: input.serverId,
    productUserId: input.productUserId,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresAt: exchanged.expiresAt,
    discordUserId: exchanged.discordUserId,
    discordUsername: exchanged.discordUsername,
    guilds: exchanged.guilds
  });

  return {
    pendingSelectionId,
    guilds: exchanged.guilds,
    selectedGuildId: input.guildId
  };
}

export function getPendingDiscordGuildSelection(input: {
  pendingSelectionId: string;
  productUserId: string;
}): { serverId: string; guilds: Array<{ id: string; name: string }> } | null {
  const pending = pendingGuildSelections.get(input.pendingSelectionId);
  if (!pending || pending.productUserId !== input.productUserId) {
    return null;
  }
  return {
    serverId: pending.serverId,
    guilds: pending.guilds
  };
}

export async function selectDiscordGuild(input: {
  pendingSelectionId: string;
  productUserId: string;
  guildId: string;
}): Promise<DiscordBridgeConnection> {
  const pending = pendingGuildSelections.get(input.pendingSelectionId);
  if (!pending || pending.productUserId !== input.productUserId) {
    throw new Error("Pending Discord selection not found.");
  }

  const guild = pending.guilds.find((item) => item.id === input.guildId);
  if (!guild) {
    throw new Error("Selected guild not found in OAuth result.");
  }

  pendingGuildSelections.delete(input.pendingSelectionId);

  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      connected_by_user_id: string;
      guild_id: string | null;
      guild_name: string | null;
      status: string;
      last_sync_at: string | null;
      last_error: string | null;
      updated_at: string;
    }>(
      `insert into discord_bridge_connections
       (id, server_id, connected_by_user_id, discord_user_id, discord_username, access_token, refresh_token, token_expires_at, guild_id, guild_name, status, last_sync_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'connected', now(), now())
       on conflict (server_id)
       do update set
         connected_by_user_id = excluded.connected_by_user_id,
         discord_user_id = excluded.discord_user_id,
         discord_username = excluded.discord_username,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_expires_at = excluded.token_expires_at,
         guild_id = excluded.guild_id,
         guild_name = excluded.guild_name,
         status = 'connected',
         last_error = null,
         last_sync_at = now(),
         updated_at = now()
       returning id, server_id, connected_by_user_id, guild_id, guild_name, status, last_sync_at, last_error, updated_at`,
      [
        randomId("dbconn"),
        pending.serverId,
        input.productUserId,
        pending.discordUserId,
        pending.discordUsername,
        pending.accessToken,
        pending.refreshToken,
        pending.expiresAt,
        guild.id,
        guild.name
      ]
    );
    const saved = row.rows[0];
    if (!saved) {
      throw new Error("Discord bridge connection save failed.");
    }

    // Launch the bot immediately now that a connection is established
    startDiscordBot().catch(err => console.error("Failed to start Discord bot after guild selection:", err));

    if (saved.guild_id) {
      provisionProjectEmoji(saved.guild_id).catch(err => console.error("Failed to provision project emoji:", err));
    }

    return mapConnection(saved);
  });
}

export async function getDiscordBridgeConnection(serverId: string): Promise<DiscordBridgeConnection | null> {
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      connected_by_user_id: string;
      guild_id: string | null;
      guild_name: string | null;
      status: string;
      last_sync_at: string | null;
      last_error: string | null;
      updated_at: string;
    }>(
      `select id, server_id, connected_by_user_id, guild_id, guild_name, status, last_sync_at, last_error, updated_at
       from discord_bridge_connections where server_id = $1`,
      [serverId]
    );
    const connection = row.rows[0];
    return connection ? mapConnection(connection) : null;
  });
}

export async function listDiscordChannelMappings(serverId: string): Promise<DiscordBridgeChannelMapping[]> {
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      guild_id: string;
      discord_channel_id: string;
      discord_channel_name: string;
      matrix_channel_id: string;
      enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `select id, server_id, guild_id, discord_channel_id, discord_channel_name, matrix_channel_id, enabled, created_at, updated_at
       from discord_bridge_channel_mappings
       where server_id = $1
       order by created_at asc`,
      [serverId]
    );
    return row.rows.map(mapMapping);
  });
}

export async function upsertDiscordChannelMapping(input: {
  serverId: string;
  guildId: string;
  discordChannelId: string;
  discordChannelName: string;
  matrixChannelId: string;
  enabled: boolean;
}): Promise<DiscordBridgeChannelMapping> {
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      guild_id: string;
      discord_channel_id: string;
      discord_channel_name: string;
      matrix_channel_id: string;
      enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `insert into discord_bridge_channel_mappings
       (id, server_id, guild_id, discord_channel_id, discord_channel_name, matrix_channel_id, enabled)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (server_id, discord_channel_id)
       do update set
         guild_id = excluded.guild_id,
         discord_channel_name = excluded.discord_channel_name,
         matrix_channel_id = excluded.matrix_channel_id,
         enabled = excluded.enabled,
         updated_at = now()
       returning id, server_id, guild_id, discord_channel_id, discord_channel_name, matrix_channel_id, enabled, created_at, updated_at`,
      [
        randomId("dbmap"),
        input.serverId,
        input.guildId,
        input.discordChannelId,
        input.discordChannelName,
        input.matrixChannelId,
        input.enabled
      ]
    );
    const mapping = row.rows[0];
    if (!mapping) {
      throw new Error("Bridge mapping upsert failed.");
    }
    return mapMapping(mapping);
  });
}

export async function deleteDiscordChannelMapping(input: { serverId: string; mappingId: string }): Promise<void> {
  await withDb(async (db) => {
    await db.query("delete from discord_bridge_channel_mappings where id = $1 and server_id = $2", [
      input.mappingId,
      input.serverId
    ]);
  });
}

export async function retryDiscordBridgeSync(serverId: string): Promise<DiscordBridgeConnection> {
  await ensureBridgeTokenValid(serverId);
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      connected_by_user_id: string;
      guild_id: string | null;
      guild_name: string | null;
      status: string;
      last_sync_at: string | null;
      last_error: string | null;
      updated_at: string;
    }>(
      `update discord_bridge_connections
       set status = 'syncing', last_error = null, updated_at = now()
       where server_id = $1
       returning id, server_id, connected_by_user_id, guild_id, guild_name, status, last_sync_at, last_error, updated_at`,
      [serverId]
    );
    const updated = row.rows[0];
    if (!updated) {
      throw new Error("Discord bridge connection not found.");
    }

    await db.query(
      `update discord_bridge_connections
       set status = 'connected', last_sync_at = now(), updated_at = now()
       where server_id = $1`,
      [serverId]
    );
    const refreshed = await getDiscordBridgeConnection(serverId);
    if (!refreshed) {
      throw new Error("Discord bridge connection not found after sync.");
    }
    return refreshed;
  });
}

export async function relayDiscordMessageToMappedChannel(input: {
  serverId: string;
  discordChannelId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  media?: Array<{ url: string; sourceUrl: string }>;
}): Promise<{ relayed: boolean; matrixChannelId?: string; limitation?: string }> {
  const mappings = await listDiscordChannelMappings(input.serverId);
  const mapping = mappings.find((item) => item.discordChannelId === input.discordChannelId && item.enabled);
  if (!mapping) {
    return { relayed: false, limitation: "No active mapping for Discord channel." };
  }

  const connection = await getDiscordBridgeConnection(input.serverId);
  if (!connection) {
    return { relayed: false, limitation: "Bridge not connected for server." };
  }

  const mappedChannelExists = await withDb(async (db) => {
    const row = await db.query<{ exists: boolean }>(
      `select exists(
         select 1
         from channels ch
         join servers s on s.id = ch.server_id
         where ch.id = $1 and s.id = $2
       ) as exists`,
      [mapping.matrixChannelId, input.serverId]
    );
    return Boolean(row.rows[0]?.exists);
  });
  if (!mappedChannelExists) {
    return { relayed: false, limitation: "Mapped Matrix channel no longer exists." };
  }

  let finalContent = input.content.trim();
  const attachments = (input.media ?? []).map((item) => {
    const url = item.url;
    const filename = url.split("/").pop()?.split("?")[0] || "image.png";
    const isGif = url.toLowerCase().includes(".gif");
    const isMp4 = url.toLowerCase().includes(".mp4");
    const isWebm = url.toLowerCase().includes(".webm");
    
    // Clean up content: if the message content contains the media or source URL, strip it
    if (item.sourceUrl && finalContent.includes(item.sourceUrl)) {
        finalContent = finalContent.replace(item.sourceUrl, "").trim();
    }
    if (url && finalContent.includes(url)) {
        finalContent = finalContent.replace(url, "").trim();
    }

    return {
      id: `att_${crypto.randomUUID().replaceAll("-", "")}`,
      url,
      sourceUrl: item.sourceUrl,
      contentType: isGif ? "image/gif" : isMp4 ? "video/mp4" : isWebm ? "video/webm" : "image/any",
      filename
    };
  });

  const message = await createMessage({
    channelId: mapping.matrixChannelId,
    actorUserId: connection.connectedByUserId,
    content: finalContent,
    attachments: attachments.length > 0 ? attachments : undefined,
    isRelay: true,
    externalAuthorId: input.authorId,
    externalProvider: "discord",
    externalAuthorName: input.authorName,
    externalAuthorAvatarUrl: input.authorAvatarUrl
  });

  publishChannelMessage(message);

  return {
    relayed: true,
    matrixChannelId: mapping.matrixChannelId,
    limitation: "Formatting is text-first; rich embeds are not mirrored in this MVP."
  };
}

export async function listDiscordGuildChannels(guildId: string): Promise<Array<{ id: string; name: string }>> {
  if (config.discordBridge.mockMode) {
    return [
      { id: "mock_chan_1", name: "general" },
      { id: "mock_chan_2", name: "announcements" }
    ];
  }

  const client = getDiscordBotClient();
  if (!client || !client.isReady()) {
    throw new Error("Discord bot is not ready; cannot fetch channels.");
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found by bot.`);
    }

    const channels = await guild.channels.fetch();
    return channels
      .filter((c) => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement))
      .map((c) => ({ id: c!.id, name: c!.name }));
  } catch (error) {
    throw new Error(`Failed to fetch Discord channels: ${error instanceof Error ? error.message : String(error)}`);
  }
}
