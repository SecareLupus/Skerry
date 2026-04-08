import { withDb } from "./apps/control-plane/src/db/client.js";

async function migrate() {
  await withDb(async (db) => {
    console.log("Adding reply_to_id column to chat_messages if not exists...");
    await db.query(`
      alter table chat_messages 
      add column if not exists reply_to_id text;
    `);
    console.log("Migration complete.");
  });
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
