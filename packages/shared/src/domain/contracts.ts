export type Role = "hub_admin" | "space_owner" | "space_moderator" | "user";

export type ChannelType = "text" | "voice" | "announcement" | "dm" | "forum";

export type ModerationActionType =
    | "kick"
    | "ban"
    | "unban"
    | "timeout"
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
    | "moderation.redact"
    | "channel.lock"
    | "channel.unlock"
    | "channel.slowmode"
    | "channel.posting"
    | "voice.token.issue"
    | "reports.triage"
    | "audit.read";

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
    visibility?: string;
    visitorPrivacy?: string;
    createdAt: string;
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
    allowedRoleIds?: string[];
    topic: string | null;
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
    idempotencyKey?: string;
}

export interface ModerationAction {
    id: string;
    actionType: ModerationActionType;
    actorUserId: string;
    serverId: string;
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
    | "space_owner_transfer_completed";
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

export interface ChatMessage {
    id: string;
    channelId: string;
    authorUserId: string;
    authorDisplayName: string;
    content: string;
    attachments?: Attachment[];
    reactions?: Reaction[];
    isRelay?: boolean;
    externalProvider?: string;
    externalAuthorName?: string;
    externalAuthorAvatarUrl?: string;
    parentId?: string;
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
