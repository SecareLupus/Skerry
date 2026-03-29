import { withDb } from "../db/client.js";
import type { HouseBotSettings, UserStats } from "@skerry/shared";
import { createMessage } from "./chat-service.js";

interface HouseBotSettingsRow {
  server_id: string;
  enabled: boolean;
  greeting_enabled: boolean;
  greeting_message: string | null;
  greeting_channel_id: string | null;
  engagement_enabled: boolean;
  live_notifications_enabled: boolean;
  live_notifications_channel_id: string | null;
  llm_enabled: boolean;
  llm_config: any;
  created_at: string;
  updated_at: string;
}

function mapHouseBotSettings(row: HouseBotSettingsRow): HouseBotSettings {
  return {
    serverId: row.server_id,
    enabled: row.enabled,
    greetingEnabled: row.greeting_enabled,
    greetingMessage: row.greeting_message,
    greetingChannelId: row.greeting_channel_id,
    engagementEnabled: row.engagement_enabled,
    liveNotificationsEnabled: row.live_notifications_enabled,
    liveNotificationsChannelId: row.live_notifications_channel_id,
    llmEnabled: row.llm_enabled,
    llmConfig: row.llm_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getHouseBotSettings(serverId: string): Promise<HouseBotSettings | null> {
  return withDb(async (db) => {
    const row = await db.query<HouseBotSettingsRow>("select * from house_bot_settings where server_id = $1", [serverId]);
    return row.rows[0] ? mapHouseBotSettings(row.rows[0]) : null;
  });
}

export async function updateHouseBotSettings(serverId: string, payload: Partial<HouseBotSettings>): Promise<void> {
  await withDb(async (db) => {
    const existing = await getHouseBotSettings(serverId);
    const enabled = payload.enabled ?? existing?.enabled ?? false;
    const greeting_enabled = payload.greetingEnabled ?? existing?.greetingEnabled ?? false;
    const greeting_message = payload.greetingMessage ?? existing?.greetingMessage ?? null;
    const greeting_channel_id = payload.greetingChannelId ?? existing?.greetingChannelId ?? null;
    const engagement_enabled = payload.engagementEnabled ?? existing?.engagementEnabled ?? false;
    const live_notifications_enabled = payload.liveNotificationsEnabled ?? existing?.liveNotificationsEnabled ?? false;
    const live_notifications_channel_id = payload.liveNotificationsChannelId ?? existing?.liveNotificationsChannelId ?? null;
    const llm_enabled = payload.llmEnabled ?? existing?.llmEnabled ?? false;
    const llm_config = payload.llmConfig ?? existing?.llmConfig ?? {};

    await db.query(
      `insert into house_bot_settings (
        server_id, enabled, greeting_enabled, greeting_message, greeting_channel_id,
        engagement_enabled, live_notifications_enabled, live_notifications_channel_id,
        llm_enabled, llm_config
      ) 
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (server_id) do update set
        enabled = excluded.enabled,
        greeting_enabled = excluded.greeting_enabled,
        greeting_message = excluded.greeting_message,
        greeting_channel_id = excluded.greeting_channel_id,
        engagement_enabled = excluded.engagement_enabled,
        live_notifications_enabled = excluded.live_notifications_enabled,
        live_notifications_channel_id = excluded.live_notifications_channel_id,
        llm_enabled = excluded.llm_enabled,
        llm_config = excluded.llm_config,
        updated_at = now()`,
      [
        serverId,
        enabled,
        greeting_enabled,
        greeting_message,
        greeting_channel_id,
        engagement_enabled,
        live_notifications_enabled,
        live_notifications_channel_id,
        llm_enabled,
        llm_config
      ]
    );
  });
}

export async function handleUserJoinedServer(serverId: string, productUserId: string, displayName: string) {
  const settings = await getHouseBotSettings(serverId);
  if (!settings || !settings.enabled || !settings.greetingEnabled || !settings.greetingChannelId) return;

  const messageTemplate = settings.greetingMessage || "Welcome to the server, {user}!";
  const content = messageTemplate.replace("{user}", `@${displayName}`);

  await createMessage({
    channelId: settings.greetingChannelId,
    actorUserId: "house_bot",
    content,
    isRelay: true,
    externalProvider: "house_bot",
    externalAuthorName: "House Bot"
  });
}

export async function handleUserMessageForEngagement(serverId: string, productUserId: string) {
  const settings = await getHouseBotSettings(serverId);
  if (!settings || !settings.enabled || !settings.engagementEnabled) return;

  await withDb(async (db) => {
    // Basic leveling logic: +10 points per message
    await db.query(
      `insert into user_stats (product_user_id, server_id, points, level, last_active_at, updated_at)
       values ($1, $2, 10, 1, now(), now())
       on conflict (product_user_id, server_id) do update set
         points = user_stats.points + 10,
         level = floor(sqrt((user_stats.points::float + 10) / 100)) + 1,
         last_active_at = now(),
         updated_at = now()`,
      [productUserId, serverId]
    );
  });
}

export async function getUserStats(serverId: string, productUserId: string): Promise<UserStats | null> {
  return withDb(async (db) => {
    const row = await db.query<UserStats>(
      "select product_user_id as productUserId, server_id as serverId, points, level, last_active_at as lastActiveAt, updated_at as updatedAt from user_stats where server_id = $1 and product_user_id = $2",
      [serverId, productUserId]
    );
    return row.rows[0] || null;
  });
}

// --- LLM Pipeline ---
export async function processLLMInteraction(serverId: string, channelId: string, content: string): Promise<string | null> {
  const settings = await getHouseBotSettings(serverId);
  if (!settings || !settings.enabled || !settings.llmEnabled) return null;

  // Placeholder for internal LLM pipeline
  console.log(`[LLM Pipeline] Processing prompt for server ${serverId}: ${content}`);
  
  // Here we would call an external API (OpenAI/Anthropic) using settings.llmConfig
  // For this phase, we just return a "processing" acknowledgement if it's the first time
  if (content.toLowerCase().includes("ping")) return "Pong! House Bot is active.";
  
  return null; 
}

// --- Live Notifications & Stream Tracking ---

export interface TrackedStream {
  id: string;
  serverId: string;
  platform: "twitch" | "youtube" | "custom";
  channelId: string;
  displayName: string;
  isLive: boolean;
  lastLiveAt: string | null;
  currentTitle: string | null;
  currentGame: string | null;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

export async function addTrackedStream(input: {
  serverId: string;
  platform: "twitch" | "youtube" | "custom";
  channelId: string;
  displayName: string;
}): Promise<TrackedStream> {
  const id = `str_${crypto.randomUUID().replaceAll("-", "")}`;
  return withDb(async (db) => {
    const row = await db.query(
      `insert into tracked_streams (id, server_id, platform, channel_id, display_name)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [id, input.serverId, input.platform, input.channelId, input.displayName]
    );
    return mapTrackedStream(row.rows[0]);
  });
}

function mapTrackedStream(row: any): TrackedStream {
  return {
    id: row.id,
    serverId: row.server_id,
    platform: row.platform,
    channelId: row.channel_id,
    displayName: row.display_name,
    isLive: row.is_live,
    lastLiveAt: row.last_live_at,
    currentTitle: row.current_title,
    currentGame: row.current_game,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listTrackedStreams(serverId: string): Promise<TrackedStream[]> {
  return withDb(async (db) => {
    const rows = await db.query("select * from tracked_streams where server_id = $1 order by is_live desc, updated_at desc", [serverId]);
    return rows.rows.map(mapTrackedStream);
  });
}

export async function updateStreamStatus(id: string, isLive: boolean, title?: string, game?: string) {
  return withDb(async (db) => {
    const row = await db.query(
      `update tracked_streams set
         is_live = $1,
         current_title = coalesce($2, current_title),
         current_game = coalesce($3, current_game),
         last_live_at = case when $1 = true then now() else last_live_at end,
         updated_at = now()
       where id = $4
       returning *`,
      [isLive, title || null, game || null, id]
    );

    const stream = row.rows[0];
    if (stream && isLive && !stream.was_live_reported) {
        // Send notification if enabled
        const settings = await getHouseBotSettings(stream.server_id);
        if (settings && settings.enabled && settings.liveNotificationsEnabled && settings.liveNotificationsChannelId) {
            await createMessage({
                channelId: settings.liveNotificationsChannelId,
                actorUserId: "house_bot",
                content: `🔴 **${stream.display_name}** is now LIVE on ${stream.platform}!\n**Title:** ${title ?? stream.current_title ?? "Live Stream"}\n**URL:** https://${stream.platform}.tv/${stream.channel_id}`,
                isRelay: true,
                externalProvider: "house_bot",
                externalAuthorName: "House Bot"
            });
        }
    }
  });
}

export async function checkLiveStatus(serverId: string) {
  const streams = await listTrackedStreams(serverId);
  // This is where we would trigger actual API polls.
  // For Phase 23, we provide the logic skeleton and a mock trigger.
  console.log(`[Live Status] Checking ${streams.length} tracked streams for server ${serverId}`);
}

