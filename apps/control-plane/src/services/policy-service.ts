import type { Role, PrivilegedAction, AccessLevel, AudienceTier } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { expireSpaceOwnerAssignments } from "./delegation-service.js";
import type { ScopedAuthContext } from "../auth/middleware.js";

/**
 * Privileged actions each granted role is allowed to perform.
 *
 * Note on `space_moderator` (P1 permissions sprint, 2026-05-07):
 * moderators are intentionally limited to chat-cleanup actions
 * (`moderation.*`, `reports.triage`, `audit.read`). They do **not**
 * appear in `SERVER_MANAGER_ROLES` and they cannot edit server
 * settings, manage rooms, or manage roles. P2 will split
 * `canManageServer` into capability-specific gates so this boundary
 * is enforced by name, not by the absence-from-set heuristic this
 * file currently relies on.
 *
 * `user` and `visitor` are NOT roles. Hub Member = a row in
 * `hub_members`. Visitor = no membership row and no granted role.
 * The access-tier resolution in `isActionAllowed` consults
 * `hub_members` / `server_members` directly for those tiers.
 */
export const permissionMatrix: Record<Role, PrivilegedAction[]> = {
  hub_owner: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read",
    "hub.suspend",
    "badges.manage"
  ],
  hub_admin: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read",
    "badges.manage"
  ],
  space_owner: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read",
    "badges.manage"
  ],
  space_admin: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read",
    "badges.manage"
  ],
  space_moderator: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "reports.triage",
    "audit.read"
  ]
};

export interface Scope {
  hubId?: string;
  serverId?: string;
  channelId?: string;
}

interface RoleBinding {
  role: Role;
  hub_id: string | null;
  server_id: string | null;
  channel_id: string | null;
  isOwnerSuspended?: boolean;
}

const HUB_MANAGER_ROLES: Role[] = ["hub_owner", "hub_admin"];
const SERVER_MANAGER_ROLES: Role[] = ["hub_owner", "hub_admin", "space_owner", "space_admin"];
/**
 * Role set for chat-cleanup actions (kick/ban/timeout/etc.).
 * `space_moderator` joins this set but is intentionally excluded from
 * `SERVER_MANAGER_ROLES` — moderators don't edit settings, manage
 * roles, or manage rooms. P2.a of the permissions sprint
 * (2026-05-08) makes this boundary enforced by named capability
 * gates instead of by absence-from-set.
 */
const SERVER_MODERATION_ROLES: Role[] = [
  "hub_owner",
  "hub_admin",
  "space_owner",
  "space_admin",
  "space_moderator"
];


export async function fetchServerScope(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  serverId: string
): Promise<{ hubId: string; ownerUserId: string | null } | null> {
  const row = await db.query<{ hub_id: string; owner_user_id: string | null }>(
    "select hub_id, owner_user_id from servers where id = $1 limit 1",
    [serverId]
  );
  const result = row.rows[0];
  if (!result) {
    return null;
  }
  return {
    hubId: result.hub_id,
    // null means hub-owned (P3, 2026-05-08): the space carries no
    // explicit owner; hub managers handle management. Owner-equality
    // checks naturally fail for null, which is what we want.
    ownerUserId: result.owner_user_id
  };
}

async function hasActiveSpaceOwnerAssignmentInDb(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  input: { productUserId: string; serverId: string }
): Promise<boolean> {
  const row = await db.query<{ active: boolean }>(
    `select exists(
       select 1
       from space_admin_assignments
       where server_id = $1
         and assigned_user_id = $2
         and status = 'active'
         and (expires_at is null or expires_at > now())
     ) as active`,
    [input.serverId, input.productUserId]
  );
  return Boolean(row.rows[0]?.active);
}

