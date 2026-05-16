import crypto from "node:crypto";
import { withDb } from "../db/client.js";
import { bcryptHash, bcryptVerify } from "./webauthn-service.js";

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 10; // 20 hex chars per code

/**
 * Generate recovery codes for a user on a hub. Returns the plaintext codes 
 * once; stores only hashes.
 */
export async function generateRecoveryCodes(hubId: string, productUserId: string): Promise<string[]> {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        codes.push(crypto.randomBytes(RECOVERY_CODE_BYTES).toString("hex"));
    }

    await withDb(async (db) => {
        for (const code of codes) {
            const hash = await bcryptHash(code);
            await db.query(
                `insert into recovery_codes (id, hub_id, product_user_id, code_hash)
                 values ($1, $2, $3, $4)`,
                [`rec_${crypto.randomUUID().replaceAll("-", "")}`, hubId, productUserId, hash]
            );
        }
    });

    return codes;
}

/**
 * Verify and consume a recovery code. Returns true if valid and unused.
 */
export async function redeemRecoveryCode(hubId: string, productUserId: string, code: string): Promise<boolean> {
    const rows = await withDb(async (db) => {
        const result = await db.query<{ id: string; code_hash: string }>(
            "select id, code_hash from recovery_codes where product_user_id = $1 and hub_id = $2 and used_at is null",
            [productUserId, hubId]
        );
        return result.rows;
    });

    for (const row of rows) {
        if (await bcryptVerify(code, row.code_hash)) {
            await withDb(async (db) => {
                await db.query(
                    "update recovery_codes set used_at = now() where id = $1",
                    [row.id]
                );
            });
            return true;
        }
    }

    return false;
}

/**
 * Count unused recovery codes for a user on a hub.
 */
export async function countRecoveryCodes(hubId: string, productUserId: string): Promise<number> {
    return withDb(async (db) => {
        const result = await db.query<{ count: string }>(
            "select count(*) as count from recovery_codes where product_user_id = $1 and hub_id = $2 and used_at is null",
            [productUserId, hubId]
        );
        return parseInt(result.rows[0]?.count ?? "0", 10);
    });
}
