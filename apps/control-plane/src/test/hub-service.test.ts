import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initDb, pool } from "../db/client.js";
import { listHubsForUser } from "../services/hub-service.js";
import { resetDb } from "./helpers/reset-db.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("hub service listHubsForUser", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  // Create hubs
  await pool.query(`insert into hubs (id, name, owner_user_id) values ('hub_1', 'Hub 1', 'user_a')`);
  await pool.query(`insert into hubs (id, name, owner_user_id) values ('hub_2', 'Hub 2', 'user_b')`);

  // User A should see Hub 1 as owner
  const userAHubs = await listHubsForUser("user_a");
  assert.equal(userAHubs.length, 1);
  assert.equal(userAHubs[0]?.id, "hub_1");

  // User B should see Hub 2 as owner
  const userBHubs = await listHubsForUser("user_b");
  assert.equal(userBHubs.length, 1);
  assert.equal(userBHubs[0]?.id, "hub_2");

  // Assign user_c as hub_admin to Hub 1
  await pool.query(`insert into role_bindings (id, product_user_id, role, hub_id) values ('rb_1', 'user_c', 'hub_admin', 'hub_1')`);
  
  const userCHubs = await listHubsForUser("user_c");
  assert.equal(userCHubs.length, 1);
  assert.equal(userCHubs[0]?.id, "hub_1");

  // Assign user_global as global hub_admin (hub_id null)
  await pool.query(`insert into role_bindings (id, product_user_id, role, hub_id) values ('rb_2', 'user_global', 'hub_admin', null)`);
  
  const globalHubs = await listHubsForUser("user_global");
  assert.equal(globalHubs.length, 2);
  // Ordered by created_at asc usually
  assert.equal(globalHubs[0]?.id, "hub_1");
  assert.equal(globalHubs[1]?.id, "hub_2");
});