async function getEffectiveRoleBindings(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  input: { productUserId: string; scope?: Scope; authContext?: ScopedAuthContext }
): Promise<RoleBinding[]> {
  // If we are simulating a specific role, that becomes the ONLY binding
  if (input.authContext?.masqueradeRole) {
    const role = input.authContext.masqueradeRole as Role;
    const masqueradeServerId = input.authContext.masqueradeServerId;
    
    // Validate that the simulated role matches the requested scope if server-scoped
    const isServerRole = ["space_owner", "space_admin", "space_moderator"].includes(role);
    const scopeMatch = !isServerRole || !input.scope?.serverId || input.scope.serverId === masqueradeServerId;

    if (scopeMatch) {
      return [{
        role,
        hub_id: input.scope?.hubId || null,
        server_id: masqueradeServerId || null,
        channel_id: null
      }];
    }
    
    // If it doesn't match the scope (e.g. masquerading as moderator of
    // Server A but looking at Server B), the masquerader falls back to
    // visitor relation within the other scope. Since `visitor` is no
    // longer a Role (it's an absence-of-role classifier), we return an
    // empty array — the access-tier resolution downstream maps "no
    // bindings" to `relation = 'visitor'`.
    return [];
  }

  const rows = await db.query<RoleBinding>(
    `select role, hub_id, server_id, channel_id
     from role_bindings
     where product_user_id = $1`,
    [input.productUserId]
  );
  const effective = [...rows.rows];

  if (input.scope?.hubId) {
    const hub = await db.query<{ owner_user_id: string; is_suspended: boolean; suspension_expires_at: string | null }>(
      "select owner_user_id, is_suspended, suspension_expires_at from hubs where id = $1 limit 1",
      [input.scope.hubId]
    );
    const hubRow = hub.rows[0];
    if (hubRow && hubRow.owner_user_id === input.productUserId) {
      const isSuspended = hubRow.is_suspended && (!hubRow.suspension_expires_at || new Date(hubRow.suspension_expires_at) > new Date());
      
      effective.push({
        role: isSuspended ? "hub_admin" : "hub_owner",
        hub_id: input.scope.hubId,
        server_id: null,
        channel_id: null,
        isOwnerSuspended: isSuspended
      });
    }
  }

  if (input.scope?.serverId) {
    const server = await fetchServerScope(db, input.scope.serverId);
    if (server && server.ownerUserId === input.productUserId) {
      effective.push({
        role: "space_owner",
        hub_id: server.hubId,
        server_id: input.scope.serverId,
        channel_id: null
      });
    } else {
      const isDelegated = await hasActiveSpaceOwnerAssignmentInDb(db, {
        productUserId: input.productUserId,
        serverId: input.scope.serverId
      });
      if (isDelegated && server) {
        effective.push({
          role: "space_owner",
          hub_id: server.hubId,
          server_id: input.scope.serverId,
          channel_id: null
        });
      }
    }
  } else if (!input.scope?.hubId && !input.scope?.channelId) {
    // Truly scopeless listing (e.g. `/v1/me/roles`) — surface every active
    // space_owner delegation so the caller sees every space they manage.
    // We deliberately skip this for scoped authorization checks: emitting
    // server-scoped bindings when `scope.hubId` is set would make them match
    // a hub-wide scope (because `bindingMatchesScope` treats an absent
    // request-scope id as "any"), granting privileges outside the delegation.
    const delegations = await db.query<{ server_id: string; hub_id: string }>(
      `select saa.server_id, s.hub_id
       from space_admin_assignments saa
       join servers s on s.id = saa.server_id
       where saa.assigned_user_id = $1
         and saa.status = 'active'
         and (saa.expires_at is null or saa.expires_at > now())`,
      [input.productUserId]
    );
    for (const row of delegations.rows) {
      effective.push({
        role: "space_owner",
        hub_id: row.hub_id,
        server_id: row.server_id,
        channel_id: null
      });
    }
  }

  return effective;
}

export function bindingMatchesScope(binding: RoleBinding, scope: Scope): boolean {
  const hubMatches = !binding.hub_id || !scope.hubId || binding.hub_id === scope.hubId;
  const serverMatches = !binding.server_id || !scope.serverId || binding.server_id === scope.serverId;
  const channelMatches = !binding.channel_id || !scope.channelId || binding.channel_id === scope.channelId;
  return hubMatches && serverMatches && channelMatches;
}

