import { z } from "zod";

export type AccessLevel = "hidden" | "locked" | "read" | "chat";

/**
 * Audience tiers used by the normalized space/channel access rules
 * (see migration 036). Storage is in `space_access_rules` and
 * `channel_access_rules`, keyed on `(resource_id, audience_tier)`.
 *
 * Tiers represent *who* a rule applies to:
 *   - `visitor`         — no membership row and no granted role.
 *   - `hub_member`      — a row in `hub_members`; not in this server's
 *                         `server_members`.
 *   - `space_member`    — a row in `server_members` for this server.
 *   - `space_moderator` — explicit `space_moderator` role binding.
 *   - `space_admin`     — explicit `space_admin` role binding;
 *                         `space_owner` inherits.
 *   - `hub_admin`       — explicit `hub_admin` role binding;
 *                         `hub_owner` inherits.
 *
 * Each user resolves to their HIGHEST tier when access is computed
 * (admins outrank members, members outrank visitors).
 */
export type AudienceTier =
    | "visitor"
    | "hub_member"
    | "space_member"
    | "space_moderator"
    | "space_admin"
    | "hub_admin";

export const AUDIENCE_TIERS: ReadonlyArray<AudienceTier> = [
    "visitor",
    "hub_member",
    "space_member",
    "space_moderator",
    "space_admin",
    "hub_admin"
];

export interface AccessRule {
    audienceTier: AudienceTier;
    level: AccessLevel;
}

/**
 * Granted roles. `Role` values are explicitly assigned via `role_bindings`.
 *
 * Historic note (P1 of permissions sprint, 2026-05-07): `user` and `visitor`
 * were removed. They were tier *classifiers* derived from membership state,
 * not roles. Hub Member = a row in `hub_members`. Visitor = no membership
 * row and no granted role. Code that needs to identify those tiers reads
 * from membership tables, not from `Role`.
 */
export type Role = "hub_owner" | "hub_admin" | "space_owner" | "space_admin" | "space_moderator";


export interface MasqueradeParams {
    role: Role;
    serverId?: string;
    badgeIds?: string[];
}

export const MasqueradeParamsSchema = z.object({
    role: z.enum(["hub_owner", "hub_admin", "space_owner", "space_admin", "space_moderator"]),
    serverId: z.string().optional(),
    badgeIds: z.array(z.string()).optional()
});


export type ChannelType = "text" | "voice" | "announcement" | "dm" | "forum" | "landing";

export type JoinPolicy = "open" | "approval" | "invite";

export type HubSuspension = {
    isSuspended: boolean;
    suspendedAt: string | null;
    expiresAt: string | null;
    unlockCodeHash?: string | null;
};

export interface Badge {
    id: string;
    hubId: string;
    serverId: string;
    name: string;
    rank: number; // For precedence
    description: string | null;
    createdAt: string;
}

export interface UserBadge {
    userId: string;
    badgeId: string;
    assignedAt: string;
}

export interface ChannelBadgeRule {
    channelId: string;
    badgeId: string;
    accessLevel: AccessLevel | null;
    createdAt: string;
}

export interface ServerBadgeRule {
    serverId: string;
    badgeId: string;
    accessLevel: AccessLevel | null;
    createdAt: string;
}

export type ModerationActionType =
    | "kick"
    | "ban"
    | "unban"
    | "timeout"
    | "warn"
    | "strike"
    | "redact_message"
    | "lock_channel"
    | "unlock_channel"
    | "set_slow_mode"
    | "set_posting_restrictions";

export type ReportStatus = "open" | "triaged" | "resolved" | "dismissed";
export type PrivilegedAction =
    | "moderation.kick"
    | "moderation.ban"
    | "moderation.unban"
    | "moderation.timeout"
    | "moderation.warn"
    | "moderation.strike"
    | "moderation.redact"
    | "channel.lock"
    | "channel.unlock"
    | "channel.slowmode"
    | "channel.posting"
    | "voice.token.issue"
    | "reports.triage"
    | "audit.read"
    | "hub.suspend"
    | "hub.delete"
    | "badges.manage"
    | "channel.message.read"
    | "channel.message.send"
    | "channel.voice.join";
 
export interface ViewerRoleBinding {
    role: Role;
    hubId: string | null;
    serverId: string | null;
    channelId: string | null;
    isOwnerSuspended?: boolean;
}

export interface ServerBlueprint {
    serverName: string;
    defaultChannels: Array<{
        name: string;
        type: ChannelType;
    }>;
}

