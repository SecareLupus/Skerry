import crypto from "node:crypto";
import { withDb } from "../db/client.js";
import type { ServerEmoji, ServerSticker, Webhook } from "@skerry/shared";

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