/**
 * Pick the highest-applicable audience tier for `productUserId` against
 * the given scope. P2.b expanded this from a 4-tier ladder
 * (visitor/hub_member/space_member/admin) to the 6-tier ladder used by
 * the normalized rules tables: hub_admin > space_admin > space_moderator
 * > space_member > hub_member > visitor.
 */
async function resolveAudienceTier(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  input: {
    productUserId: string;
    scope: Scope;
    isMasquerading: boolean;
    isHubAdmin: boolean;
    bindings: RoleBinding[];
  }
): Promise<AudienceTier> {
  if (input.isHubAdmin) return "hub_admin";

  const matchesServer = (b: RoleBinding) =>
    bindingMatchesScope(b, { hubId: input.scope.hubId, serverId: input.scope.serverId });

  if (input.bindings.some((b) => (b.role === "space_owner" || b.role === "space_admin") && matchesServer(b))) {
    return "space_admin";
  }
  if (input.bindings.some((b) => b.role === "space_moderator" && matchesServer(b))) {
    return "space_moderator";
  }

  // Membership-driven tiers don't apply to masquerade sessions — those
  // are role-defined and shouldn't pick up real DB membership.
  if (input.isMasquerading) return "visitor";

  if (input.scope.serverId) {
    const isSpaceMember = await db.query(
      "select 1 from server_members where server_id = $1 and product_user_id = $2",
      [input.scope.serverId, input.productUserId]
    );
    if (isSpaceMember.rows.length > 0) return "space_member";
  }

  const hubId =
    input.scope.hubId ??
    (input.scope.serverId
      ? (await db.query<{ hub_id: string }>("select hub_id from servers where id = $1", [input.scope.serverId])).rows[0]?.hub_id
      : undefined);
  if (hubId) {
    const isHubMember = await db.query(
      "select 1 from hub_members where hub_id = $1 and product_user_id = $2",
      [hubId, input.productUserId]
    );
    if (isHubMember.rows.length > 0) return "hub_member";
  }

  return "visitor";
}

/**
 * Resolve the access level for a tier on a given resource, walking the
 * Hub→Space→Room cascade. A channel-level rule wins over the server-
 * level rule for the same tier; in the absence of any rule, fall back
 * to the conservative default (visitors hidden, members chat).
 *
 * Hubs don't yet have a rules table; the per-hub override surface is
 * deferred. Hub-level lockout is enforced upstream of access
 * resolution (login screen / public splash).
 */
async function resolveAccessLevel(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  input: {
    audienceTier: AudienceTier;
    channelId: string | null;
    serverId: string | null;
  }
): Promise<AccessLevel> {
  if (input.channelId) {
    const channelRule = await db.query<{ level: string }>(
      "select level from channel_access_rules where channel_id = $1 and audience_tier = $2",
      [input.channelId, input.audienceTier]
    );
    const rule = channelRule.rows[0]?.level;
    if (rule) return rule as AccessLevel;
  }
  if (input.serverId) {
    const serverRule = await db.query<{ level: string }>(
      "select level from space_access_rules where server_id = $1 and audience_tier = $2",
      [input.serverId, input.audienceTier]
    );
    const rule = serverRule.rows[0]?.level;
    if (rule) return rule as AccessLevel;
  }
  return input.audienceTier === "visitor" ? "hidden" : "chat";
}

export function bindingAllowsAction(binding: RoleBinding, action: PrivilegedAction, hubId?: string | null): boolean {
  const globalAllowed = (permissionMatrix[binding.role] || []).includes(action);
  if (!globalAllowed && hubId) {
    // Sync check from cache (loaded by bindingAllowsActionHubAware or hub routes)
    const cached = overrideCache.get(hubId);
    return cached?.get(`${binding.role}:${action}`) ?? false;
  }
  return globalAllowed;
}

