import type {
  Category,
  Channel,
  ChannelReadState,
  ChannelType,
  ChatMessage,
  DiscordBridgeChannelMapping,
  DiscordBridgeConnection,
  FederationPolicyEvent,
  FederationPolicyStatus,
  Hub,
  MentionMarker,
  ModerationAction,
  ModerationReport,
  ReportStatus,
  Role,
  Server,
  SpaceOwnerAssignment,
  DelegationAuditEvent,
  IdentityMapping,
  VoicePresenceMember,
  VoiceTokenGrant,
  HubInvite
} from "@skerry/shared";
export type { IdentityMapping, VoicePresenceMember };


const publicBaseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "localhost";
const isLocal = publicBaseDomain === "localhost" || publicBaseDomain === "127.0.0.1";

// SSR needs to talk to the control-plane container directly via Docker network.
// Browser can use relative paths since Caddy proxies /v1 and /auth to the control-plane.
const isServer = typeof window === "undefined";

export const controlPlaneBaseUrl =
  process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ||
  (isServer ? "http://control-plane:4000" : "");

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface ViewerSession {
  productUserId: string;
  identity: {
    provider: string;
    oidcSubject: string;
    preferredUsername: string | null;
    email: string | null;
    avatarUrl?: string | null;
    displayName?: string | null;
    bio?: string | null;
    customStatus?: string | null;
    matrixUserId?: string | null;
    isBridged?: boolean;
    bannerUrl?: string | null;
    theme?: "light" | "dark" | null;
  } | null;
  linkedIdentities: Array<{
    provider: string;
    oidcSubject: string;
    preferredUsername: string | null;
    email: string | null;
    avatarUrl: string | null;
    theme?: "light" | "dark" | null;
  }>;
  needsOnboarding: boolean;
}

export interface BootstrapStatus {
  initialized: boolean;
  bootstrapCompletedAt?: string | null;
  bootstrapAdminUserId?: string | null;
  bootstrapHubId?: string | null;
  defaultServerId?: string | null;
  defaultChannelId?: string | null;
  code?: string;
  message?: string;
}

export interface AuthProviderDescriptor {
  provider: string;
  displayName: string;
  isEnabled: boolean;
  requiresReauthentication: boolean;
}

export interface AuthProvidersResponse {
  primaryProvider: string;
  providers: AuthProviderDescriptor[];
}

export interface FederationPolicySnapshot {
  policy: {
    hubId: string;
    allowlist: string[];
    updatedByUserId: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  status: {
    totalRooms: number;
    appliedRooms: number;
    errorRooms: number;
    skippedRooms: number;
  };
  rooms: FederationPolicyStatus[];
  recentChanges: FederationPolicyEvent[];
}

export interface ViewerRoleBinding {
  role: "hub_admin" | "space_owner" | "space_moderator" | "user";
  hubId: string | null;
  serverId: string | null;
  channelId: string | null;
}

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

export class ControlPlaneApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(input: { message: string; statusCode: number; code?: string; requestId?: string }) {
    super(input.message);
    this.name = "ControlPlaneApiError";
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.requestId = input.requestId;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${controlPlaneBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init
  });

