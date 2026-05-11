import crypto from "node:crypto";
import type { AuditLogEntry, AuditLogQuery } from "@skerry/shared";
import { withDb } from "../db/client.js";

function randomId(): string {
    return `audit_${crypto.randomUUID().replaceAll("-", "")}`;
}

export interface CreateAuditEntryParams {
    serverId: string;
    actorUserId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    beforeSnapshot?: Record<string, unknown> | null;
    afterSnapshot?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
}

export async function recordAuditEntry(params: CreateAuditEntryParams): Promise<AuditLogEntry> {
    return withDb(async (db) => {
        const id = randomId();
        const row = await db.query<AuditLogEntry>(
            `insert into audit_log (id, server_id, actor_user_id, action_type, target_type, target_id, before_snapshot, after_snapshot, metadata)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             returning *`,
            [
                id,
                params.serverId,
                params.actorUserId,
                params.actionType,
                params.targetType,
                params.targetId,
                params.beforeSnapshot ?? null,
                params.afterSnapshot ?? null,
                params.metadata ?? null,
            ]
        );
        const result = row.rows[0];
        if (!result) throw new Error("Failed to create audit log entry");
        return result;
    });
}

export async function listAuditEntries(query: AuditLogQuery): Promise<{ entries: AuditLogEntry[]; total: number }> {
    return withDb(async (db) => {
        const conditions: string[] = ["server_id = $1"];
        const values: unknown[] = [query.serverId];
        let paramIndex = 2;

        if (query.actorUserId) {
            conditions.push(`actor_user_id = $${paramIndex++}`);
            values.push(query.actorUserId);
        }
        if (query.targetId) {
            conditions.push(`target_id = $${paramIndex++}`);
            values.push(query.targetId);
        }
        if (query.actionType) {
            conditions.push(`action_type = $${paramIndex++}`);
            values.push(query.actionType);
        }
        if (query.after) {
            conditions.push(`created_at > $${paramIndex++}`);
            values.push(query.after);
        }
        if (query.before) {
            conditions.push(`created_at < $${paramIndex++}`);
            values.push(query.before);
        }

        const where = conditions.join(" and ");
        const limit = Math.min(query.limit ?? 50, 100);
        const offset = query.offset ?? 0;

        const countResult = await db.query<{ count: string }>(
            `select count(*) as count from audit_log where ${where}`,
            values
        );
        const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

        const entriesResult = await db.query<AuditLogEntry>(
            `select * from audit_log where ${where} order by created_at desc limit $${paramIndex++} offset $${paramIndex++}`,
            [...values, limit, offset]
        );

        return { entries: entriesResult.rows, total };
    });
}
