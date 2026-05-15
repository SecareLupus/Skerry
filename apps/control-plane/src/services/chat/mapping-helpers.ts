import crypto from "node:crypto";
import type { AccessLevel, AudienceTier, Category, Channel, ChatMessage } from "@skerry/shared";

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
  auto_join_hub_members: boolean;
  allow_member_invites: boolean;
  created_by_user_id: string;
  owner_user_id: string;
  created_at: string;
  is_member?: boolean;
  join_policy: string;
}

const DEFAULT_TIER_LEVELS: Record<AudienceTier, AccessLevel> = {
  visitor: "hidden",
  hub_member: "chat",
  space_member: "chat",
  space_moderator: "chat",
  space_admin: "chat",
  hub_admin: "chat"
};

/**
 * P2.cleanup: the legacy `*_access` columns are gone. Channel/Server
 * response objects still carry `hubAdminAccess` etc. for API
 * back-compat — values are now sourced from `channel_access_rules` /
 * `space_access_rules`. Callers that need accurate values pass the
 * `rules` map; those that don't (e.g. realtime message payloads,
 * message-history responses) get conservative defaults.
 */
export function tierLevelOrDefault(
  rules: Partial<Record<AudienceTier, AccessLevel>> | undefined,
  tier: AudienceTier
): AccessLevel {
  return rules?.[tier] ?? DEFAULT_TIER_LEVELS[tier];
}

export function mapChannel(
  row: ChannelRow,
  rules?: Partial<Record<AudienceTier, AccessLevel>>
): Channel {
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
    hubAdminAccess: tierLevelOrDefault(rules, "hub_admin"),
    spaceAdminAccess: tierLevelOrDefault(rules, "space_admin"),
    spaceModeratorAccess: tierLevelOrDefault(rules, "space_moderator"),
    spaceMemberAccess: tierLevelOrDefault(rules, "space_member"),
    hubMemberAccess: tierLevelOrDefault(rules, "hub_member"),
    visitorAccess: tierLevelOrDefault(rules, "visitor"),
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
        userIds: [],
        displayNames: []
      };
      reactionsByEmoji[r.emoji] = reaction;
    }
    reaction.count++;
    reaction.userIds.push(r.user_id);
    if (!reaction.displayNames) reaction.displayNames = [];
    reaction.displayNames.push(r.display_name);
    if (viewerUserId && r.user_id === viewerUserId) {
      reaction.me = true;
    }
  }

  const isDeleted = Boolean(row.deleted_at);

  return {
    id: row.id,
    channelId: row.channel_id,
    authorUserId: isDeleted ? "deleted" : row.author_user_id,
    authorDisplayName: isDeleted ? "Deleted User" : row.author_display_name,
    content: isDeleted ? "Message deleted" : row.content,
    attachments: isDeleted ? undefined : (row.attachments ?? undefined),
    embeds: isDeleted ? undefined : (row.embeds ?? undefined),
    reactions: isDeleted ? [] : Object.values(reactionsByEmoji),
    isRelay: row.is_relay,
    externalProvider: row.external_provider ?? undefined,
    externalAuthorName: isDeleted ? undefined : (row.external_author_name ?? undefined),
    externalAuthorAvatarUrl: isDeleted ? undefined : (row.external_author_avatar_url ?? undefined),
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