  if (!response.ok) {
    const fallbackMessage = `${response.status} ${response.statusText}`;
    const maybeJson = (await response
      .json()
      .catch(() => ({ message: fallbackMessage }))) as
      | { message?: unknown; code?: unknown; requestId?: unknown }
      | null;

    const message =
      typeof maybeJson === "object" && maybeJson !== null && "message" in maybeJson
        ? String(maybeJson.message)
        : fallbackMessage;
    const code =
      typeof maybeJson === "object" && maybeJson !== null && "code" in maybeJson
        ? String(maybeJson.code)
        : undefined;
    const requestIdFromBody =
      typeof maybeJson === "object" && maybeJson !== null && "requestId" in maybeJson
        ? String(maybeJson.requestId)
        : undefined;
    const requestId = requestIdFromBody ?? response.headers.get("x-request-id") ?? undefined;
    const decoratedMessage = requestId ? `${message} (request ${requestId})` : message;

    throw new ControlPlaneApiError({
      message: decoratedMessage,
      statusCode: response.status,
      code,
      requestId
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchAuthProviders(): Promise<AuthProvidersResponse> {
  return apiFetch<AuthProvidersResponse>("/auth/providers");
}

export async function fetchViewerSession(): Promise<ViewerSession | null> {
  try {
    return await apiFetch<ViewerSession>("/auth/session/me");
  } catch {
    return null;
  }
}

export async function fetchBootstrapStatus(): Promise<BootstrapStatus> {
  const response = await fetch(`${controlPlaneBaseUrl}/auth/bootstrap-status`, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    return {
      initialized: false,
      code: "bootstrap_status_unavailable",
      message: "Unable to load bootstrap status."
    };
  }

  return (await response.json()) as BootstrapStatus;
}

export async function bootstrapAdmin(input: {
  setupToken: string;
  hubName: string;
}): Promise<{ initialized: true; hubId: string; defaultServerId: string; defaultChannelId: string }> {
  return apiFetch("/auth/bootstrap-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", {
    method: "POST"
  });
}

export async function completeUsernameOnboarding(username: string): Promise<void> {
  await apiFetch("/auth/onboarding/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });
}

export async function updateUserTheme(theme: "light" | "dark"): Promise<void> {
  await apiFetch("/auth/session/me/theme", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme })
  });
}

export async function updateUserProfile(input: {
  displayName?: string | null;
  bio?: string | null;
  customStatus?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}): Promise<void> {
  await apiFetch("/auth/session/me/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listServers(): Promise<Server[]> {
  const json = await apiFetch<{ items: Server[] }>("/v1/servers");
  return json.items;
}

export async function listHubs(): Promise<Hub[]> {
  const json = await apiFetch<{ items: Hub[] }>("/v1/hubs");
  return json.items;
}

export async function listViewerRoleBindings(): Promise<ViewerRoleBinding[]> {
  const json = await apiFetch<{ items: ViewerRoleBinding[] }>("/v1/me/roles");
  return json.items;
}

export async function listChannels(serverId: string): Promise<Channel[]> {
  const json = await apiFetch<{ items: Channel[] }>(`/v1/servers/${encodeURIComponent(serverId)}/channels`);
  return json.items;
}

export async function searchUsers(query: string): Promise<IdentityMapping[]> {
  const q = new URLSearchParams({ q: query });
  const json = await apiFetch<{ items: IdentityMapping[] }>(`/v1/users/search?${q.toString()}`);
  return json.items;
}

export async function createDirectMessage(hubId: string, userIds: string[]): Promise<Channel> {
  return apiFetch<Channel>(`/v1/hubs/${encodeURIComponent(hubId)}/dms`, {
    method: "POST",
    body: JSON.stringify({ userIds })
  });
}

export async function fetchUser(userId: string): Promise<IdentityMapping> {
  return apiFetch<IdentityMapping>(`/v1/users/${encodeURIComponent(userId)}`);
}

export async function listCategories(serverId: string): Promise<Category[]> {
  const json = await apiFetch<{ items: Category[] }>(
    `/v1/servers/${encodeURIComponent(serverId)}/categories`
  );
  return json.items;
}

export async function listMessages(channelId: string, parentId?: string | null): Promise<ChatMessage[]> {
  const query = new URLSearchParams({ limit: "100" });
  if (parentId !== undefined) {
    if (parentId === null) {
      query.set("parentId", "null");
    } else {
      query.set("parentId", parentId);
    }
  }
  const json = await apiFetch<{ items: ChatMessage[] }>(
    `/v1/channels/${encodeURIComponent(channelId)}/messages?${query.toString()}`
  );
  return json.items;
}

export async function searchMessages(input: {
  channelId?: string;
  serverId?: string;
  query: string;
  limit?: number;
  before?: string;
}): Promise<ChatMessage[]> {
  const q = new URLSearchParams({ q: input.query });
  if (input.limit) q.set("limit", String(input.limit));
  if (input.before) q.set("before", input.before);

  let path = "";
  if (input.channelId) {
    path = `/v1/channels/${encodeURIComponent(input.channelId)}/messages/search?${q.toString()}`;
  } else if (input.serverId) {
    path = `/v1/servers/${encodeURIComponent(input.serverId)}/messages/search?${q.toString()}`;
  } else {
    throw new Error("Either channelId or serverId must be provided for search");
  }

  const json = await apiFetch<{ items: ChatMessage[] }>(path);
  return json.items;
}

export async function listMessagesAround(channelId: string, messageId: string, limit = 50): Promise<ChatMessage[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const json = await apiFetch<{ items: ChatMessage[] }>(
    `/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/around?${query.toString()}`
  );
  return json.items;
}

export async function getFirstUnreadMessageId(channelId: string): Promise<string | null> {
  const json = await apiFetch<{ messageId: string | null }>(`/v1/channels/${encodeURIComponent(channelId)}/unread-message`);
  return json.messageId;
}

export async function sendMessage(channelId: string, content: string, attachments?: ChatMessage["attachments"], parentId?: string): Promise<ChatMessage> {
  return apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, attachments, parentId })
  });
}

