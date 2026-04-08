import crypto from "node:crypto";
import type { Category, Channel, ChatMessage } from "@skerry/shared";

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function validateChannelStyle(style: string | null | undefined): void {
  if (!style) return;

  if (style.toLowerCase().includes("@import")) {
    throw new Error("CSS Safety: @import is not allowed.");
  }

  // Find all url(...) patterns and ensure they only use data: URIs
  const urlMatches = style.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi);
  for (const match of urlMatches) {
    const urlContent = (match[2] || "").trim();
    if (urlContent && !urlContent.startsWith("data:")) {
      throw new Error("CSS Safety: External url() resources are not allowed. Only data: URIs are permitted.");
    }
  }
}

export interface ChannelRow {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  type: Channel["type"];
  matrix_room_id: string | null;
  hub_admin_access: string;
  space_member_access: string;
  hub_member_access: string;
  visitor_access: string;
  is_locked: boolean;
  slow_mode_seconds: number;
  posting_restricted_to_roles: string[] | null;
  voice_sfu_room_id: string | null;
  voice_max_participants: number | null;
  video_enabled: boolean;
  video_max_participants: number | null;
  position: number;
  topic: string | null;
  icon_url: string | null;
  style_content: string | null;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  channel_id: string;
  author_user_id: string;
  author_display_name: string;
  content: string;
  attachments: ChatMessage["attachments"] | null;
  embeds: ChatMessage["embeds"] | null;
  is_relay: boolean;
  external_author_id: string | null;
  external_provider: string | null;
  external_author_name: string | null;
  external_author_avatar_url: string | null;
  parent_id: string | null;
  reply_to_id: string | null;
  external_thread_id: string | null;
  external_message_id?: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface ReactionRow {
  message_id: string;
  emoji: string;
  user_id: string;
  display_name: string;
}

export interface CategoryRow {
  id: string;
  server_id: string;
  name: string;
  matrix_subspace_id: string | null;
  position: number;
  created_at: string;
}

export interface ServerRow {
  id: string;
  hub_id: string;
  name: string;
  type: "default" | "dm";
  matrix_space_id: string | null;
  icon_url: string | null;
  hub_admin_access: string;
  space_member_access: string;
  hub_member_access: string;
  visitor_access: string;
  auto_join_hub_members: boolean;
  created_by_user_id: string;
  owner_user_id: string;
  created_at: string;
  is_member?: boolean;
  join_policy: string;
}

export function mapChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    serverId: row.server_id,
    categoryId: row.category_id,
    name: row.name,
    type: row.type,
    matrixRoomId: row.matrix_room_id,
    isLocked: row.is_locked,
    slowModeSeconds: row.slow_mode_seconds,
    postingRestrictedToRoles: (row.posting_restricted_to_roles ?? []) as Channel["postingRestrictedToRoles"],
    voiceMetadata:
      row.voice_sfu_room_id && row.voice_max_participants
        ? {
          sfuRoomId: row.voice_sfu_room_id,
          maxParticipants: row.voice_max_participants,
          videoEnabled: row.video_enabled,
          maxVideoParticipants: row.video_max_participants
        }
        : null,
    position: row.position,
    hubAdminAccess: row.hub_admin_access as any,
    spaceMemberAccess: row.space_member_access as any,
    hubMemberAccess: row.hub_member_access as any,
    visitorAccess: row.visitor_access as any,
    topic: row.topic,
    iconUrl: row.icon_url,
    styleContent: row.style_content,
    createdAt: row.created_at
  };
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    matrixSubspaceId: row.matrix_subspace_id,
    position: row.position,
    createdAt: row.created_at
  };
}

export function mapChatMessage(
  row: ChatMessageRow,
  repliesCountMap: Record<string, number>,
  reactionsMap: Record<string, ReactionRow[]>,
  viewerUserId?: string
): ChatMessage {
  const rawReactions = reactionsMap[row.id] ?? [];
  const reactionsByEmoji: Record<string, NonNullable<ChatMessage["reactions"]>[number]> = {};

  for (const r of rawReactions) {
    let reaction = reactionsByEmoji[r.emoji];
    if (!reaction) {
      reaction = {
        emoji: r.emoji,
        count: 0,
        me: false,
        userIds: []
      };
      reactionsByEmoji[r.emoji] = reaction;
    }
    reaction.count++;
    reaction.userIds.push(r.user_id);
    if (viewerUserId && r.user_id === viewerUserId) {
      reaction.me = true;
    }
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    content: row.content,
    attachments: row.attachments ?? undefined,
    embeds: row.embeds ?? undefined,
    reactions: Object.values(reactionsByEmoji),
    isRelay: row.is_relay,
    externalProvider: row.external_provider ?? undefined,
    externalAuthorName: row.external_author_name ?? undefined,
    externalAuthorAvatarUrl: row.external_author_avatar_url ?? undefined,
    parentId: row.parent_id ?? undefined,
    replyToId: row.reply_to_id ?? undefined,
    externalThreadId: row.external_thread_id ?? undefined,
    repliesCount: repliesCountMap[row.id] || 0,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}
