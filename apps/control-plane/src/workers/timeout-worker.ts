import { withDb } from "../db/client.js";
import { setUserMuted } from "../matrix/synapse-adapter.js";

export async function processExpiredTimeouts(): Promise<void> {
  await withDb(async (db) => {
    // Find all expired but still active restrictions
    const expiredResult = await db.query<{ id: string, server_id: string, target_user_id: string }>(
      "select id, server_id, target_user_id from moderation_time_restrictions where status = 'active' and expires_at <= now()"
    );

    if (expiredResult.rows.length === 0) {
      return;
    }

    // Process each timeout removal
    for (const record of expiredResult.rows) {
      // 1. Fetch matrix space and room IDs
      const srvRow = await db.query<{ matrix_space_id: string }>(
        "select matrix_space_id from servers where id = $1",
        [record.server_id]
      );
      const serverMatrixId = srvRow.rows[0]?.matrix_space_id;
      
      const chRow = await db.query<{ matrix_room_id: string }>(
        "select matrix_room_id from channels where server_id = $1 and matrix_room_id is not null",
        [record.server_id]
      );
      const channels = chRow.rows.map(r => r.matrix_room_id);
      
      const roomIds = serverMatrixId ? [serverMatrixId, ...channels] : channels;

      // 2. Unmute them
      if (roomIds.length > 0) {
        await Promise.allSettled(
          roomIds.map(roomId => setUserMuted(roomId, record.target_user_id, false))
        );
      }

      // 3. Mark as expired
      await db.query(
        "update moderation_time_restrictions set status = 'expired', updated_at = now() where id = $1",
        [record.id]
      );
    }
    
    console.log(`[Timeout Worker] Processed ${expiredResult.rows.length} expired timeouts.`);
  });
}

let workerInterval: NodeJS.Timeout | null = null;

export function startTimeoutWorker(intervalMs = 60000) {
  if (workerInterval) return;
  workerInterval = setInterval(() => {
    void processExpiredTimeouts().catch(err => {
      console.error("[Timeout Worker] Error processing timeouts:", err);
    });
  }, intervalMs);
  
  // Also run once on startup
  setTimeout(() => {
    void processExpiredTimeouts().catch(console.error);
  }, 5000);
}

export function stopTimeoutWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