export async function bindingAllowsActionHubAware(
  binding: RoleBinding,
  action: PrivilegedAction,
  hubId: string
): Promise<boolean> {
  const globalAllowed = (permissionMatrix[binding.role] || []).includes(action);
  if (!globalAllowed) {
    // Check for per-hub override granting this action
    const overrides = await loadHubPermissionOverrides(hubId);
    return overrides.get(`${binding.role}:${action}`) ?? false;
  }
  return true;
}

let overrideCache = new Map<string, Map<string, boolean>>(); // hubId → (role:action → allowed)

export function clearHubPermissionOverrideCache(): void {
  overrideCache = new Map();
}

async function loadHubPermissionOverrides(hubId: string): Promise<Map<string, boolean>> {
  const cached = overrideCache.get(hubId);
  if (cached) return cached;

  const map = new Map<string, boolean>();
  const rows = await withDb(async (db) => {
    const result = await db.query<{ role: string; action: string; allowed: boolean }>(
      "select role, action, allowed from hub_permission_overrides where hub_id = $1",
      [hubId]
    );
    return result.rows;
  });

  for (const row of rows) {
    map.set(`${row.role}:${row.action}`, row.allowed);
  }

  overrideCache.set(hubId, map);
  return map;
}

export async function grantRole(input: {
  actorUserId: string;
  productUserId: string;
  role: Role;
  hubId?: string;
  serverId?: string;
  channelId?: string;
}): Promise<void> {
  await withDb(async (db) => {
    const authorization = await authorizeRoleGrant({
      actorUserId: input.actorUserId,
      role: input.role,
      hubId: input.hubId,
      serverId: input.serverId,
      channelId: input.channelId
    });
    if (!authorization.allowed) {
      await insertRoleAssignmentAudit({
        actorUserId: input.actorUserId,
        targetUserId: input.productUserId,
        role: input.role,
        hubId: authorization.scope.hubId,
        serverId: authorization.scope.serverId,
        channelId: authorization.scope.channelId,
        outcome: "denied",
        reason: authorization.code
      });
      const error = new Error(authorization.message) as Error & { statusCode: number; code: string };
      error.statusCode = authorization.code === "forbidden_scope" ? 403 : 409;
      error.code = authorization.code;
      throw error;
    }

    await db.query(
      `insert into role_bindings (id, product_user_id, role, hub_id, server_id, channel_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        `rb_${crypto.randomUUID().replaceAll("-", "")}`,
        input.productUserId,
        input.role,
        authorization.scope.hubId ?? null,
        authorization.scope.serverId ?? null,
        authorization.scope.channelId ?? null
      ]
    );

    await insertRoleAssignmentAudit({
      actorUserId: input.actorUserId,
      targetUserId: input.productUserId,
      role: input.role,
      hubId: authorization.scope.hubId,
      serverId: authorization.scope.serverId,
      channelId: authorization.scope.channelId,
      outcome: "granted"
    });
  });
}

type GrantScope = {
  hubId?: string;
  serverId?: string;
  channelId?: string;
};

type GrantAuthorizationResult = {
  allowed: boolean;
  code: "forbidden_scope" | "role_escalation_denied";
  message: string;
  scope: Required<GrantScope>;
};

async function resolveGrantScope(input: GrantScope): Promise<Required<GrantScope>> {
  return withDb(async (db) => {
    let hubId = input.hubId;
    let serverId = input.serverId;
    const channelId = input.channelId;

    if (channelId && !serverId) {
      const channel = await db.query<{ server_id: string }>(
        "select server_id from channels where id = $1 limit 1",
        [channelId]
      );
      const channelRow = channel.rows[0];
      if (!channelRow) {
        return { hubId: "", serverId: "", channelId };
      }
      serverId = channelRow.server_id;
    }

    if (serverId && !hubId) {
      const server = await db.query<{ hub_id: string }>("select hub_id from servers where id = $1 limit 1", [
        serverId
      ]);
      hubId = server.rows[0]?.hub_id;
    }

    return {
      hubId: hubId ?? "",
      serverId: serverId ?? "",
      channelId: channelId ?? ""
    };
  });
}

async function authorizeRoleGrant(input: {
  actorUserId: string;
  role: Role;
  hubId?: string;
  serverId?: string;
  channelId?: string;
}): Promise<GrantAuthorizationResult & { allowed: boolean }> {
  const scope = await resolveGrantScope({
    hubId: input.hubId,
    serverId: input.serverId,
    channelId: input.channelId
  });

  if (!scope.hubId) {
    return {
      allowed: false,
      code: "role_escalation_denied",
      message: "Role grants must target a valid hub/server/channel scope.",
      scope
    };
  }

  if (input.role === "hub_admin" && (scope.serverId || scope.channelId)) {
    return {
      allowed: false,
      code: "role_escalation_denied",
      message: "Hub Administrator grants must target hub scope only.",
      scope
    };
  }

  if ((input.role === "space_owner" || input.role === "space_admin" || input.role === "space_moderator") && !scope.serverId) {
    return {
      allowed: false,
      code: "role_escalation_denied",
      message: "Space roles must target a server scope.",
      scope
    };
  }

  await expireSpaceOwnerAssignments({
    serverId: scope.serverId || undefined,
    productUserId: input.actorUserId
  });
  const actorBindings = await withDb(async (db) =>
    getEffectiveRoleBindings(db, {
      productUserId: input.actorUserId,
      scope
    })
  );

  const managerRoleSet = scope.serverId ? SERVER_MANAGER_ROLES : HUB_MANAGER_ROLES;
  const managerBindings = actorBindings.filter(
    (binding) => managerRoleSet.includes(binding.role) && bindingMatchesScope(binding, scope)
  );
  if (managerBindings.length < 1) {
    return {
      allowed: false,
      code: "forbidden_scope",
      message: "Forbidden: role grant outside assigned management scope.",
      scope
    };
  }

  const actorCanAssign = new Set<Role>();
  for (const binding of managerBindings) {
    if (binding.role === "hub_owner" || binding.role === "hub_admin") {
      actorCanAssign.add("hub_admin");
      actorCanAssign.add("space_owner");
      actorCanAssign.add("space_admin");
      actorCanAssign.add("space_moderator");
      continue;
    }
    if (binding.role === "space_owner" || binding.role === "space_admin") {
      actorCanAssign.add("space_moderator");
      // Space Owners/Admins can assign "space_admin" to others to delegate administration
      actorCanAssign.add("space_admin");
    }
  }

  if (!actorCanAssign.has(input.role)) {
    return {
      allowed: false,
      code: "role_escalation_denied",
      message: "Role escalation denied for requested role assignment.",
      scope
    };
  }

  return {
    allowed: true,
    code: "forbidden_scope",
    message: "",
    scope
  };
}

async function insertRoleAssignmentAudit(input: {
  actorUserId: string;
  targetUserId: string;
  role: Role;
  hubId?: string;
  serverId?: string;
  channelId?: string;
  outcome: "granted" | "denied";
  reason?: string;
}): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `insert into role_assignment_audit_logs
       (id, actor_user_id, target_user_id, role, hub_id, server_id, channel_id, outcome, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `raal_${crypto.randomUUID().replaceAll("-", "")}`,
        input.actorUserId,
        input.targetUserId,
        input.role,
        input.hubId || null,
        input.serverId || null,
        input.channelId || null,
        input.outcome,
        input.reason ?? null
      ]
    );
  });
}

