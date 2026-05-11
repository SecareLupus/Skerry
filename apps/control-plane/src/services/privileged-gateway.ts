import crypto from "node:crypto";
import type { ModerationActionType, PrivilegedAction } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { isActionAllowed } from "./policy-service.js";
import { recordAuditEntry } from "./audit-service.js";

function toModerationActionType(action: PrivilegedAction): ModerationActionType {
  if (action === "moderation.kick") return "kick";
  if (action === "moderation.ban") return "ban";
  if (action === "moderation.unban") return "unban";
  if (action === "moderation.timeout") return "timeout";
  if (action === "moderation.warn") return "warn";
  if (action === "moderation.strike") return "strike";
  if (action === "moderation.redact") return "redact_message";
  if (action === "channel.lock") return "lock_channel";
  if (action === "channel.unlock") return "unlock_channel";
  if (action === "channel.slowmode") return "set_slow_mode";
  return "set_posting_restrictions";
}

function toAuditActionType(action: PrivilegedAction): string | null {
  if (action === "moderation.kick") return "moderation.kick";
  if (action === "moderation.ban") return "moderation.ban";
  if (action === "moderation.timeout") return "moderation.mute";
  if (action === "moderation.warn") return "moderation.warn";
  if (action === "moderation.strike") return "moderation.strike";
  if (action === "channel.lock" || action === "channel.unlock" ||
      action === "channel.slowmode" || action === "channel.posting") return "channel.update";
  return null;
}

export async function executePrivilegedAction<T>(input: {
  actorUserId: string;
  action: PrivilegedAction;
  scope: { hubId?: string; serverId?: string; channelId?: string };
  reason: string;
  targetUserId?: string;
  targetMessageId?: string;
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const allowed = await isActionAllowed({
    productUserId: input.actorUserId,
    action: input.action,
    scope: input.scope
  });

  if (!allowed) {
    const error = new Error("Forbidden: action is outside of assigned moderation scope.") as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 403;
    error.code = "forbidden_scope";
    throw error;
  }

  const result = await input.run();

  await withDb(async (db) => {
    await db.query(
      `insert into moderation_actions
       (id, action_type, actor_user_id, hub_id, server_id, channel_id, target_user_id, target_message_id, reason, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        `mod_${crypto.randomUUID().replaceAll("-", "")}`,
        toModerationActionType(input.action),
        input.actorUserId,
        input.scope.hubId ?? null,
        input.scope.serverId ?? null,
        input.scope.channelId ?? null,
        input.targetUserId ?? null,
        input.targetMessageId ?? null,
        input.reason,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  });

  // Record to audit_log when applicable (server-scoped, mappable action)
  const auditAction = toAuditActionType(input.action);
  if (auditAction && input.scope.serverId) {
    const targetType = input.targetUserId ? "user" :
      input.targetMessageId ? "message" :
      input.scope.channelId ? "channel" : "server";
    const targetId = input.targetUserId ?? input.targetMessageId ??
      input.scope.channelId ?? input.scope.serverId!;

    await recordAuditEntry({
      serverId: input.scope.serverId,
      actorUserId: input.actorUserId,
      actionType: auditAction,
      targetType,
      targetId,
      metadata: { reason: input.reason, ...(input.metadata ?? {}) }
    });
  }

  return result;
}
