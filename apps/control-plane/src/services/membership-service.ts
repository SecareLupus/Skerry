import { withDb } from "../db/client.js";
import { handleUserJoinedServer } from "./house-bot-service.js";
import { getIdentityByProductUserId } from "./identity-service.js";

export async function joinServer(serverId: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        const row = await db.query(
            "insert into server_members (server_id, product_user_id) values ($1, $2) on conflict do nothing returning 1",
            [serverId, productUserId]
        );
        
        // If it was a new join (not a duplicate)
        if (row.rowCount && row.rowCount > 0) {
            const identity = await getIdentityByProductUserId(productUserId);
            if (identity) {
                await handleUserJoinedServer(serverId, productUserId, identity.displayName || `user-${productUserId.slice(0, 8)}`);
            }
        }
    });
}

export async function leaveServer(serverId: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query(
            "delete from server_members where server_id = $1 and product_user_id = $2",
            [serverId, productUserId]
        );
    });
}

export async function joinHub(hubId: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query(
            "insert into hub_members (hub_id, product_user_id) values ($1, $2) on conflict do nothing",
            [hubId, productUserId]
        );
        
        // Auto-join servers that have auto_join_hub_members = true
        const serversToJoin = await db.query<{ id: string }>(
            "select id from servers where hub_id = $1 and auto_join_hub_members = true",
            [hubId]
        );
        
        for (const server of serversToJoin.rows) {
            await db.query(
                "insert into server_members (server_id, product_user_id) values ($1, $2) on conflict do nothing",
                [server.id, productUserId]
            );
        }
    });
}

export async function leaveHub(hubId: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query(
            "delete from hub_members where hub_id = $1 and product_user_id = $2",
            [hubId, productUserId]
        );
        // Cascading delete for server members in this hub
        await db.query(
            `delete from server_members 
             where product_user_id = $1 
               and server_id in (select id from servers where hub_id = $2)`,
            [productUserId, hubId]
        );
    });
}

export async function isServerMember(serverId: string, productUserId: string): Promise<boolean> {
    return withDb(async (db) => {
        const row = await db.query("select 1 from server_members where server_id = $1 and product_user_id = $2", [serverId, productUserId]);
        return row.rows.length > 0;
    });
}

export async function isHubMember(hubId: string, productUserId: string): Promise<boolean> {
    return withDb(async (db) => {
        const row = await db.query("select 1 from hub_members where hub_id = $1 and product_user_id = $2", [hubId, productUserId]);
        return row.rows.length > 0;
    });
}