export async function updateMessage(channelId: string, messageId: string, content: string): Promise<ChatMessage> {
  return apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE"
  });
}

export async function addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji })
  });
}

export async function removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`, {
    method: "DELETE"
  });
}

export async function pinMessage(channelId: string, messageId: string): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/pin`, {
    method: "POST"
  });
}

export async function unpinMessage(channelId: string, messageId: string): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/v1/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/pin`, {
    method: "DELETE"
  });
}

export async function sendTypingStatus(channelId: string, isTyping: boolean): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/typing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isTyping })
  });
}

export async function createServer(input: { hubId: string; name: string }): Promise<Server> {
  return apiFetch<Server>("/v1/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function fetchFederationPolicy(hubId: string): Promise<FederationPolicySnapshot> {
  return apiFetch<FederationPolicySnapshot>(`/v1/hubs/${encodeURIComponent(hubId)}/federation-policy`);
}

export async function updateFederationPolicy(input: {
  hubId: string;
  allowlist: string[];
}): Promise<FederationPolicySnapshot["policy"]> {
  return apiFetch<FederationPolicySnapshot["policy"]>(
    `/v1/hubs/${encodeURIComponent(input.hubId)}/federation-policy`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowlist: input.allowlist })
    }
  );
}

export async function reconcileFederationPolicy(hubId: string): Promise<{
  checkedRooms: number;
  appliedRooms: number;
  failedRooms: number;
}> {
  return apiFetch(`/v1/hubs/${encodeURIComponent(hubId)}/federation-policy/reconcile`, {
    method: "POST"
  });
}

export async function createChannel(input: {
  serverId: string;
  name: string;
  type: ChannelType;
  categoryId?: string;
}): Promise<Channel> {
  return apiFetch<Channel>("/v1/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function createCategory(input: {
  serverId: string;
  name: string;
}): Promise<Category> {
  return apiFetch<Category>("/v1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function renameCategory(input: {
  serverId: string;
  categoryId: string;
  name?: string;
  position?: number;
}): Promise<Category> {
  return apiFetch<Category>(`/v1/categories/${encodeURIComponent(input.categoryId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: input.serverId,
      name: input.name,
      position: input.position
    })
  });
}

export async function deleteCategory(input: { serverId: string; categoryId: string }): Promise<void> {
  await apiFetch(`/v1/categories/${encodeURIComponent(input.categoryId)}?serverId=${encodeURIComponent(input.serverId)}`, {
    method: "DELETE"
  });
}

export async function moveChannelCategory(input: {
  channelId: string;
  serverId: string;
  categoryId: string | null;
}): Promise<Channel> {
  return apiFetch<Channel>(`/v1/channels/${encodeURIComponent(input.channelId)}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: input.serverId,
      categoryId: input.categoryId
    })
  });
}

export async function renameServer(input: { serverId: string; name: string }): Promise<Server> {
  return apiFetch<Server>(`/v1/servers/${encodeURIComponent(input.serverId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name })
  });
}

export async function deleteServer(serverId: string): Promise<void> {
  await apiFetch(`/v1/servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE"
  });
}

export async function renameChannel(input: {
  serverId: string;
  channelId: string;
  name?: string;
  type?: ChannelType;
  categoryId?: string | null;
  position?: number;
}): Promise<Channel> {
  return updateChannel(input.channelId, {
    serverId: input.serverId,
    name: input.name,
    type: input.type,
    categoryId: input.categoryId,
    position: input.position
  });
}

export async function updateChannel(
  channelId: string,
  payload: {
    serverId: string;
    name?: string;
    type?: ChannelType;
    categoryId?: string | null;
    topic?: string | null;
    position?: number;
  }
): Promise<Channel> {
  return apiFetch<Channel>(`/v1/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function listChannelMembers(
  channelId: string
): Promise<{
  productUserId: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  lastSeenAt?: string;
  isBridged?: boolean;
  bridgedUserStatus?: string;
}[]> {
  const json = await apiFetch<{
    items: {
      productUserId: string;
      displayName: string;
      avatarUrl?: string;
      isOnline: boolean;
      lastSeenAt?: string;
      isBridged?: boolean;
      bridgedUserStatus?: string;
    }[];
  }>(`/v1/channels/${encodeURIComponent(channelId)}/members`);
  return json.items;
}

export async function inviteToChannel(channelId: string, productUserId: string): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productUserId })
  });
}

