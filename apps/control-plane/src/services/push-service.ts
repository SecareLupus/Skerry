import crypto from "node:crypto";
import type { PushSubscription } from "@skerry/shared";
import webpush from "web-push";
import { withDb } from "../db/client.js";
import { config } from "../config.js";

function randomId(): string {
    return `push_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Call once at startup to configure VAPID keys.
 *  Falls back to auto-generated keys in dev/test. */
export function initPushService(): void {
    if (!config.vapidPublicKey || !config.vapidPrivateKey) {
        // Auto-generate a keypair for dev/test — these won't survive restarts
        // but are sufficient for local/E2E testing.
        const keys = webpush.generateVAPIDKeys();
        (config as any).vapidPublicKey = keys.publicKey;
        (config as any).vapidPrivateKey = keys.privateKey;
    }
    webpush.setVapidDetails(
        `mailto:${config.vapidContactEmail ?? "admin@skerry.local"}`,
        config.vapidPublicKey!,
        config.vapidPrivateKey!
    );
}

export async function subscribeUser(params: {
    productUserId: string;
    endpoint: string;
    p256dhKey: string;
    authKey: string;
    serverId?: string | null;
}): Promise<PushSubscription> {
    return withDb(async (db) => {
        // Upsert — one subscription per endpoint
        const existing = await db.query<{ id: string }>(
            "select id from push_subscriptions where endpoint = $1",
            [params.endpoint]
        );

        if (existing.rows[0]) {
            const row = await db.query<PushSubscription>(
                `update push_subscriptions
                 set product_user_id = $1, p256dh_key = $2, auth_key = $3, server_id = $4
                 where id = $5 returning *`,
                [params.productUserId, params.p256dhKey, params.authKey,
                 params.serverId ?? null, existing.rows[0].id]
            );
            return row.rows[0]!;
        }

        const id = randomId();
        const row = await db.query<PushSubscription>(
            `insert into push_subscriptions (id, product_user_id, endpoint, p256dh_key, auth_key, server_id)
             values ($1, $2, $3, $4, $5, $6) returning *`,
            [id, params.productUserId, params.endpoint, params.p256dhKey,
             params.authKey, params.serverId ?? null]
        );
        return row.rows[0]!;
    });
}

export async function unsubscribeEndpoint(endpoint: string): Promise<void> {
    return withDb(async (db) => {
        await db.query("delete from push_subscriptions where endpoint = $1", [endpoint]);
    });
}

export async function sendPushToUsers(userIds: string[], payload: {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    url?: string;
}): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    if (!config.vapidPublicKey || !config.vapidPrivateKey) {
        return { sent, failed };
    }

    const subs = await withDb(async (db) => {
        const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
        const rows = await db.query<PushSubscription>(
            `select * from push_subscriptions where product_user_id in (${placeholders})`,
            userIds
        );
        return rows.rows;
    });

    const payloadStr = JSON.stringify(payload);

    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
                },
                payloadStr
            );
            sent++;
        } catch (err: any) {
            failed++;
            // Clean up expired subscriptions
            if (err.statusCode === 410 || err.statusCode === 404) {
                await unsubscribeEndpoint(sub.endpoint).catch(() => {});
            }
        }
    }

    return { sent, failed };
}
