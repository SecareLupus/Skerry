const { Client } = require("pg");

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  console.log("Adding reply_to_id column to chat_messages if not exists...");
  await client.query(`
    alter table chat_messages 
    add column if not exists reply_to_id text;
  `);
  console.log("Migration complete.");
  await client.end();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