export async function deleteChannel(input: { channelId: string; serverId: string }): Promise<void> {
  const query = new URLSearchParams({ serverId: input.serverId });
  await apiFetch(`/v1/channels/${encodeURIComponent(input.channelId)}?${query.toString()}`, {
    method: "DELETE"
  });
}

export async function createHubInvite(hubId: string, options: { expiresAt?: string; maxUses?: number } = {}): Promise<HubInvite> {
  return apiFetch<HubInvite>(`/v1/hubs/${encodeURIComponent(hubId)}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
}

export async function fetchHubInvite(inviteId: string): Promise<HubInvite> {
  return apiFetch<HubInvite>(`/v1/invites/${encodeURIComponent(inviteId)}`);
}

export async function joinHubByInvite(inviteId: string): Promise<{ hubId: string }> {
  return apiFetch<{ hubId: string }>(`/v1/invites/${encodeURIComponent(inviteId)}/join`, {
    method: "POST"
  });
}

export async function fetchAllowedActions(
  serverId: string,
  channelId?: string,
  productUserId?: string
): Promise<PrivilegedAction[]> {
  const query = new URLSearchParams({ serverId });
  if (channelId) {
    query.set("channelId", channelId);
  }
  if (productUserId) {
    query.set("productUserId", productUserId);
  }

  const json = await apiFetch<{ items: PrivilegedAction[] }>(`/v1/permissions?${query.toString()}`);
  return json.items;
}

export async function updateChannelControls(input: {
  channelId: string;
  serverId: string;
  reason: string;
  lock?: boolean;
  slowModeSeconds?: number;
}): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(input.channelId)}/controls`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: input.serverId,
      reason: input.reason,
      ...(typeof input.lock === "boolean" ? { lock: input.lock } : {}),
      ...(typeof input.slowModeSeconds === "number" ? { slowModeSeconds: input.slowModeSeconds } : {})
    })
  });
}

