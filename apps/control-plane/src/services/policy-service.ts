import crypto from "node:crypto";
import type { Role, PrivilegedAction } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { expireSpaceOwnerAssignments } from "./delegation-service.js";

export const permissionMatrix: Record<Role, PrivilegedAction[]> = {
  hub_admin: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read"
  ],
  space_owner: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read"
  ],
  space_moderator: [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.redact",
    "reports.triage",
    "audit.read"
  ],
  user: ["voice.token.issue"]
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
}

const HUB_MANAGER_ROLES: Role[] = ["hub_admin"];
const SERVER_MANAGER_ROLES: Role[] = ["hub_admin", "space_owner"];

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
  input: { productUserId: string; scope: Scope }
): Promise<RoleBinding[]> {
  const rows = await db.query<RoleBinding>(
    `select role, hub_id, server_id, channel_id
     from role_bindings
     where product_user_id = $1`,
    [input.productUserId]
  );
  const effective = [...rows.rows];

  if (input.scope.serverId) {
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

  if ((input.role === "space_owner" || input.role === "space_moderator") && !scope.serverId) {
    return {
      allowed: false,
      code: "role_escalation_denied",
      message: "Space Owner and Space Moderator grants must target a server scope.",
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
    if (binding.role === "hub_admin") {
      actorCanAssign.add("hub_admin");
      actorCanAssign.add("space_owner");
      actorCanAssign.add("space_moderator");
      actorCanAssign.add("user");
      continue;
    }
    if (binding.role === "space_owner") {
      actorCanAssign.add("space_moderator");
      actorCanAssign.add("user");
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
}): Promise<boolean> {
  await expireSpaceOwnerAssignments({
    serverId: input.scope.serverId,
    productUserId: input.productUserId
  });
  return withDb(async (db) => {
    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: input.scope
    });

    return rows.some((binding) => bindingAllowsAction(binding, input.action) && bindingMatchesScope(binding, input.scope));
  });
}

export async function listAllowedActions(input: {
  productUserId: string;
  scope: Scope;
}): Promise<PrivilegedAction[]> {
  await expireSpaceOwnerAssignments({
    serverId: input.scope.serverId,
    productUserId: input.productUserId
  });
  return withDb(async (db) => {
    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: input.scope
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

export async function listRoleBindings(input: { productUserId: string }): Promise<
  Array<{
    role: Role;
    hubId: string | null;
    serverId: string | null;
    channelId: string | null;
  }>
> {
  return withDb(async (db) => {
    const rows = await db.query<RoleBinding>(
      `select role, hub_id, server_id, channel_id
       from role_bindings
       where product_user_id = $1`,
      [input.productUserId]
    );

    const effective = [...rows.rows];

    // Add dynamic owner roles
    const owners = await db.query<{ id: string; hub_id: string }>(
      "select id, hub_id from servers where owner_user_id = $1",
      [input.productUserId]
    );
    for (const row of owners.rows) {
      if (!effective.some((b) => b.role === "space_owner" && b.server_id === row.id)) {
        effective.push({
          role: "space_owner",
          hub_id: row.hub_id,
          server_id: row.id,
          channel_id: null
        });
      }
    }

    // Add delegated assignments
    const delegated = await db.query<{ server_id: string; hub_id: string }>(
      `select a.server_id, s.hub_id
       from space_admin_assignments a
       join servers s on s.id = a.server_id
       where a.assigned_user_id = $1
         and a.status = 'active'
         and (a.expires_at is null or a.expires_at > now())`,
      [input.productUserId]
    );
    for (const row of delegated.rows) {
      if (!effective.some((b) => b.role === "space_owner" && b.server_id === row.server_id)) {
        effective.push({
          role: "space_owner",
          hub_id: row.hub_id,
          server_id: row.server_id,
          channel_id: null
        });
      }
    }

    return effective.map((row) => ({
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
}): Promise<boolean> {
  return withDb(async (db) => {
    const rows = await db.query<RoleBinding>(
      `select role, hub_id, server_id, channel_id
       from role_bindings
       where product_user_id = $1`,
      [input.productUserId]
    );

    return rows.rows.some(
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
}): Promise<boolean> {
  await expireSpaceOwnerAssignments({
    serverId: input.serverId,
    productUserId: input.productUserId
  });
  return withDb(async (db) => {
    const serverRow = await fetchServerScope(db, input.serverId);
    if (!serverRow) {
      return false;
    }
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

    const rows = await getEffectiveRoleBindings(db, {
      productUserId: input.productUserId,
      scope: {
        hubId: serverRow.hubId,
        serverId: input.serverId
      }
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
