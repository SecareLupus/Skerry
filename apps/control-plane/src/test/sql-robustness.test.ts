import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/client.js";
import { listServers } from "../services/chat/server-service.js";
import { listChannels } from "../services/chat/channel-service.js";
import { resetDb } from "./helpers/reset-db.js";

beforeEach(async () => {
  if (pool) await resetDb();
});

test("SQL Robustness: listServers handles undefined hubId and empty badgeIds", async (t) => {
  // Call with hubId = undefined and no masq (badgeIds will be null)
  // This was the trigger for "$2 not found/ambiguous"
  await listServers("usr_1", undefined, undefined);

  // Call with masquerade and empty badgeIds
  // This tests the "badge_id = any($4::text[])" with empty array
  await listServers("usr_1", undefined, {
    productUserId: "usr_1",
    isMasquerading: true,
    masqueradeRole: "space_admin",
    masqueradeBadgeIds: []
  } as any);

  assert.ok(true, "Should not have thrown");
});

test("SQL Robustness: listChannels handles empty badgeIds", async (t) => {
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', 'usr_1')");
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', 'usr_1', 'usr_1')");

  await listChannels("srv_1", "usr_1", {
    productUserId: "usr_1",
    isMasquerading: true,
    masqueradeRole: "space_admin",
    masqueradeBadgeIds: []
  } as any);

  assert.ok(true, "Should not have thrown");
});
