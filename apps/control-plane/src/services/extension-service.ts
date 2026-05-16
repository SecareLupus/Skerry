import crypto from "node:crypto";
import { withDb } from "../db/client.js";
import type { ServerEmoji, ServerSticker, Webhook, FollowedAnnouncement, DiscordGuildEmoji } from "@skerry/shared";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

interface ServerEmojiRow {
  id: string;
  server_id: string;
  name: string;
  url: string;
  created_at: string;
  updated_at: string;
}

interface ServerStickerRow {
  id: string;
  server_id: string;
  name: string;
  url: string;
  created_at: string;
  updated_at: string;
}

interface WebhookRow {
  id: string;
  channel_id: string;
  server_id: string;
  name: string;
  avatar_url: string | null;
  secret_token: string;
  created_at: string;
  updated_at: string;
}

function mapServerEmoji(row: ServerEmojiRow): ServerEmoji {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapServerSticker(row: ServerStickerRow): ServerSticker {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    channelId: row.channel_id,
    serverId: row.server_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    secretToken: row.secret_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createServerEmoji(input: {
  serverId: string;
  name: string;
  url: string;
}): Promise<ServerEmoji> {
  return withDb(async (db) => {
    const row = await db.query<ServerEmojiRow>(
      `insert into server_emojis (id, server_id, name, url)
       values ($1, $2, $3, $4)
       returning *`,
      [randomId("emo"), input.serverId, input.name, input.url]
    );
    return mapServerEmoji(row.rows[0]!);
  });
}

export async function listServerEmojis(serverId: string): Promise<ServerEmoji[]> {
  return withDb(async (db) => {
    const row = await db.query<ServerEmojiRow>(
      "select * from server_emojis where server_id = $1 order by name asc",
      [serverId]
    );
    return row.rows.map(mapServerEmoji);
  });
}

export async function deleteServerEmoji(serverId: string, emojiId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query("delete from server_emojis where id = $1 and server_id = $2", [emojiId, serverId]);
  });
}

export async function listDiscordGuildEmojis(serverId: string, guildId: string): Promise<DiscordGuildEmoji[]> {
  const { getDiscordBotClient } = await import("./discord-bot-client.js");
  const client = getDiscordBotClient();
  if (!client || !client.isReady()) {
    throw new Error("Discord bot is not ready; cannot fetch guild emojis.");
  }

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found by bot.`);
  }

  const discordEmojis = await guild.emojis.fetch();

  // Check which Discord emojis are already pulled into server_emojis
  const pulled = await withDb(async (db) => {
    const rows = await db.query<{ name: string }>(
      "select name from server_emojis where server_id = $1",
      [serverId]
    );
    return new Set(rows.rows.map(r => r.name));
  });

  const result: DiscordGuildEmoji[] = [];
  for (const [, emoji] of discordEmojis) {
    const ext = emoji.animated ? "gif" : "webp";
    result.push({
      id: emoji.id,
      name: emoji.name ?? emoji.id,
      isAnimated: emoji.animated ?? false,
      isMirrored: pulled.has(emoji.name ?? ""),
      url: `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=96&quality=lossless`
    });
  }
  return result;
}

export async function pullAllDiscordEmojis(serverId: string, guildId: string): Promise<{ pulled: number; skipped: number }> {
  const { getDiscordBotClient } = await import("./discord-bot-client.js");
  const client = getDiscordBotClient();
  if (!client || !client.isReady()) {
    throw new Error("Discord bot is not ready; cannot pull guild emojis.");
  }

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild ${guildId} not found by bot.`);
  }

  const discordEmojis = await guild.emojis.fetch();

  // Get existing emoji names for this server
  const existingNames = await withDb(async (db) => {
    const rows = await db.query<{ name: string }>(
      "select name from server_emojis where server_id = $1",
      [serverId]
    );
    return new Set(rows.rows.map(r => r.name));
  });

  let pulled = 0;
  let skipped = 0;

  for (const [, emoji] of discordEmojis) {
    const name = emoji.name ?? emoji.id;
    if (existingNames.has(name)) {
      skipped++;
      continue;
    }

    const ext = emoji.animated ? "gif" : "webp";
    const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=96&quality=lossless`;

    try {
      await createServerEmoji({ serverId, name, url });
      existingNames.add(name);
      pulled++;
    } catch (err) {
      // Name collision — skip
      skipped++;
    }
  }

  return { pulled, skipped };
}

export async function createServerSticker(input: {
  serverId: string;
  name: string;
  url: string;
}): Promise<ServerSticker> {
  return withDb(async (db) => {
    const row = await db.query<ServerStickerRow>(
      `insert into server_stickers (id, server_id, name, url)
       values ($1, $2, $3, $4)
       returning *`,
      [randomId("stk"), input.serverId, input.name, input.url]
    );
    return mapServerSticker(row.rows[0]!);
  });
}

export async function listServerStickers(serverId: string): Promise<ServerSticker[]> {
  return withDb(async (db) => {
    const row = await db.query<ServerStickerRow>(
      "select * from server_stickers where server_id = $1 order by created_at desc",
      [serverId]
    );
    return row.rows.map(mapServerSticker);
  });
}

export async function deleteServerSticker(serverId: string, stickerId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query("delete from server_stickers where id = $1 and server_id = $2", [stickerId, serverId]);
  });
}

export async function createWebhook(input: {
  channelId: string;
  serverId: string;
  name: string;
  avatarUrl?: string;
}): Promise<Webhook> {
  const secretToken = crypto.randomBytes(32).toString("hex");
  return withDb(async (db) => {
    const row = await db.query<WebhookRow>(
      `insert into webhooks (id, channel_id, server_id, name, avatar_url, secret_token)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [randomId("whk"), input.channelId, input.serverId, input.name, input.avatarUrl || null, secretToken]
    );
    return mapWebhook(row.rows[0]!);
  });
}

export async function listWebhooks(serverId: string): Promise<Webhook[]> {
  return withDb(async (db) => {
    const row = await db.query<WebhookRow>(
      "select * from webhooks where server_id = $1",
      [serverId]
    );
    return row.rows.map(mapWebhook);
  });
}

export async function deleteWebhook(serverId: string, webhookId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query("delete from webhooks where id = $1 and server_id = $2", [webhookId, serverId]);
  });
}

export async function getWebhookByToken(id: string, token: string): Promise<Webhook | null> {
  return withDb(async (db) => {
    const row = await db.query<WebhookRow>(
      "select * from webhooks where id = $1 and secret_token = $2",
      [id, token]
    );
    const first = row.rows[0];
    return first ? mapWebhook(first) : null;
  });
}

// --- Announcements ---

export async function followAnnouncement(productUserId: string, sourceSpaceId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `insert into followed_announcements (product_user_id, source_space_id)
       values ($1, $2)
       on conflict do nothing`,
      [productUserId, sourceSpaceId]
    );
  });
}

export async function unfollowAnnouncement(productUserId: string, sourceSpaceId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      "delete from followed_announcements where product_user_id = $1 and source_space_id = $2",
      [productUserId, sourceSpaceId]
    );
  });
}

export async function listFollowedAnnouncements(productUserId: string): Promise<string[]> {
  return withDb(async (db) => {
    const row = await db.query<{ source_space_id: string }>(
      "select source_space_id from followed_announcements where product_user_id = $1",
      [productUserId]
    );
    return row.rows.map(r => r.source_space_id);
  });
}