export interface S3Config {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrlPrefix: string;
}

export interface Hub {
    id: string;
    name: string;
    ownerUserId: string;
    s3Config?: S3Config;
    theme?: Record<string, any>;
    spaceCustomizationLimits?: Record<string, any>;
    oidcConfig?: Record<string, any>;
    allowSpaceDiscordBridge?: boolean;
    allowSpaceCustomization?: boolean;
    defaultAutoJoinHubMembers?: boolean;
    suspension?: HubSuspension;
    createdAt: string;
}

export interface Server {
    id: string;
    hubId: string;
    name: string;
    type: "default" | "dm";
    matrixSpaceId: string | null;
    createdByUserId: string;
    /**
     * Explicit space owner. `null` means the space is owned by the hub
     * itself — any hub manager may manage it, no individual user holds
     * the owner role. P3 of the permissions sprint (2026-05-08) made
     * this the default for newly-created spaces.
     */
    ownerUserId: string | null;
    startingChannelId?: string | null;
    iconUrl?: string | null;
    hubAdminAccess: AccessLevel;
    spaceMemberAccess: AccessLevel;
    hubMemberAccess: AccessLevel;
    visitorAccess: AccessLevel;
    /** P2.b: optional access for the new audience tiers. Default 'chat'. */
    spaceAdminAccess?: AccessLevel;
    spaceModeratorAccess?: AccessLevel;
    autoJoinHubMembers: boolean;
    allowMemberInvites: boolean;
    joinPolicy: JoinPolicy;
    theme?: Record<string, any>;
    createdAt: string;
    isMember?: boolean;
}

export interface Category {
    id: string;
    serverId: string;
    name: string;
    matrixSubspaceId: string | null;
    position: number;
    createdAt: string;
}

export interface Channel {
    id: string;
    serverId: string;
    categoryId: string | null;
    name: string;
    type: ChannelType;
    matrixRoomId: string | null;
    position: number;
    isLocked: boolean;
    slowModeSeconds: number;
    postingRestrictedToRoles: Role[];
    voiceMetadata: VoiceMetadata | null;
    restrictedVisibility?: boolean;
    hubAdminAccess: AccessLevel;
    spaceMemberAccess: AccessLevel;
    hubMemberAccess: AccessLevel;
    visitorAccess: AccessLevel;
    /** P2.b: optional access for the new audience tiers. Default 'chat'. */
    spaceAdminAccess?: AccessLevel;
    spaceModeratorAccess?: AccessLevel;
    topic: string | null;
    iconUrl?: string | null;
    styleContent?: string | null;
    participants?: { productUserId: string; displayName: string }[];
    createdAt: string;
}

export interface VoiceMetadata {
    sfuRoomId: string;
    maxParticipants: number;
    videoEnabled?: boolean;
    maxVideoParticipants?: number | null;
}

export interface MatrixProvisioningDefaults {
    joinRule: "invite" | "public";
    historyVisibility: "joined" | "invited" | "shared" | "world_readable";
}

export interface CreateServerRequest {
    hubId: string;
    name: string;
    idempotencyKey?: string;
}

export interface CreateChannelRequest {
    serverId: string;
    categoryId?: string;
    name: string;
    type: ChannelType;
    topic?: string;
    iconUrl?: string;
    idempotencyKey?: string;
}