export async function isActionAllowed(input: {
  productUserId: string;
  action: PrivilegedAction;
  scope: Scope;
  authContext?: ScopedAuthContext;
}): Promise<boolean> {
  return withDb(async (db) => {
    // Warm the permission override cache for this hub
    if (input.scope.hubId) {
      await loadHubPermissionOverrides(input.scope.hubId);
    }

    // 1. Get Effective Roles & Owner Suspension Status
    const roles = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: input.scope,
      authContext: input.authContext
    });

    const isMasquerading = Boolean(input.authContext?.isMasquerading);
    const isOwner = roles.some(b => b.role === "hub_owner");
    const isSuspended = roles.some(b => b.isOwnerSuspended);

    // 0. Absolute Authority Actions - Block for suspended owners
    const ABSOLUTE_AUTHORITY_ACTIONS: string[] = ["hub.delete", "ownership.transfer"];
    if (isOwner && isSuspended && ABSOLUTE_AUTHORITY_ACTIONS.includes(input.action)) {
      return false;
    }

    const isAdmin = isOwner || roles.some(b => b.role === "hub_admin");

    // 2. Check traditional permission matrix first (for management actions)
    const isRoleAllowedByMatrix = roles.some((binding) =>
      bindingAllowsAction(binding, input.action, input.scope.hubId) &&
      bindingMatchesScope(binding, input.scope)
    );

    // For management actions, the traditional matrix wins.
    const ACCESS_ACTIONS = ["channel.message.read", "channel.message.send", "channel.voice.join", "voice.token.issue"];
    if (!ACCESS_ACTIONS.includes(input.action)) {
      return isRoleAllowedByMatrix;
    }

    // 3. Resolve user's audience tier (highest applicable).
    //    P2.b expanded the ladder from {visitor, hub_member, space_member,
    //    hub_admin} to also include space_admin and space_moderator.
    const tier = await resolveAudienceTier(db, {
      productUserId: input.productUserId,
      scope: input.scope,
      isMasquerading,
      isHubAdmin: isAdmin,
      bindings: roles
    });

    // 4. Fetch the access level for this tier with Hub→Space→Room
    //    cascade. The channel rule wins if present; otherwise the server
    //    rule applies. Hubs do not yet have rule rows; the hub_admin tier
    //    baseline is set per resource.
    let userMaxAccess: AccessLevel = await resolveAccessLevel(db, {
      audienceTier: tier,
      channelId: input.scope.channelId ?? null,
      serverId: input.scope.serverId ?? null
    });

    // 6. Badge Overrides (Highest rank wins, Channel rules > Server rules)
    let badgeIds = [] as string[];
    if (input.authContext?.masqueradeRole) {
        badgeIds = input.authContext.masqueradeBadgeIds || [];
    }

    const badgeRulesQuery = badgeIds.length > 0
      ? `select br.access_level, b.rank, br.specificity
         from (
           select access_level, badge_id, 2 as specificity from channel_badge_rules where channel_id = $1
           union all
           select access_level, badge_id, 1 as specificity from server_badge_rules where server_id = $3
         ) br
         join badges b on b.id = br.badge_id
         where b.id = any($4)
           and br.access_level is not null
         order by br.specificity desc, b.rank asc`
      : `select br.access_level, b.rank, br.specificity
         from (
           select access_level, badge_id, 2 as specificity from channel_badge_rules where channel_id = $1
           union all
           select access_level, badge_id, 1 as specificity from server_badge_rules where server_id = $3
         ) br
         join badges b on b.id = br.badge_id
         join user_badges ub on ub.badge_id = b.id
         where ub.product_user_id = $2
           and br.access_level is not null
         order by br.specificity desc, b.rank asc`;

    const badgeRulesParams = badgeIds.length > 0
      ? [input.scope.channelId ?? null, input.productUserId, input.scope.serverId, badgeIds]
      : [input.scope.channelId ?? null, input.productUserId, input.scope.serverId];

    const badgeRules = await db.query<{ access_level: string; rank: number; specificity: number }>(
      badgeRulesQuery,
      badgeRulesParams
    );

    if (badgeRules.rows.length > 0) {
      const override = badgeRules.rows[0]?.access_level;
      if (override) {
        userMaxAccess = override as AccessLevel;
      }
    }

    const ACCESS_PRIORITY: Record<AccessLevel, number> = {
      hidden: 0,
      locked: 1,
      read: 2,
      chat: 3
    };

    const userAccessPriority = ACCESS_PRIORITY[userMaxAccess] ?? 0;

    if (input.action === "channel.message.read") {
      return userAccessPriority >= ACCESS_PRIORITY.read;
    }

    if (input.action === "channel.message.send" || input.action === "channel.voice.join" || input.action === "voice.token.issue") {
      return userAccessPriority >= ACCESS_PRIORITY.chat;
    }

    return false;
  });
}

