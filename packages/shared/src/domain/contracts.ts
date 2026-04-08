import { z } from "zod";

export type AccessLevel = "hidden" | "locked" | "read" | "chat";

export type Role = "hub_owner" | "hub_admin" | "space_owner" | "space_admin" | "space_moderator" | "user" | "visitor";


export interface MasqueradeParams {
    role: Role;
    serverId?: string;
    badgeIds?: string[];
}

export const MasqueradeParamsSchema = z.object({
    role: z.enum(["hub_owner", "hub_admin", "space_owner", "space_admin", "space_moderator", "user", "visitor"]),
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
    ownerUserId: string;
    startingChannelId?: string | null;
    iconUrl?: string | null;
    hubAdminAccess: AccessLevel;
    spaceMemberAccess: AccessLevel;
    hubMemberAccess: AccessLevel;
    visitorAccess: AccessLevel;
    autoJoinHubMembers: boolean;
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
}

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
}

export interface Reaction {
    emoji: string;
    count: number;
    me: boolean;
    userIds: string[];
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
    type?: "link" | "image" | "video" | "gifv";
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
    repliesCount?: number;
    isPinned?: boolean;
    createdAt: string;
    updatedAt?: string;
    deletedAt?: string;
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
    displayName: string;
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
