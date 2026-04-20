import crypto from "node:crypto";
import type { ModerationAction, ModerationReport, ReportStatus, Role } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { executePrivilegedAction } from "./privileged-gateway.js";

const REPORT_RATE_LIMITS = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REPORTS_PER_WINDOW = process.env.NODE_ENV === "test" ? 1 : 5;

interface BaseModerationInput {
  actorUserId: string;
  hubId?: string;
  serverId?: string;
  channelId?: string;
  targetUserId?: string;
  targetMessageId?: string;
  reason: string;
}

export async function setChannelControls(input: {
  actorUserId: string;
  serverId: string;
  channelId: string;
  lock?: boolean;
  slowModeSeconds?: number;
  postingRestrictedToRoles?: Role[];
  reason: string;
}): Promise<void> {
  if (typeof input.lock === "boolean") {
    await executePrivilegedAction({
      actorUserId: input.actorUserId,
      action: input.lock ? "channel.lock" : "channel.unlock",
      scope: { serverId: input.serverId, channelId: input.channelId },
      reason: input.reason,
      run: async () => {
        await withDb(async (db) => {
          await db.query("update channels set is_locked = $1 where id = $2 and server_id = $3", [
            input.lock,
            input.channelId,
            input.serverId
          ]);
        });
      }
    });
  }

  if (typeof input.slowModeSeconds === "number") {
    await executePrivilegedAction({
      actorUserId: input.actorUserId,
      action: "channel.slowmode",
      scope: { serverId: input.serverId, channelId: input.channelId },
      reason: input.reason,
      metadata: { slowModeSeconds: input.slowModeSeconds },
      run: async () => {
        await withDb(async (db) => {
          await db.query("update channels set slow_mode_seconds = $1 where id = $2 and server_id = $3", [
            input.slowModeSeconds,
            input.channelId,
            input.serverId
          ]);
        });
      }
    });
  }

  if (input.postingRestrictedToRoles) {
    await executePrivilegedAction({
      actorUserId: input.actorUserId,
      action: "channel.posting",
      scope: { serverId: input.serverId, channelId: input.channelId },
      reason: input.reason,
      metadata: { roles: input.postingRestrictedToRoles },
      run: async () => {
        await withDb(async (db) => {
          await db.query(
            "update channels set posting_restricted_to_roles = $1 where id = $2 and server_id = $3",
            [input.postingRestrictedToRoles, input.channelId, input.serverId]
          );
        });
      }
    });
  }
}

