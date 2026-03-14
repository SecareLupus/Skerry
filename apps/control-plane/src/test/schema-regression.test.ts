import test from "node:test";
import assert from "node:assert/strict";
import { pool, initDb } from "../db/client.js";

test("schema has granular access columns and no privacy_tier", async () => {
  await initDb();
  if (!pool) {
    console.error("No database connection pool available for schema regression test.");
    return;
  }

  // Check channels table
  const channelCols = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'channels'
  `);
  const channelColNames = channelCols.rows.map(r => r.column_name);
  
  assert.ok(channelColNames.includes('hub_admin_access'), "channels should have hub_admin_access");
  assert.ok(channelColNames.includes('space_member_access'), "channels should have space_member_access");
  assert.ok(channelColNames.includes('hub_member_access'), "channels should have hub_member_access");
  assert.ok(channelColNames.includes('visitor_access'), "channels should have visitor_access");
  assert.ok(!channelColNames.includes('privacy_tier'), "channels should NOT have privacy_tier");

  // Check servers table
  const serverCols = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'servers'
  `);
  const serverColNames = serverCols.rows.map(r => r.column_name);

  assert.ok(serverColNames.includes('hub_admin_access'), "servers should have hub_admin_access");
  assert.ok(serverColNames.includes('space_member_access'), "servers should have space_member_access");
  assert.ok(serverColNames.includes('hub_member_access'), "servers should have hub_member_access");
  assert.ok(serverColNames.includes('visitor_access'), "servers should have visitor_access");
  assert.ok(!serverColNames.includes('privacy_tier'), "servers should NOT have privacy_tier");
});