export interface ModerationAction {
    id: string;
    actionType: ModerationActionType;
    actorUserId: string;
    hubId: string | null;
    serverId: string | null;
    channelId: string | null;
    targetUserId: string | null;
    targetMessageId: string | null;
    reason: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface ModerationReport {
    id: string;
    serverId: string;
    channelId: string | null;
    reporterUserId: string;
    targetUserId: string | null;
    targetMessageId: string | null;
    reason: string;
    status: ReportStatus;
    triagedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface VoiceTokenGrant {
    channelId: string;
    serverId: string;
    sfuUrl: string;
    sfuRoomId: string;
    participantUserId: string;
    token: string;
    expiresAt: string;
}

export interface VoicePresenceMember {
    channelId: string;
    serverId: string;
    userId: string;
    displayName: string;
    muted: boolean;
    deafened: boolean;
    videoEnabled: boolean;
    videoQuality: "low" | "medium" | "high";
    joinedAt: string;
    updatedAt: string;
}

export interface HubFederationPolicy {
    hubId: string;
    allowlist: string[];
    updatedByUserId: string;
    createdAt: string;
    updatedAt: string;
}

export interface FederationPolicyEvent {
    id: string;
    hubId: string;
    actorUserId: string;
    actionType: "policy_updated" | "policy_reconciled";
    policy: {
        allowlist: string[];
    };
    createdAt: string;
}

export interface FederationPolicyStatus {
    roomId: string;
    hubId: string;
    serverId: string | null;
    channelId: string | null;
    roomKind: "space" | "room";
    allowlist: string[];
    status: "applied" | "skipped" | "error";
    lastError: string | null;
    appliedAt: string | null;
    checkedAt: string;
    updatedAt: string;
}

export interface HubInvite {
    id: string;
    hubId: string;
    createdByUserId: string;
    expiresAt: string | null;
    maxUses: number | null;
    usesCount: number;
    createdAt: string;
    defaultRole: Role | null;
    defaultServerId: string | null;
    /** Badge IDs applied on redemption. Empty array if none. */
    defaultBadgeIds: string[];
    /**
     * When non-null, the invite was revoked at this timestamp. Revoked invites
     * are not returned by `getHubInvite` (so the public splash 404s) and
     * `useHubInvite` rejects them. Already-redeemed users keep their
     * bindings.
     */
    revokedAt: string | null;
}

/**
 * Roles that are allowed to be baked into an invite link. Hub-level
 * ownership/admin roles and `space_owner` are intentionally excluded —
 * those should only be granted by a deliberate admin action, not via a
 * shareable URL.
 *
 * Note: an invite with no `defaultRole` simply grants hub membership
 * (and optionally space membership via `defaultServerId`). The previous
 * `"user"` option was redundant once `user` left the Role enum in the
 * P1 permissions sprint — pass `defaultRole: null` instead.
 */
export const INVITE_BAKEABLE_ROLES = [
    "space_moderator",
    "space_admin"
] as const satisfies ReadonlyArray<Role>;
export type InviteBakeableRole = (typeof INVITE_BAKEABLE_ROLES)[number];

export interface DiscordBridgeConnection {
    id: string;
    serverId: string;
    connectedByUserId: string;
    guildId: string | null;
    guildName: string | null;
    status: "disconnected" | "connected" | "degraded" | "syncing";
    lastSyncAt: string | null;
    lastError: string | null;
    updatedAt: string;
}

export interface DiscordBridgeChannelMapping {
    id: string;
    serverId: string;
    guildId: string;
    discordChannelId: string;
    discordChannelName: string;
    matrixChannelId: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export type DelegationAssignmentStatus = "active" | "revoked" | "expired";

export interface SpaceOwnerAssignment {
    id: string;
    hubId: string;
    serverId: string;
    assignedUserId: string;
    assignedByUserId: string;
    status: DelegationAssignmentStatus;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DelegationAuditEvent {
    id: string;
    actionType:
    | "space_owner_assigned"
    | "space_owner_revoked"
    | "space_owner_transfer_started"
    | "space_owner_transfer_completed"
    | "hub_owner_transfer_started"
    | "hub_owner_transfer_completed";
    actorUserId: string;
    targetUserId: string | null;
    assignmentId: string | null;
    hubId: string | null;
    serverId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface ChannelReadState {
    channelId: string;
    userId: string;
    lastReadAt: string;
    isMuted?: boolean;
    notificationPreference: "all" | "mentions" | "none";
    updatedAt: string;
}

export interface MentionMarker {
    id: string;
    channelId: string;
    messageId: string;
    mentionedUserId: string;
    createdAt: string;
}

export interface Attachment {
    id: string;
    url: string;
    contentType: string;
    filename: string;
    size?: number;
    sourceUrl?: string;
    isSticker?: boolean;
}

export interface Reaction {
    emoji: string;
    count: number;
    me: boolean;
    userIds: string[];
    displayNames?: string[];
}

export interface LinkEmbed {
    url: string;
    title?: string;
    description?: string;
    siteName?: string;
    imageUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    videoUrl?: string; // For things like YouTube/Vimeo embeds
    type?: "link" | "image" | "video" | "gif" | "gifv";
}

export interface ChatMessage {
    id: string;
    channelId: string;
    authorUserId: string;
    authorDisplayName: string;
    content: string;
    attachments?: Attachment[];
    reactions?: Reaction[];
    embeds?: LinkEmbed[];
    isRelay?: boolean;
    externalProvider?: string;
    externalAuthorName?: string;
    externalAuthorAvatarUrl?: string;
    parentId?: string;
    replyToId?: string;
    externalThreadId?: string;
    externalMessageId?: string;
    repliesCount?: number;
    isPinned?: boolean;
    createdAt: string;
    updatedAt?: string;
    deletedAt?: string;
}


export interface MessageRevision {
  id: string;
  messageId: string;
  content: string;
  editorUserId: string;
  createdAt: string;
}


export interface ChannelMember {
    channelId: string;
    productUserId: string;
    createdAt: string;
}

export interface UserBlock {
    blockerUserId: string;
    blockedUserId: string;
    createdAt: string;
}

export const DEFAULT_SERVER_BLUEPRINT: ServerBlueprint = {
    serverName: "New Creator Server",
    defaultChannels: [
        { name: "announcements", type: "announcement" },
        { name: "general", type: "text" },
        { name: "voice-lounge", type: "voice" }
    ]
};

export interface ServerEmoji {
    id: string;
    serverId: string;
    name: string;
    url: string;
    createdAt: string;
    updatedAt: string;
}

export interface DiscordGuildEmoji {
    id: string;
    name: string;
    isAnimated: boolean;
    isMirrored: boolean; // Already mirrored into this space
    url: string;
}

export interface ServerSticker {
    id: string;
    serverId: string;
    name: string;
    url: string;
    createdAt: string;
    updatedAt: string;
}

export interface Webhook {
    id: string;
    channelId: string;
    serverId: string;
    name: string;
    avatarUrl?: string | null;
    secretToken: string;
    createdAt: string;
    updatedAt: string;
}

export interface UserStats {
    productUserId: string;
    serverId: string;
    points: number;
    level: number;
    lastActiveAt: string;
    updatedAt: string;
}

export interface HouseBotSettings {
    serverId: string;
    enabled: boolean;
    greetingEnabled: boolean;
    greetingMessage?: string | null;
    greetingChannelId?: string | null;
    engagementEnabled: boolean;
    liveNotificationsEnabled: boolean;
    liveNotificationsChannelId?: string | null;
    llmEnabled: boolean;
    llmConfig: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface DiscordEmojiMapping {
    id: string;
    serverId: string;
    skerryEmojiId: string;
    discordEmojiId: string;
    discordEmojiName: string;
    createdAt: string;
}

export interface TrustedHub {
    hubUrl: string;
    sharedSecret: string;
    trustLevel: "guest" | "member" | "partner";
    metadata: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface FederatedUser {
    federatedId: string;
    localProxyUserId: string;
    hubUrl: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    lastSeenAt: string;
    createdAt: string;
}

export interface FollowedAnnouncement {
    id: string;
    productUserId: string;
    sourceSpaceId: string;
    createdAt: string;
}


export interface ChannelMemberFull {
    productUserId: string;
    oidcDisplayName: string | null;
    displayName: string | null;
    avatarUrl?: string;
    isOnline: boolean;
    lastSeenAt?: string;
    isBridged?: boolean;
    bridgedUserStatus?: string;
}

export interface ChannelInitResponse {
    channel: Channel;
    messages: ChatMessage[];
    members: ChannelMemberFull[];
    readState: ChannelReadState | null;
    permissions: PrivilegedAction[];
}

// --- Audit Log -------------------------------------------------------

export const AUDIT_ACTION_TYPES = [
    "role.grant",
    "role.revoke",
    "channel.create",
    "channel.delete",
    "channel.update",
    "category.create",
    "category.delete",
    "category.update",
    "moderation.warn",
    "moderation.strike",
    "moderation.mute",
    "moderation.kick",
    "moderation.ban",
    "permission.edit",
    "invite.generate",
    "invite.redeem",
    "integration.connect",
    "integration.disconnect",
    "server.update",
] as const;

export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

export interface AuditLogEntry {
    id: string;
    serverId: string;
    actorUserId: string;
    actionType: AuditActionType;
    targetType: string;          // e.g. "user", "channel", "role"
    targetId: string;
    beforeSnapshot: Record<string, unknown> | null;
    afterSnapshot: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;  // IP, user-agent, reason, etc.
    createdAt: string;
}

export interface AuditLogQuery {
    serverId: string;
    actorUserId?: string;
    targetId?: string;
    actionType?: AuditActionType;
    before?: string;   // ISO timestamp
    after?: string;    // ISO timestamp
    limit?: number;
    offset?: number;
}

// --- Push Notifications -----------------------------------------------

export interface PushSubscription {
    id: string;
    productUserId: string;
    endpoint: string;
    p256dhKey: string;
    authKey: string;
    serverId?: string | null;
    createdAt: string;
}