export async function performModerationAction(
  input: BaseModerationInput & { action: "kick" | "ban" | "unban" | "timeout" | "redact_message" | "warn" | "strike"; timeoutSeconds?: number }
): Promise<void> {
  const actionMap = {
    kick: "moderation.kick",
    ban: "moderation.ban",
    unban: "moderation.unban",
    timeout: "moderation.timeout",
    warn: "moderation.warn",
    strike: "moderation.strike",
    redact_message: "moderation.redact"
  } as const;

  await executePrivilegedAction({
    actorUserId: input.actorUserId,
    action: actionMap[input.action],
    scope: { hubId: input.hubId, serverId: input.serverId, channelId: input.channelId },
    reason: input.reason,
    targetUserId: input.targetUserId,
    targetMessageId: input.targetMessageId,
    metadata: input.timeoutSeconds ? { timeoutSeconds: input.timeoutSeconds } : undefined,
    run: async () => {
      const { kickUser, banUser, unbanUser, redactEvent, setUserMuted } = await import("../matrix/synapse-adapter.js");
      const { fetchServerScope } = await import("./policy-service.js");

      // Resolve scope for Matrix operations
      const scope = await withDb(async (db) => {
        if (input.channelId) {
          const room = await db.query<{ matrix_room_id: string; server_id: string }>(
            "select matrix_room_id, server_id from channels where id = $1",
            [input.channelId]
          );
          return { roomId: room.rows[0]?.matrix_room_id, serverId: room.rows[0]?.server_id };
        }
        if (input.serverId) {
          const server = await db.query<{ matrix_space_id: string }>(
            "select matrix_space_id from servers where id = $1",
            [input.serverId]
          );
          return { roomId: server.rows[0]?.matrix_space_id, serverId: input.serverId };
        }
        return { roomId: null, serverId: null };
      });

      if (input.action === "warn") {
        await warnUser(input);
        return;
      }

      if (input.action === "strike") {
        await applyStrike(input);
        return;
      }

      if (input.action === "timeout" && input.targetUserId) {
        if (!scope.roomId) throw new Error("Could not resolve Matrix room for timeout");
        await setUserMuted(scope.roomId, input.targetUserId, true);

        await withDb(async (db) => {
          const expiresAt = input.timeoutSeconds
            ? new Date(Date.now() + input.timeoutSeconds * 1000)
            : null;

          await db.query(
            `insert into moderation_time_restrictions (id, hub_id, server_id, channel_id, target_user_id, status, expires_at)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `mtr_${crypto.randomUUID().replaceAll("-", "")}`,
              input.hubId || null,
              input.serverId || null,
              input.channelId || null,
              input.targetUserId,
              "active",
              expiresAt
            ]
          );
        });
      }

      if (input.action === "kick" && input.targetUserId) {
        if (!scope.roomId) throw new Error("Could not resolve Matrix room for kick");
        await kickUser({ roomId: scope.roomId, userId: input.targetUserId, reason: input.reason });
        
        // Sync membership state
        const { leaveServer, leaveHub } = await import("./membership-service.js");
        if (input.serverId) {
          await leaveServer(input.serverId, input.targetUserId);
        } else if (input.hubId) {
          await leaveHub(input.hubId, input.targetUserId);
        }
      }

      if (input.action === "ban" && input.targetUserId) {
        if (!scope.roomId) throw new Error("Could not resolve Matrix room for ban");
        await banUser({ roomId: scope.roomId, userId: input.targetUserId, reason: input.reason });

        // Sync membership state
        const { leaveServer, leaveHub } = await import("./membership-service.js");
        if (input.serverId) {
          await leaveServer(input.serverId, input.targetUserId);
        }
        if (input.hubId) {
          await leaveHub(input.hubId, input.targetUserId);
        }
      }

      if (input.action === "unban" && input.targetUserId) {
        if (!scope.roomId) throw new Error("Could not resolve Matrix room for unban");
        await unbanUser({ roomId: scope.roomId, userId: input.targetUserId });
      }

      if (input.action === "redact_message" && input.targetMessageId) {
        if (!scope.roomId) throw new Error("Could not resolve Matrix room for redaction");
        await redactEvent({ roomId: scope.roomId, eventId: input.targetMessageId, reason: input.reason });
      }

      // (Audit Log is handled automatically by executePrivilegedAction)

      // Handle Discord-side moderation if applicable (Hub/Space level)
      if (input.targetUserId && input.serverId) {
        const { getDiscordBridgeConnection } = await import("./discord-bridge-service.js");
        const {
          kickDiscordMember,
          banDiscordMember,
          unbanDiscordMember,
          timeoutDiscordMember
        } = await import("./discord-bot-client.js");

        const discordData = await withDb(async (db) => {
          let discordId: string | null = null;
          if (input.targetUserId?.startsWith("discord_")) {
            discordId = input.targetUserId.replace("discord_", "");
          } else if (input.targetUserId) {
            const idRow = await db.query<{ oidc_subject: string }>(
              "select oidc_subject from identity_mappings where product_user_id = $1 and provider = 'discord' limit 1",
              [input.targetUserId]
            );
            discordId = idRow.rows[0]?.oidc_subject ?? null;
          }
          return { discordId };
        });

        const connection = await getDiscordBridgeConnection(input.serverId);
        if (discordData.discordId && connection?.guildId && connection.status === "connected") {
          try {
            switch (input.action) {
              case "kick":
                await kickDiscordMember(connection.guildId, discordData.discordId, input.reason);
                break;
              case "ban":
                await banDiscordMember(connection.guildId, discordData.discordId, input.reason);
                break;
              case "unban":
                await unbanDiscordMember(connection.guildId, discordData.discordId, input.reason);
                break;
              case "timeout":
                await timeoutDiscordMember(connection.guildId, discordData.discordId, input.timeoutSeconds ?? 3600, input.reason);
                break;
            }
          } catch (error) {
            console.error("Failed to perform Discord moderation:", error);
          }
        }
      }
    }
  });
}

export async function warnUser(input: BaseModerationInput): Promise<void> {
  if (!input.targetUserId) return;

  const { getIdentityByProductUserId } = await import("./identity-service.js");

  const identity = await getIdentityByProductUserId(input.targetUserId);
  if (identity?.matrixUserId) {
    console.log(`[WARN] User ${input.targetUserId} (${identity.matrixUserId}) warned: ${input.reason}`);
  }

  await withDb(async (db) => {
    await db.query(
      `insert into moderation_warnings (id, hub_id, server_id, channel_id, target_user_id, actor_user_id, reason, message_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        `wrn_${crypto.randomUUID().replaceAll("-", "")}`,
        input.hubId || null,
        input.serverId || null,
        input.channelId || null,
        input.targetUserId,
        input.actorUserId,
        input.reason,
        input.targetMessageId || null
      ]
    );
  });
}

export async function applyStrike(input: BaseModerationInput): Promise<void> {
  if (!input.targetUserId) return;

  await withDb(async (db) => {
    const strikeId = `stk_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.query(
      `insert into moderation_strikes (id, hub_id, server_id, channel_id, target_user_id, actor_user_id, reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [strikeId, input.hubId || null, input.serverId || null, input.channelId || null, input.targetUserId, input.actorUserId, input.reason]
    );

    const countRes = await db.query<{ count: string }>(
      "select count(*) from moderation_strikes where target_user_id = $1 and (server_id = $2 or hub_id = $3)",
      [input.targetUserId, input.serverId || null, input.hubId || null]
    );
    const count = parseInt(countRes.rows[0]?.count ?? "0", 10);

    if (count >= 7) {
      await performModerationAction({ ...input, action: "ban", reason: `Escalation: ${count} strikes accumulated` });
      await db.query("update moderation_strikes set action_taken = 'ban' where id = $1", [strikeId]);
    } else if (count >= 5) {
      await performModerationAction({ ...input, action: "kick", reason: `Escalation: ${count} strikes accumulated` });
      await db.query("update moderation_strikes set action_taken = 'kick' where id = $1", [strikeId]);
    } else if (count >= 3) {
      await performModerationAction({ ...input, action: "timeout", timeoutSeconds: 3600, reason: `Escalation: ${count} strikes accumulated` });
      await db.query("update moderation_strikes set action_taken = 'timeout' where id = $1", [strikeId]);
    } else {
      await warnUser({ ...input, reason: `Strike added. Current strike count: ${count}. Reason: ${input.reason}` });
      await db.query("update moderation_strikes set action_taken = 'warn' where id = $1", [strikeId]);
    }
  });
}

export async function createReport(input: {
  reporterUserId: string;
  serverId: string;
  channelId?: string;
  targetUserId?: string;
  targetMessageId?: string;
  reason: string;
}): Promise<ModerationReport> {
  const now = Date.now();
  const limitKey = `report_${input.reporterUserId}`;
  const history = REPORT_RATE_LIMITS.get(limitKey) || [];
  
  // Clean up old history
  const activeHistory = history.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  
  if (activeHistory.length >= MAX_REPORTS_PER_WINDOW) {
    const error = new Error("You are reporting too fast. Please wait a moment.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 400;
    error.code = "too_many_requests";
    throw error;
  }
  
  activeHistory.push(now);
  REPORT_RATE_LIMITS.set(limitKey, activeHistory);

  return withDb(async (db) => {
    const id = `rpt_${crypto.randomUUID().replaceAll("-", "")}`;
    const row = await db.query<{
      id: string;
      server_id: string;
      channel_id: string | null;
      reporter_user_id: string;
      target_user_id: string | null;
      target_message_id: string | null;
      reason: string;
      status: ReportStatus;
      triaged_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `insert into moderation_reports
       (id, server_id, channel_id, reporter_user_id, target_user_id, target_message_id, reason, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'open')
       returning *`,
      [id, input.serverId, input.channelId ?? null, input.reporterUserId, input.targetUserId ?? null, input.targetMessageId ?? null, input.reason]
    );

    const value = row.rows[0]!;
    return {
      id: value.id,
      serverId: value.server_id,
      channelId: value.channel_id,
      reporterUserId: value.reporter_user_id,
      targetUserId: value.target_user_id,
      targetMessageId: value.target_message_id,
      reason: value.reason,
      status: value.status,
      triagedByUserId: value.triaged_by_user_id,
      createdAt: value.created_at,
      updatedAt: value.updated_at
    };
  });
}

export async function transitionReportStatus(input: {
  actorUserId: string;
  reportId: string;
  serverId: string;
  status: Exclude<ReportStatus, "open">;
  reason: string;
}): Promise<ModerationReport> {
  await executePrivilegedAction({
    actorUserId: input.actorUserId,
    action: "reports.triage",
    scope: { serverId: input.serverId },
    reason: input.reason,
    metadata: { reportId: input.reportId, status: input.status },
    run: async () => Promise.resolve()
  });

  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      server_id: string;
      channel_id: string | null;
      reporter_user_id: string;
      target_user_id: string | null;
      target_message_id: string | null;
      reason: string;
      status: ReportStatus;
      triaged_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `update moderation_reports
       set status = $1, triaged_by_user_id = $2, updated_at = now()
       where id = $3 and server_id = $4
       returning *`,
      [input.status, input.actorUserId, input.reportId, input.serverId]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Report not found for scope.");
    }

    return {
      id: value.id,
      serverId: value.server_id,
      channelId: value.channel_id,
      reporterUserId: value.reporter_user_id,
      targetUserId: value.target_user_id,
      targetMessageId: value.target_message_id,
      reason: value.reason,
      status: value.status,
      triagedByUserId: value.triaged_by_user_id,
      createdAt: value.created_at,
      updatedAt: value.updated_at
    };
  });
}

export async function listReports(input: {
  serverId: string;
  status?: ReportStatus;
}): Promise<ModerationReport[]> {
  return withDb(async (db) => {
    const rows = await db.query<{
      id: string;
      server_id: string;
      channel_id: string | null;
      reporter_user_id: string;
      target_user_id: string | null;
      target_message_id: string | null;
      reason: string;
      status: ReportStatus;
      triaged_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select *
       from moderation_reports
       where server_id = $1
         and ($2::text is null or status = $2)
       order by created_at desc
       limit 200`,
      [input.serverId, input.status ?? null]
    );

    return rows.rows.map((value) => ({
      id: value.id,
      serverId: value.server_id,
      channelId: value.channel_id,
      reporterUserId: value.reporter_user_id,
      targetUserId: value.target_user_id,
      targetMessageId: value.target_message_id,
      reason: value.reason,
      status: value.status,
      triagedByUserId: value.triaged_by_user_id,
      createdAt: value.created_at,
      updatedAt: value.updated_at
    }));
  });
}

export async function listAuditLogs(serverId: string): Promise<ModerationAction[]> {
  return withDb(async (db) => {
    const rows = await db.query<{
      id: string;
      action_type: ModerationAction["actionType"];
      actor_user_id: string;
      hub_id: string | null;
      server_id: string | null;
      channel_id: string | null;
      target_user_id: string | null;
      target_message_id: string | null;
      reason: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(
      "select * from moderation_actions where server_id = $1 order by created_at desc limit 200",
      [serverId]
    );

    return rows.rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      actorUserId: row.actor_user_id,
      hubId: row.hub_id,
      serverId: row.server_id,
      channelId: row.channel_id,
      targetUserId: row.target_user_id,
      targetMessageId: row.target_message_id,
      reason: row.reason,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    }));
  });
}

export async function listHubAuditLogs(hubId: string): Promise<ModerationAction[]> {
  return withDb(async (db) => {
    const rows = await db.query<{
      id: string;
      action_type: ModerationAction["actionType"];
      actor_user_id: string;
      hub_id: string | null;
      server_id: string | null;
      channel_id: string | null;
      target_user_id: string | null;
      target_message_id: string | null;
      reason: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(
      "select * from moderation_actions where hub_id = $1 order by created_at desc limit 200",
      [hubId]
    );

    return rows.rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      actorUserId: row.actor_user_id,
      hubId: row.hub_id,
      serverId: row.server_id,
      channelId: row.channel_id,
      targetUserId: row.target_user_id,
      targetMessageId: row.target_message_id,
      reason: row.reason,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    }));
  });
}
export async function performBulkModerationAction(input: {
  actorUserId: string;
  serverId: string;
  targetUserIds: string[];
  action: "kick" | "ban" | "unban" | "timeout";
  reason: string;
  timeoutSeconds?: number;
}): Promise<{ successes: string[]; failures: Array<{ userId: string; error: string }> }> {
  const results = {
    successes: [] as string[],
    failures: [] as Array<{ userId: string; error: string }>
  };

  for (const userId of input.targetUserIds) {
    try {
      await performModerationAction({
        actorUserId: input.actorUserId,
        serverId: input.serverId,
        targetUserId: userId,
        action: input.action,
        reason: input.reason,
        timeoutSeconds: input.timeoutSeconds
      });
      results.successes.push(userId);
    } catch (error) {
      results.failures.push({
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

export function resetModerationServiceInternalState(): void {
  REPORT_RATE_LIMITS.clear();
}

export async function isUserTimedOut(userId: string, scope: { hubId?: string, serverId?: string, channelId?: string }): Promise<boolean> {
  return withDb(async (db) => {
    // Resolve parents for hierarchical check
    let effectiveServerId = scope.serverId || null;
    let effectiveHubId = scope.hubId || null;

    if (scope.channelId && !effectiveServerId) {
      const channelRes = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [scope.channelId]);
      effectiveServerId = channelRes.rows[0]?.server_id ?? null;
    }
    if (effectiveServerId && !effectiveHubId) {
       const serverRes = await db.query<{ hub_id: string }>("select hub_id from servers where id = $1", [effectiveServerId]);
       effectiveHubId = serverRes.rows[0]?.hub_id ?? null;
    }

    const res = await db.query<{ id: string }>(
      `select id from moderation_time_restrictions 
       where target_user_id = $1 
         and status = 'active'
         and (expires_at is null or expires_at > now())
         and (
           (hub_id is not null and hub_id = $2) or 
           (server_id is not null and server_id = $3) or 
           (channel_id is not null and channel_id = $4)
         )`,
      [userId, effectiveHubId, effectiveServerId, scope.channelId || null]
    );
    return (res.rowCount ?? 0) > 0;
  });
}