export async function listAllowedActions(input: {
  productUserId: string;
  scope: Scope;
  authContext?: ScopedAuthContext;
}): Promise<PrivilegedAction[]> {
  await expireSpaceOwnerAssignments({
    serverId: input.scope.serverId,
    productUserId: input.productUserId
  });
  return withDb(async (db) => {
    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: input.scope,
      authContext: input.authContext
    });

    const actions = new Set<PrivilegedAction>();
    for (const binding of rows) {
      if (!bindingMatchesScope(binding, input.scope)) {
        continue;
      }

      for (const action of (permissionMatrix[binding.role] || [])) {
        actions.add(action);
      }
    }

    return [...actions];
  });
}

export async function listRoleBindings(input: { 
  productUserId: string,
  authContext?: ScopedAuthContext,
  scope?: Scope 
}): Promise<
  Array<{
    role: Role;
    hubId: string | null;
    serverId: string | null;
    channelId: string | null;
  }>
> {
  return withDb(async (db) => {
    const roles = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: input.scope,
      authContext: input.authContext
    });

    return roles.map((row) => ({
      role: row.role,
      hubId: row.hub_id,
      serverId: row.server_id,
      channelId: row.channel_id
    }));
  });
}

export async function revokeRoleBindings(input: {
  productUserId: string;
  role?: Role;
  hubId?: string;
  serverId?: string;
  channelId?: string;
}): Promise<number> {
  return withDb(async (db) => {
    const result = await db.query(
      `delete from role_bindings
       where product_user_id = $1
         and ($2::text is null or role = $2)
         and ($3::text is null or hub_id = $3)
         and ($4::text is null or server_id = $4)
         and ($5::text is null or channel_id = $5)`,
      [
        input.productUserId,
        input.role ?? null,
        input.hubId ?? null,
        input.serverId ?? null,
        input.channelId ?? null
      ]
    );
    return result.rowCount ?? 0;
  });
}

