import { TOTP } from "otpauth";
import crypto from "node:crypto";
import { withDb } from "../db/client.js";

const ISSUER = "Skerry";

/**
 * Generate a new TOTP secret for enrollment. Returns the secret (for QR) 
 * and a verification token to confirm enrollment.
 */
export async function beginTotpEnrollment(input: {
    hubId: string;
    productUserId: string;
    email?: string | null;
}): Promise<{ secret: string; uri: string }> {
    const secret = new TOTP({
        issuer: ISSUER,
        label: input.email ?? input.productUserId,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
    });
    const secretStr = secret.secret as unknown as string;

    const uri = `otpauth://totp/${ISSUER}:${encodeURIComponent(input.email ?? input.productUserId)}?secret=${secretStr}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`;

    // Store the secret (unverified) so it can be confirmed
    await withDb(async (db) => {
        await db.query(
            `insert into totp_secrets (hub_id, product_user_id, secret, enabled)
             values ($1, $2, $3, false)
             on conflict (hub_id, product_user_id)
             do update set secret = excluded.secret, enabled = false`,
            [input.hubId, input.productUserId, secretStr]
        );
    });

    return { secret: secretStr, uri };
}

/**
 * Verify a TOTP code to confirm enrollment.
 */
export async function verifyTotpEnrollment(input: {
    hubId: string;
    productUserId: string;
    code: string;
}): Promise<boolean> {
    const row = await withDb(async (db) => {
        const result = await db.query<{ secret: string }>(
            "select secret from totp_secrets where hub_id = $1 and product_user_id = $2",
            [input.hubId, input.productUserId]
        );
        return result.rows[0] ?? null;
    });

    if (!row) return false;

    const totp = new TOTP({
        issuer: ISSUER,
        secret: row.secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
    });

    const delta = totp.validate({ token: input.code, window: 1 });
    if (delta === null) return false;

    // Mark as enabled
    await withDb(async (db) => {
        await db.query(
            "update totp_secrets set enabled = true where hub_id = $1 and product_user_id = $2",
            [input.hubId, input.productUserId]
        );
    });

    return true;
}

/**
 * Verify a TOTP code for 2FA enforcement.
 */
export async function verifyTotp(input: {
    hubId: string;
    productUserId: string;
    code: string;
}): Promise<boolean> {
    const row = await withDb(async (db) => {
        const result = await db.query<{ secret: string; enabled: boolean }>(
            "select secret, enabled from totp_secrets where hub_id = $1 and product_user_id = $2",
            [input.hubId, input.productUserId]
        );
        return result.rows[0] ?? null;
    });

    if (!row || !row.enabled) return false;

    const totp = new TOTP({
        issuer: ISSUER,
        secret: row.secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
    });

    return totp.validate({ token: input.code, window: 1 }) !== null;
}

/**
 * Check if a user has TOTP enrolled and enabled on a hub.
 */
export async function hasTotpEnabled(hubId: string, productUserId: string): Promise<boolean> {
    const row = await withDb(async (db) => {
        const result = await db.query<{ enabled: boolean }>(
            "select enabled from totp_secrets where hub_id = $1 and product_user_id = $2",
            [hubId, productUserId]
        );
        return result.rows[0] ?? null;
    });
    return row?.enabled ?? false;
}

/**
 * Disable TOTP for a user on a hub.
 */
export async function removeTotp(hubId: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query("delete from totp_secrets where hub_id = $1 and product_user_id = $2", [hubId, productUserId]);
    });
}