export async function updateChannelVideoControls(input: {
  channelId: string;
  serverId: string;
  videoEnabled: boolean;
  maxVideoParticipants?: number;
}): Promise<Channel> {
  return apiFetch<Channel>(`/v1/channels/${encodeURIComponent(input.channelId)}/video-controls`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listChannelReadStates(serverId: string): Promise<ChannelReadState[]> {
  const json = await apiFetch<{ items: ChannelReadState[] }>(
    `/v1/servers/${encodeURIComponent(serverId)}/read-states`
  );
  return json.items;
}

export async function upsertChannelReadState(
  channelId: string,
  payload?: {
    at?: string;
    isMuted?: boolean;
    notificationPreference?: "all" | "mentions" | "none";
  }
): Promise<ChannelReadState> {
  return apiFetch<ChannelReadState>(`/v1/channels/${encodeURIComponent(channelId)}/read-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });
}

export async function listMentions(channelId: string, limit = 100): Promise<MentionMarker[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const json = await apiFetch<{ items: MentionMarker[] }>(
    `/v1/channels/${encodeURIComponent(channelId)}/mentions?${query.toString()}`
  );
  return json.items;
}

export async function performModerationAction(input: {
  action: "kick" | "ban" | "unban" | "timeout" | "redact_message";
  serverId: string;
  channelId?: string;
  targetUserId?: string;
  targetMessageId?: string;
  timeoutSeconds?: number;
  reason: string;
}): Promise<void> {
  await apiFetch("/v1/moderation/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function createReport(input: {
  serverId: string;
  channelId?: string;
  targetUserId?: string;
  targetMessageId?: string;
  reason: string;
}): Promise<ModerationReport> {
  return apiFetch<ModerationReport>("/v1/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listReports(serverId: string, status?: ReportStatus): Promise<ModerationReport[]> {
  const query = new URLSearchParams({ serverId });
  if (status) {
    query.set("status", status);
  }
  const json = await apiFetch<{ items: ModerationReport[] }>(`/v1/reports?${query.toString()}`);
  return json.items;
}

export async function transitionReportStatus(input: {
  reportId: string;
  serverId: string;
  status: Exclude<ReportStatus, "open">;
  reason: string;
}): Promise<ModerationReport> {
  return apiFetch<ModerationReport>(`/v1/reports/${encodeURIComponent(input.reportId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverId: input.serverId,
      status: input.status,
      reason: input.reason
    })
  });
}

export async function listAuditLogs(serverId: string): Promise<ModerationAction[]> {
  const query = new URLSearchParams({ serverId });
  const json = await apiFetch<{ items: ModerationAction[] }>(`/v1/audit-logs?${query.toString()}`);
  return json.items;
}

export async function issueVoiceToken(input: { serverId: string; channelId: string }): Promise<VoiceTokenGrant> {
  return apiFetch<VoiceTokenGrant>("/v1/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function issueVoiceTokenWithVideo(input: {
  serverId: string;
  channelId: string;
  videoQuality?: "low" | "medium" | "high";
}): Promise<VoiceTokenGrant> {
  return apiFetch<VoiceTokenGrant>("/v1/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listVoicePresence(input: {
  serverId: string;
  channelId: string;
}): Promise<VoicePresenceMember[]> {
  const query = new URLSearchParams({
    serverId: input.serverId,
    channelId: input.channelId
  });
  const json = await apiFetch<{ items: VoicePresenceMember[] }>(`/v1/voice/presence?${query.toString()}`);
  return json.items;
}

export async function joinVoicePresence(input: {
  serverId: string;
  channelId: string;
  muted?: boolean;
  deafened?: boolean;
  videoEnabled?: boolean;
  videoQuality?: "low" | "medium" | "high";
}): Promise<void> {
  await apiFetch("/v1/voice/presence/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateVoicePresenceState(input: {
  serverId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  videoEnabled?: boolean;
  videoQuality?: "low" | "medium" | "high";
}): Promise<void> {
  await apiFetch("/v1/voice/presence/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function leaveVoicePresence(input: {
  serverId: string;
  channelId: string;
}): Promise<void> {
  await apiFetch("/v1/voice/presence/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function connectMessageStream(
  channelId: string,
  handlers: {
    onOpen?: () => void;
    onError?: () => void;
    onMessageCreated: (message: ChatMessage) => void;
    onMessageUpdated?: (message: ChatMessage) => void;
    onMessageDeleted?: (messageId: string) => void;
  }
): () => void {
  const streamUrl = `${controlPlaneBaseUrl}/v1/channels/${encodeURIComponent(channelId)}/stream`;
  const source = new EventSource(streamUrl, { withCredentials: true });

  source.onopen = () => {
    handlers.onOpen?.();
  };

  source.onerror = () => {
    handlers.onError?.();
  };

  source.addEventListener("message.created", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
    handlers.onMessageCreated(payload);
  });

  source.addEventListener("message.updated", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
    handlers.onMessageUpdated?.(payload);
  });

  source.addEventListener("message.deleted", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as { id: string };
    handlers.onMessageDeleted?.(payload.id);
  });

  source.addEventListener("typing.start", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
    // We repurpose the listener for typing events
    (handlers as any).onTypingStart?.(payload);
  });

  source.addEventListener("typing.stop", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
    (handlers as any).onTypingStop?.(payload);
  });

  return () => {
    source.close();
  };
}

export function providerLoginUrl(provider: string, username?: string): string {
  if (provider === "dev") {
    const query = username ? `?username=${encodeURIComponent(username)}` : "";
    return `${controlPlaneBaseUrl}/auth/dev-login${query}`;
  }

  return `${controlPlaneBaseUrl}/auth/login/${encodeURIComponent(provider)}`;
}

export function providerLinkUrl(provider: string): string {
  return `${controlPlaneBaseUrl}/auth/link/${encodeURIComponent(provider)}`;
}

export function discordBridgeStartUrl(serverId: string, returnTo?: string): string {
  const query = new URLSearchParams({ serverId });
  if (returnTo) {
    query.set("returnTo", returnTo);
  }
  return `${controlPlaneBaseUrl}/v1/discord/oauth/start?${query.toString()}`;
}

export async function fetchDiscordBridgePendingSelection(
  pendingSelectionId: string
): Promise<{ serverId: string; guilds: Array<{ id: string; name: string }>; selectedGuildId?: string }> {
  return apiFetch(`/v1/discord/bridge/pending/${encodeURIComponent(pendingSelectionId)}`);
}