export async function canManageHub(input: {
  productUserId: string;
  hubId: string;
  authContext?: ScopedAuthContext;
}): Promise<boolean> {
  return withDb(async (db) => {
    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: { hubId: input.hubId },
      authContext: input.authContext
    });

    return rows.some(
      (binding) =>
        HUB_MANAGER_ROLES.includes(binding.role) &&
        bindingMatchesScope(binding, {
          hubId: input.hubId
        })
    );
  });
}

interface ServerCapabilityInput {
  productUserId: string;
  serverId: string;
  authContext?: ScopedAuthContext;
}

/**
 * Shared evaluator for server-scoped capability gates. The four
 * exported gates (`canModerateServer`, `canEditServerSettings`,
 * `canManageServerRoles`, `canManageRooms`) differ only in which
 * roles satisfy them.
 *
 * Special-case: when `allowedRoles` includes the manager set
 * (settings/roles/rooms gates), an explicit `space_owner` on the
 * server *or* an active space-owner delegation also satisfies the
 * gate — these are owner-equivalent paths that pre-date the
 * role_bindings model. Moderation alone (`canModerateServer`)
 * doesn't need that shortcut because admins/owners are already in
 * the role set.
 */
async function evaluateServerCapability(
  input: ServerCapabilityInput,
  allowedRoles: ReadonlyArray<Role>,
  options: { ownerEquivalentShortcut: boolean } = { ownerEquivalentShortcut: true }
): Promise<boolean> {
  const isMasquerading = Boolean(input.authContext?.isMasquerading);

  if (!isMasquerading) {
    await expireSpaceOwnerAssignments({
      serverId: input.serverId,
      productUserId: input.productUserId
    });
  }

  return withDb(async (db) => {
    const serverRow = await fetchServerScope(db, input.serverId);
    if (!serverRow) {
      return false;
    }

    if (!isMasquerading && options.ownerEquivalentShortcut) {
      if (serverRow.ownerUserId === input.productUserId) {
        return true;
      }
      const isDelegated = await hasActiveSpaceOwnerAssignmentInDb(db, {
        productUserId: input.productUserId,
        serverId: input.serverId
      });
      if (isDelegated) {
        return true;
      }
    }

    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: {
        hubId: serverRow.hubId,
        serverId: input.serverId
      },
      authContext: input.authContext
    });

    return rows.some(
      (binding) =>
        allowedRoles.includes(binding.role) &&
        bindingMatchesScope(binding, {
          hubId: serverRow.hubId,
          serverId: input.serverId
        })
    );
  });
}

