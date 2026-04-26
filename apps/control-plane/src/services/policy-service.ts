import type { Role, PrivilegedAction, AccessLevel } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { expireSpaceOwnerAssignments } from "./delegation-service.js";
import type { ScopedAuthContext } from "../auth/middleware.js";

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
  ],
  user: ["voice.token.issue"],
  visitor: []
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


export async function fetchServerScope(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  serverId: string
): Promise<{ hubId: string; ownerUserId: string } | null> {
  const row = await db.query<{ hub_id: string; owner_user_id: string }>(
    "select hub_id, owner_user_id from servers where id = $1 limit 1",
    [serverId]
  );
  const result = row.rows[0];
  if (!result) {
    return null;
  }
  return {
    hubId: result.hub_id,
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
    
    // If it doesn't match the scope (e.g. masquerading as moderator of Server A but looking at Server B),
    // they fall back to visitor/user level within that other scope.
    return [{
      role: "visitor",
      hub_id: null,
      server_id: null,
      channel_id: null
    }];
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

export function bindingAllowsAction(binding: RoleBinding, action: PrivilegedAction): boolean {
  return (permissionMatrix[binding.role] || []).includes(action);
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
      actorCanAssign.add("user");
      continue;
    }
    if (binding.role === "space_owner" || binding.role === "space_admin") {
      actorCanAssign.add("space_moderator");
      actorCanAssign.add("user");
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
      bindingAllowsAction(binding, input.action) &&
      bindingMatchesScope(binding, input.scope)
    );

    // For management actions, the traditional matrix wins.
    const ACCESS_ACTIONS = ["channel.message.read", "channel.message.send", "channel.voice.join", "voice.token.issue"];
    if (!ACCESS_ACTIONS.includes(input.action)) {
      return isRoleAllowedByMatrix;
    }

    // 3. Resolve user's "Relation" to the resource
    // Precedence: Admin > Space Member > Hub Member > Visitor
    let relation: "admin" | "space_member" | "hub_member" | "visitor" = "visitor";
    if (isAdmin) {
      relation = "admin";
    } else {
      // If masquerading, we MUST NOT check the database for actual membership
      // because the user is specifically trying to emulate a different profile.
      if (isMasquerading) {
         // In masquerade mode, if you aren't an admin, you fall back to visitor
         // unless we implement "masquerade as member" which isn't currently in the payload.
         // For now, most masquerades are "Role" based.
         relation = "visitor";
      } else {
        const isSpaceMember = await db.query(
          "select 1 from server_members where server_id = $1 and product_user_id = $2",
          [input.scope.serverId, input.productUserId]
        );
        if (isSpaceMember.rows.length > 0) {
          relation = "space_member";
        } else {
          const hubId = input.scope.hubId || (await db.query<{ hub_id: string }>("select hub_id from servers where id = $1", [input.scope.serverId])).rows[0]?.hub_id;
          if (hubId) {
            const isHubMember = await db.query(
              "select 1 from hub_members where hub_id = $1 and product_user_id = $2",
              [hubId, input.productUserId]
            );
            if (isHubMember.rows.length > 0) {
              relation = "hub_member";
            }
          }
        }
      }
    }

    // 4. Fetch Resource Access Defaults
    let hubAdminAccess: AccessLevel = "chat";
    let spaceMemberAccess: AccessLevel = "chat";
    let hubMemberAccess: AccessLevel = "chat";
    let visitorAccess: AccessLevel = "hidden";

    if (input.scope.channelId) {
      const ch = await db.query<{
        hub_admin_access: string;
        space_member_access: string;
        hub_member_access: string;
        visitor_access: string;
      }>(
        "select hub_admin_access, space_member_access, hub_member_access, visitor_access from channels where id = $1",
        [input.scope.channelId]
      );
      if (ch.rows[0]) {
        hubAdminAccess = ch.rows[0].hub_admin_access as AccessLevel;
        spaceMemberAccess = ch.rows[0].space_member_access as AccessLevel;
        hubMemberAccess = ch.rows[0].hub_member_access as AccessLevel;
        visitorAccess = ch.rows[0].visitor_access as AccessLevel;
      }
    } else {
      const srv = await db.query<{
        hub_admin_access: string;
        space_member_access: string;
        hub_member_access: string;
        visitor_access: string;
      }>(
        "select hub_admin_access, space_member_access, hub_member_access, visitor_access from servers where id = $1",
        [input.scope.serverId]
      );
      if (srv.rows[0]) {
        hubAdminAccess = srv.rows[0].hub_admin_access as AccessLevel;
        spaceMemberAccess = srv.rows[0].space_member_access as AccessLevel;
        hubMemberAccess = srv.rows[0].hub_member_access as AccessLevel;
        visitorAccess = srv.rows[0].visitor_access as AccessLevel;
      }
    }

    // 5. Determine Base Access Level (from Role Default)
    let userMaxAccess: AccessLevel = visitorAccess;
    if (relation === "admin") userMaxAccess = hubAdminAccess;
    else if (relation === "space_member") userMaxAccess = spaceMemberAccess;
    else if (relation === "hub_member") userMaxAccess = hubMemberAccess;

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

export async function canManageServer(input: {
  productUserId: string;
  serverId: string;
  authContext?: ScopedAuthContext;
}): Promise<boolean> {
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

    if (!isMasquerading) {
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
        SERVER_MANAGER_ROLES.includes(binding.role) &&
        bindingMatchesScope(binding, {
          hubId: serverRow.hubId,
          serverId: input.serverId
        })
    );
  });
}

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