export async function selectDiscordBridgeGuild(input: {
  pendingSelectionId: string;
  guildId: string;
}): Promise<DiscordBridgeConnection> {
  return apiFetch(`/v1/discord/bridge/pending/${encodeURIComponent(input.pendingSelectionId)}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guildId: input.guildId })
  });
}

export async function fetchDiscordBridgeHealth(serverId: string): Promise<{
  connection: DiscordBridgeConnection | null;
  mappingCount: number;
  activeMappingCount: number;
}> {
  return apiFetch(`/v1/discord/bridge/${encodeURIComponent(serverId)}/health`);
}

export async function listDiscordBridgeGuildChannels(serverId: string): Promise<Array<{ id: string; name: string; type: number }>> {
  const res = await apiFetch<{ items: Array<{ id: string; name: string; type: number }> }>(
    `/v1/discord/bridge/${encodeURIComponent(serverId)}/guild-channels`
  );
  return res.items;
}

export async function retryDiscordBridgeSyncAction(serverId: string): Promise<DiscordBridgeConnection> {
  return apiFetch(`/v1/discord/bridge/${encodeURIComponent(serverId)}/retry-sync`, {
    method: "POST"
  });
}

export async function listDiscordBridgeMappings(serverId: string): Promise<DiscordBridgeChannelMapping[]> {
  const json = await apiFetch<{ items: DiscordBridgeChannelMapping[] }>(
    `/v1/discord/bridge/${encodeURIComponent(serverId)}/mappings`
  );
  return json.items;
}

export async function upsertDiscordBridgeMapping(input: {
  serverId: string;
  guildId: string;
  discordChannelId: string;
  discordChannelName: string;
  matrixChannelId: string;
  enabled: boolean;
}): Promise<DiscordBridgeChannelMapping> {
  return apiFetch(`/v1/discord/bridge/${encodeURIComponent(input.serverId)}/mappings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guildId: input.guildId,
      discordChannelId: input.discordChannelId,
      discordChannelName: input.discordChannelName,
      matrixChannelId: input.matrixChannelId,
      enabled: input.enabled
    })
  });
}

export async function deleteDiscordBridgeMapping(input: { serverId: string; mappingId: string }): Promise<void> {
  await apiFetch(
    `/v1/discord/bridge/${encodeURIComponent(input.serverId)}/mappings/${encodeURIComponent(input.mappingId)}`,
    { method: "DELETE" }
  );
}

export async function relayDiscordBridgeMessage(input: {
  serverId: string;
  discordChannelId: string;
  authorName: string;
  content: string;
  mediaUrls?: string[];
}): Promise<{ relayed: boolean; matrixChannelId?: string; limitation?: string }> {
  return apiFetch(`/v1/discord/bridge/${encodeURIComponent(input.serverId)}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

/**
 * Delegation & Role Management
 */

export async function grantRole(input: {
  productUserId: string;
  role: Role;
  hubId?: string;
  serverId?: string;
  channelId?: string;
}): Promise<void> {
  await apiFetch("/v1/roles/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function assignSpaceOwner(input: {
  serverId: string;
  productUserId: string;
  expiresAt?: string;
}): Promise<SpaceOwnerAssignment> {
  return apiFetch(`/v1/servers/${encodeURIComponent(input.serverId)}/delegation/space-owners`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assignedUserId: input.productUserId,
      expiresAt: input.expiresAt
    })
  });
}

export async function listSpaceOwnerAssignments(serverId: string): Promise<SpaceOwnerAssignment[]> {
  const json = await apiFetch<{ items: SpaceOwnerAssignment[] }>(
    `/v1/servers/${encodeURIComponent(serverId)}/delegation/space-owners`
  );
  return json.items;
}

export async function revokeSpaceOwnerAssignment(input: {
  serverId: string;
  assignmentId: string;
}): Promise<void> {
  const query = new URLSearchParams({ serverId: input.serverId });
  await apiFetch(
    `/v1/delegation/space-owners/${encodeURIComponent(input.assignmentId)}?${query.toString()}`,
    { method: "DELETE" }
  );
}

export async function transferSpaceOwnership(input: {
  serverId: string;
  newOwnerUserId: string;
}): Promise<{
  serverId: string;
  hubId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
}> {
  return apiFetch(`/v1/servers/${encodeURIComponent(input.serverId)}/delegation/ownership/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newOwnerUserId: input.newOwnerUserId })
  });
}

