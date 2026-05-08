import test from "node:test";
import assert from "node:assert/strict";
import { pool, initDb } from "../db/client.js";

test("schema: legacy *_access columns dropped; rules tables present", async () => {
  await initDb();
  if (!pool) {
    console.error("No database connection pool available for schema regression test.");
    return;
  }

  // Channels table
  const channelCols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'channels'
  `);
  const channelColNames = channelCols.rows.map(r => r.column_name);

  // P2.cleanup (2026-05-08): legacy `*_access` columns are gone.
  assert.ok(!channelColNames.includes('hub_admin_access'), "channels should NOT have hub_admin_access");
  assert.ok(!channelColNames.includes('space_member_access'), "channels should NOT have space_member_access");
  assert.ok(!channelColNames.includes('hub_member_access'), "channels should NOT have hub_member_access");
  assert.ok(!channelColNames.includes('visitor_access'), "channels should NOT have visitor_access");
  assert.ok(!channelColNames.includes('privacy_tier'), "channels should NOT have privacy_tier");

  // Servers table
  const serverCols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'servers'
  `);
  const serverColNames = serverCols.rows.map(r => r.column_name);

  assert.ok(!serverColNames.includes('hub_admin_access'), "servers should NOT have hub_admin_access");
  assert.ok(!serverColNames.includes('space_member_access'), "servers should NOT have space_member_access");
  assert.ok(!serverColNames.includes('hub_member_access'), "servers should NOT have hub_member_access");
  assert.ok(!serverColNames.includes('visitor_access'), "servers should NOT have visitor_access");
  assert.ok(!serverColNames.includes('privacy_tier'), "servers should NOT have privacy_tier");

  // The replacement tables exist.
  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name in ('space_access_rules', 'channel_access_rules')
  `);
  const tableNames = tables.rows.map(r => r.table_name);
  assert.ok(tableNames.includes('space_access_rules'), "space_access_rules table should exist");
  assert.ok(tableNames.includes('channel_access_rules'), "channel_access_rules table should exist");
});
