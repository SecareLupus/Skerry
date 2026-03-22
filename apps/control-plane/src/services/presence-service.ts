import { withDb } from "../db/client.js";

export async function updateUserPresence(productUserId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `insert into user_presence (product_user_id, last_seen_at)
       values ($1, now())
       on conflict (product_user_id)
       do update set last_seen_at = now()`,
      [productUserId]
    );
  });
}

export async function listUserPresence(productUserIds: string[]): Promise<Record<string, { lastSeenAt: string; isOnline: boolean }>> {
  if (productUserIds.length === 0) return {};

  return withDb(async (db) => {
    const rows = await db.query<{
      product_user_id: string;
      last_seen_at: Date;
    }>(
      `select product_user_id, last_seen_at
       from user_presence
       where product_user_id = any($1)`,
      [productUserIds]
    );

    const presence: Record<string, { lastSeenAt: string; isOnline: boolean }> = {};
    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

    for (const row of rows.rows) {
      const lastSeenAt = new Date(row.last_seen_at).getTime();
      presence[row.product_user_id] = {
        lastSeenAt: row.last_seen_at.toISOString(),
        isOnline: now - lastSeenAt < ONLINE_THRESHOLD_MS
      };
    }

    return presence;
  });
}