/**
 * Gate for chat-cleanup actions: kick, ban, timeout, warn, strike,
 * redact, channel lock/unlock, slow mode, reports triage, audit
 * read. Granted to hub managers, space owners/admins, and
 * space_moderators.
 */
export function canModerateServer(input: ServerCapabilityInput): Promise<boolean> {
  // Moderators don't get the owner-equivalent shortcut because they
  // shouldn't be able to moderate solely by virtue of being the
  // server's listed owner if the role-binding system would otherwise
  // exclude them. In practice the manager set already covers
  // owners/admins, so this is a no-op simplification — keeping it
  // explicit for clarity.
  return evaluateServerCapability(input, SERVER_MODERATION_ROLES, {
    ownerEquivalentShortcut: true
  });
}

/**
 * Gate for editing server settings: rename the space, change icon,
 * change starting channel, configure access tiers, change join
 * policy, manage badges, etc. NOT granted to space_moderators.
 */
export function canEditServerSettings(input: ServerCapabilityInput): Promise<boolean> {
  return evaluateServerCapability(input, SERVER_MANAGER_ROLES);
}

/**
 * Gate for managing roles within the server: granting/revoking
 * space_moderator/space_admin, transferring ownership, delegating
 * space-owner duties. NOT granted to space_moderators.
 */
export function canManageServerRoles(input: ServerCapabilityInput): Promise<boolean> {
  return evaluateServerCapability(input, SERVER_MANAGER_ROLES);
}

/**
 * Gate for managing rooms within the server: create/rename/delete
 * channels and categories, change channel settings, move channels
 * between categories. NOT granted to space_moderators.
 */
export function canManageRooms(input: ServerCapabilityInput): Promise<boolean> {
  return evaluateServerCapability(input, SERVER_MANAGER_ROLES);
}

/**
 * @deprecated Use one of the named capability gates
 * (`canModerateServer`, `canEditServerSettings`,
 * `canManageServerRoles`, `canManageRooms`) instead. Kept as a thin
 * alias for `canEditServerSettings` so any caller still using it
 * gets the most-restrictive interpretation by default. Remove once
 * no external callers remain.
 */
export const canManageServer = canEditServerSettings;

export async function canManageDiscordBridge(input: {
  productUserId: string;
  serverId: string;
  authContext?: ScopedAuthContext;
}): Promise<boolean> {
  return withDb(async (db) => {
    const serverRow = await fetchServerScope(db, input.serverId);
    if (!serverRow) {
      return false;
    }

    const hubSettings = await db.query<{ allow_space_discord_bridge: boolean }>(
      "select allow_space_discord_bridge from hubs where id = $1",
      [serverRow.hubId]
    );
    const allowSpaceBridge = hubSettings.rows[0]?.allow_space_discord_bridge !== false;

    const roles = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: {
        hubId: serverRow.hubId,
        serverId: input.serverId
      },
      authContext: input.authContext
    });

    const isHubManager = roles.some(
      (binding) =>
        HUB_MANAGER_ROLES.includes(binding.role) &&
        bindingMatchesScope(binding, { hubId: serverRow.hubId })
    );

    if (isHubManager) {
      return true;
    }

    if (!allowSpaceBridge) {
      return false;
    }

    return canManageServer(input);
  });
}
