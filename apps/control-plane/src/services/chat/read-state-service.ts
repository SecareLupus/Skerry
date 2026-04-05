import type { ChannelReadState, MentionMarker } from "@skerry/shared";
import { withDb } from "../../db/client.js";

export async function getFirstUnreadMessageId(channelId: string, userId: string): Promise<string | null> {
  return withDb(async (db) => {
    const readState = await db.query<{ last_read_at: string }>(
      "select last_read_at from channel_read_states where channel_id = $1 and product_user_id = $2",
      [channelId, userId]
    );

    if (readState.rows.length === 0) {
      return null;
    }

    const lastReadAt = readState.rows[0]?.last_read_at;

    const msg = await db.query<{ id: string }>(
      `select id from chat_messages 
       where channel_id = $1 and deleted_at is null and created_at > $2
       order by created_at asc limit 1`,
      [channelId, lastReadAt]
    );

    return msg.rows[0]?.id ?? null;
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
      is_muted: boolean;
      notification_preference: "all" | "mentions" | "none";
      updated_at: string;
    }>(
      `select rs.channel_id, rs.product_user_id, rs.last_read_at, rs.is_muted, rs.notification_preference, rs.updated_at
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
      isMuted: row.is_muted,
      notificationPreference: row.notification_preference,
      updatedAt: row.updated_at
    }));
  });
}

export async function getChannelReadState(channelId: string, productUserId: string): Promise<ChannelReadState | null> {
  return withDb(async (db) => {
    const rows = await db.query<{
      channel_id: string;
      product_user_id: string;
      last_read_at: string;
      is_muted: boolean;
      notification_preference: "all" | "mentions" | "none";
      updated_at: string;
    }>(
      `select channel_id, product_user_id, last_read_at, is_muted, notification_preference, updated_at
       from channel_read_states
       where product_user_id = $1 and channel_id = $2
       limit 1`,
      [productUserId, channelId]
    );

    const row = rows.rows[0];
    if (!row) return null;

    return {
      channelId: row.channel_id,
      userId: row.product_user_id,
      lastReadAt: row.last_read_at,
      isMuted: row.is_muted,
      notificationPreference: row.notification_preference,
      updatedAt: row.updated_at
    };
  });
}

export async function upsertChannelReadState(input: {
  productUserId: string;
  channelId: string;
  at?: string;
  isMuted?: boolean;
  notificationPreference?: "all" | "mentions" | "none";
}): Promise<ChannelReadState> {
  return withDb(async (db) => {
    const rows = await db.query<{
      channel_id: string;
      product_user_id: string;
      last_read_at: string;
      is_muted: boolean;
      notification_preference: "all" | "mentions" | "none";
      updated_at: string;
    }>(
      `insert into channel_read_states(product_user_id, channel_id, last_read_at, is_muted, notification_preference)
       values($1, $2, coalesce($3::timestamptz, now()), coalesce($4, false), coalesce($5, 'all'))
       on conflict(product_user_id, channel_id)
       do update set 
         last_read_at = case when excluded.last_read_at is not null then excluded.last_read_at else channel_read_states.last_read_at end,
         is_muted = coalesce(excluded.is_muted, channel_read_states.is_muted),
         notification_preference = coalesce(excluded.notification_preference, channel_read_states.notification_preference),
         updated_at = now()
       returning channel_id, product_user_id, last_read_at, is_muted, notification_preference, updated_at`,
      [input.productUserId, input.channelId, input.at ?? null, input.isMuted ?? null, input.notificationPreference ?? null]
    );

    const row = rows.rows[0];
    if (!row) {
      throw new Error("Read state was not updated.");
    }

    return {
      channelId: row.channel_id,
      userId: row.product_user_id,
      lastReadAt: row.last_read_at,
      isMuted: row.is_muted,
      notificationPreference: row.notification_preference,
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

export async function getUnreadSummary(productUserId: string): Promise<Record<string, { unreadCount: number; mentionCount: number }>> {
  return withDb(async (db) => {
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