export async function listDelegationAuditEvents(hubId: string, limit = 50): Promise<DelegationAuditEvent[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const json = await apiFetch<{ items: DelegationAuditEvent[] }>(
    `/v1/hubs/${encodeURIComponent(hubId)}/delegation/audit-events?${query.toString()}`
  );
  return json.items;
}

export async function uploadMedia(serverId: string, file: File): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = (reader.result as string).split(",")[1];
        const res = await apiFetch<{ url: string }>("/v1/media/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serverId,
            contentType: file.type,
            base64Data
          })
        });
        resolve(res);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Settings API
 */

export async function fetchHubSettings(hubId: string): Promise<Partial<Hub>> {
  return apiFetch<Partial<Hub>>(`/v1/hubs/${encodeURIComponent(hubId)}/settings`);
}

export async function updateHubSettings(hubId: string, settings: Partial<Hub>): Promise<void> {
  await apiFetch(`/v1/hubs/${encodeURIComponent(hubId)}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function fetchServerSettings(serverId: string): Promise<Partial<Server>> {
  return apiFetch<Partial<Server>>(`/v1/servers/${encodeURIComponent(serverId)}/settings`);
}

export async function updateServerSettings(serverId: string, settings: Partial<Server>): Promise<void> {
  await apiFetch(`/v1/servers/${encodeURIComponent(serverId)}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function fetchChannelSettings(channelId: string, serverId: string): Promise<Partial<Channel>> {
  const query = new URLSearchParams({ serverId });
  return apiFetch<Partial<Channel>>(`/v1/channels/${encodeURIComponent(channelId)}/settings?${query.toString()}`);
}

export async function updateChannelSettings(channelId: string, settings: Partial<Channel> & { serverId: string }): Promise<void> {
  await apiFetch(`/v1/channels/${encodeURIComponent(channelId)}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function fetchUserSettings(): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/v1/me/settings");
}

export async function updateUserSettings(settings: Record<string, any>): Promise<void> {
  await apiFetch("/v1/me/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function fetchNotificationSummary(): Promise<Record<string, { unreadCount: number; mentionCount: number; isMuted: boolean }>> {
  const json = await apiFetch<{ summary: Record<string, { unreadCount: number; mentionCount: number; isMuted: boolean }> }>("/v1/me/notifications");
  return json.summary;
}
export async function createDMChannel(hubId: string, userIds: string[]): Promise<Channel> {
  return apiFetch<Channel>(`/v1/hubs/${encodeURIComponent(hubId)}/dms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds })
  });
}

export async function blockUser(userId: string): Promise<void> {
  await apiFetch("/auth/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
}

export async function unblockUser(userId: string): Promise<void> {
  await apiFetch(`/auth/blocks/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

export async function listBlocks(): Promise<string[]> {
  const json = await apiFetch<{ items: string[] }>("/auth/blocks");
  return json.items;
}

export async function updatePresence(): Promise<void> {
  await apiFetch("/v1/me/presence", {
    method: "POST"
  });
}
export async function listHubMembers(hubId: string): Promise<IdentityMapping[]> {
  const json = await apiFetch<{ items: IdentityMapping[] }>(`/v1/hubs/${encodeURIComponent(hubId)}/members`);
  return json.items;
}

export async function listServerMembers(serverId: string): Promise<{
  productUserId: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  isBridged?: boolean;
  bridgedUserStatus?: string;
}[]> {
  const json = await apiFetch<{
    items: {
      productUserId: string;
      displayName: string;
      avatarUrl?: string;
      isOnline: boolean;
      isBridged?: boolean;
      bridgedUserStatus?: string;
    }[];
  }>(`/v1/servers/${encodeURIComponent(serverId)}/members`);
  return json.items;
}

export async function performBulkModerationAction(input: {
  serverId: string;
  targetUserIds: string[];
  action: "kick" | "ban" | "unban" | "timeout";
  reason: string;
  timeoutSeconds?: number;
}): Promise<{ successes: string[]; failures: Array<{ userId: string; error: string }> }> {
  return apiFetch(`/v1/servers/${encodeURIComponent(input.serverId)}/members/bulk-moderate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function connectHubStream(hubId: string): EventSource {
  return new EventSource(`${controlPlaneBaseUrl}/v1/hubs/${encodeURIComponent(hubId)}/stream`, {
    withCredentials: true
  });
}
