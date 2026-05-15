import crypto from "node:crypto";
import type { Badge, ChannelBadgeRule, UserBadge, IdentityMapping } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { mapRow, type IdentityRow } from "./identity-service.js";

function randomId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function createBadge(input: {
    hubId: string;
    serverId: string;
    name: string;
    rank?: number;
    description?: string;
}): Promise<Badge> {
    return withDb(async (db) => {
        const id = randomId("bdg");
        const rank = input.rank ?? 0;
        const row = await db.query<Badge>(
            `insert into badges (id, hub_id, server_id, name, rank, description)
             values ($1, $2, $3, $4, $5, $6)
             returning *`,
            [id, input.hubId, input.serverId, input.name, rank, input.description ?? null]
        );
        const result = row.rows[0];
        if (!result) throw new Error("Failed to create badge");
        return result;
    });
}

export async function listBadges(serverId: string): Promise<Badge[]> {
    return withDb(async (db) => {
        const rows = await db.query<Badge>(
            "select * from badges where server_id = $1 order by rank asc",
            [serverId]
        );
        return rows.rows;
    });
}

export async function updateBadge(id: string, input: {
    name?: string;
    rank?: number;
    description?: string;
}): Promise<Badge> {
    return withDb(async (db) => {
        const row = await db.query<Badge>(
            `update badges
             set name = coalesce($2, name),
                 rank = coalesce($3, rank),
                 description = coalesce($4, description)
             where id = $1
             returning *`,
            [id, input.name ?? null, input.rank ?? null, input.description ?? null]
        );
        const result = row.rows[0];
        if (!result) throw new Error("Badge not found");
        return result;
    });
}

export async function deleteBadge(id: string): Promise<void> {
    await withDb(async (db) => {
        await db.query("delete from badges where id = $1", [id]);
    });
}

export async function assignBadgeToUser(userId: string, badgeId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query(
            "insert into user_badges (product_user_id, badge_id) values ($1, $2) on conflict do nothing",
            [userId, badgeId]
        );
    });
}

export async function revokeBadgeFromUser(userId: string, badgeId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query(
            "delete from user_badges where product_user_id = $1 and badge_id = $2",
            [userId, badgeId]
        );
    });
}

export async function listUserBadges(userId: string): Promise<Badge[]> {
    return withDb(async (db) => {
        const rows = await db.query<Badge>(
            `select b.*
             from badges b
             join user_badges ub on ub.badge_id = b.id
             where ub.product_user_id = $1
             order by b.rank asc`,
            [userId]
        );
        return rows.rows;
    });
}

export async function setChannelBadgeRule(input: {
    channelId: string;
    badgeId: string;
    accessLevel: string | null;
}): Promise<ChannelBadgeRule> {
    return withDb(async (db) => {
        const id = randomId("cbr");
        const row = await db.query<ChannelBadgeRule>(
            `insert into channel_badge_rules (id, channel_id, badge_id, access_level)
             values ($1, $2, $3, $4)
             on conflict (channel_id, badge_id) 
             do update set access_level = EXCLUDED.access_level
             returning *`,
            [id, input.channelId, input.badgeId, input.accessLevel]
        );
        const result = row.rows[0];
        if (!result) throw new Error("Failed to set channel badge rule");
        return result;
    });
}

export async function listChannelBadgeRules(channelId: string): Promise<ChannelBadgeRule[]> {
    return withDb(async (db) => {
        const rows = await db.query<ChannelBadgeRule>(
            "select * from channel_badge_rules where channel_id = $1",
            [channelId]
        );
        return rows.rows;
    });
}

export async function setServerBadgeRule(input: {
    serverId: string;
    badgeId: string;
    accessLevel: string | null;
}): Promise<any> {
    return withDb(async (db) => {
        const id = randomId("sbr");
        const row = await db.query(
            `insert into server_badge_rules (id, server_id, badge_id, access_level)
             values ($1, $2, $3, $4)
             on conflict (server_id, badge_id) 
             do update set access_level = EXCLUDED.access_level
             returning *`,
            [id, input.serverId, input.badgeId, input.accessLevel]
        );
        const result = row.rows[0];
        if (!result) throw new Error("Failed to set server badge rule");
        return result;
    });
}

export async function listServerBadgeRules(serverId: string): Promise<any[]> {
    return withDb(async (db) => {
        const rows = await db.query(
            "select * from server_badge_rules where server_id = $1",
            [serverId]
        );
        return rows.rows;
    });
}

export async function listBadgeAssignments(badgeId: string): Promise<IdentityMapping[]> {
    return withDb(async (db) => {
        const rows = await db.query<IdentityRow>(
            `select distinct on (im.product_user_id) im.*
             from user_badges ub
             join identity_mappings im on im.product_user_id = ub.product_user_id
             where ub.badge_id = $1
             order by im.product_user_id, im.display_name is not null desc, im.updated_at desc`,
            [badgeId]
        );
        return rows.rows.map(mapRow);
    });
}

export async function listServerBadgeAssignments(serverId: string): Promise<Record<string, IdentityMapping[]>> {
    return withDb(async (db) => {
        const rows = await db.query<{ badge_id: string } & IdentityRow>(
            `select ub.badge_id, im.*
             from user_badges ub
             join badges b on b.id = ub.badge_id
             join identity_mappings im on im.product_user_id = ub.product_user_id
             where b.server_id = $1
             order by ub.badge_id, im.product_user_id, im.display_name is not null desc, im.updated_at desc`,
            [serverId]
        );

        const result: Record<string, IdentityMapping[]> = {};
        for (const row of rows.rows) {
            let badgeList = result[row.badge_id];
            if (!badgeList) {
                badgeList = [];
                result[row.badge_id] = badgeList;
            }
            if (!badgeList.find(m => m.productUserId === row.product_user_id)) {
                badgeList.push(mapRow(row));
            }
        }
        return result;
    });
}
