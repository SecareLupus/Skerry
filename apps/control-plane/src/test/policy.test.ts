import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initDb, pool } from "../db/client.js";
import { bindingAllowsAction, bindingMatchesScope, grantRole, canManageServer, listAllowedActions } from "../services/policy-service.js";
import { resetDb } from "./helpers/reset-db.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("space moderator can ban users within scope", () => {
  const allowed = bindingAllowsAction(
    {
      role: "space_moderator",
      hub_id: null,
      server_id: "srv_1",
      channel_id: null
    },
    "moderation.ban"
  );

  assert.equal(allowed, true);
});

test("cross-scope moderation is rejected", () => {
  const matches = bindingMatchesScope(
    {
      role: "space_moderator",
      hub_id: null,
      server_id: "srv_primary",
      channel_id: null
    },
    {
      serverId: "srv_other"
    }
  );

  assert.equal(matches, false);
});

test("grantRole and canManageServer integration", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  // Create a hub and a server
  await pool.query(`insert into hubs (id, name, owner_user_id) values ('hub_1', 'Hub 1', 'owner_1')`);
  await pool.query(`insert into servers (id, hub_id, owner_user_id, created_by_user_id, name) values ('srv_1', 'hub_1', 'owner_1', 'owner_1', 'Server 1')`);

  // owner_1 can manage server because they are the owner
  const isOwnerManaged = await canManageServer({ productUserId: "owner_1", serverId: "srv_1" });
  assert.equal(isOwnerManaged, true);

  // user_2 cannot manage
  const isUser2Managed = await canManageServer({ productUserId: "user_2", serverId: "srv_1" });
  assert.equal(isUser2Managed, false);

  // owner_1 grants space_moderator to user_2
  await grantRole({
    actorUserId: "owner_1",
    productUserId: "user_2",
    role: "space_moderator",
    serverId: "srv_1"
  });

  // user_2 can now ban users
  const allowedUser2 = await listAllowedActions({ productUserId: "user_2", scope: { serverId: "srv_1" } });
  assert.ok(allowedUser2.includes("moderation.ban"));

  // Check audit log
  const auditLogs = await pool.query("select * from role_assignment_audit_logs where target_user_id = 'user_2'");
  assert.equal(auditLogs.rows.length, 1);
  assert.equal(auditLogs.rows[0].role, "space_moderator");
  assert.equal(auditLogs.rows[0].outcome, "granted");
});

test("hub-owned server (null owner_user_id): hub admin manages, random user does not", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  // Hub with explicit owner; one server with NULL owner (hub-owned).
  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p3', 'P3 Hub', 'owner_p3')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_huboned', 'hub_p3', 'Hub-Owned', 'default', 'owner_p3', null)`
  );

  // The hub owner (synthesized as hub_owner via getEffectiveRoleBindings)
  // can manage the hub-owned server.
  const ownerCanManage = await canManageServer({
    productUserId: "owner_p3",
    serverId: "srv_huboned"
  });
  assert.equal(ownerCanManage, true, "hub owner should manage hub-owned server");

  // A random unrelated user cannot.
  const randomCanManage = await canManageServer({
    productUserId: "rando_p3",
    serverId: "srv_huboned"
  });
  assert.equal(randomCanManage, false, "rando should not manage hub-owned server");

  // A user with hub_admin binding can.
  await pool.query(
    `insert into role_bindings (id, product_user_id, role, hub_id)
     values ('rb_p3_admin', 'admin_p3', 'hub_admin', 'hub_p3')`
  );
  const adminCanManage = await canManageServer({
    productUserId: "admin_p3",
    serverId: "srv_huboned"
  });
  assert.equal(adminCanManage, true, "hub_admin should manage hub-owned server");
});

test("hub-owned server (null owner): no synthetic space_owner binding for any user", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p3b', 'P3b Hub', 'owner_p3b')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_huboned_b', 'hub_p3b', 'Hub-Owned B', 'default', 'owner_p3b', null)`
  );

  // listAllowedActions for an unrelated user with no role bindings: should be empty.
  const allowed = await listAllowedActions({
    productUserId: "rando_p3b",
    scope: { hubId: "hub_p3b", serverId: "srv_huboned_b" }
  });
  // Visitor relation has no privileged actions in the matrix.
  assert.equal(
    allowed.includes("moderation.ban"),
    false,
    "random user must not get space_owner-derived actions on hub-owned server"
  );
});

test("space_moderator can moderate but cannot edit settings, manage roles, or manage rooms", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const { canModerateServer, canEditServerSettings, canManageServerRoles, canManageRooms } =
    await import("../services/policy-service.js");

  // Hub + server, hub-owned (null owner) so no owner-equivalent shortcut applies.
  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2a', 'P2a Hub', 'owner_p2a')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2a', 'hub_p2a', 'P2a Space', 'default', 'owner_p2a', null)`
  );

  // Grant a user `space_moderator` on the server.
  await pool.query(
    `insert into role_bindings (id, product_user_id, role, hub_id, server_id)
     values ('rb_p2a_mod', 'mod_p2a', 'space_moderator', 'hub_p2a', 'srv_p2a')`
  );

  const input = { productUserId: "mod_p2a", serverId: "srv_p2a" };

  assert.equal(await canModerateServer(input), true, "moderator should be allowed to moderate");
  assert.equal(await canEditServerSettings(input), false, "moderator should NOT be allowed to edit settings");
  assert.equal(await canManageServerRoles(input), false, "moderator should NOT be allowed to manage roles");
  assert.equal(await canManageRooms(input), false, "moderator should NOT be allowed to manage rooms");
});

test("space_admin satisfies all four server-capability gates", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const { canModerateServer, canEditServerSettings, canManageServerRoles, canManageRooms } =
    await import("../services/policy-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2b', 'P2b Hub', 'owner_p2b')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2b', 'hub_p2b', 'P2b Space', 'default', 'owner_p2b', null)`
  );

  await pool.query(
    `insert into role_bindings (id, product_user_id, role, hub_id, server_id)
     values ('rb_p2b_admin', 'admin_p2b', 'space_admin', 'hub_p2b', 'srv_p2b')`
  );

  const input = { productUserId: "admin_p2b", serverId: "srv_p2b" };
  assert.equal(await canModerateServer(input), true);
  assert.equal(await canEditServerSettings(input), true);
  assert.equal(await canManageServerRoles(input), true);
  assert.equal(await canManageRooms(input), true);
});

test("plain hub member fails every server-capability gate", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const { canModerateServer, canEditServerSettings, canManageServerRoles, canManageRooms } =
    await import("../services/policy-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2c', 'P2c Hub', 'owner_p2c')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2c', 'hub_p2c', 'P2c Space', 'default', 'owner_p2c', null)`
  );
  // No role bindings; just hub membership.
  await pool.query("insert into hub_members (hub_id, product_user_id) values ('hub_p2c', 'member_p2c')");

  const input = { productUserId: "member_p2c", serverId: "srv_p2c" };
  assert.equal(await canModerateServer(input), false);
  assert.equal(await canEditServerSettings(input), false);
  assert.equal(await canManageServerRoles(input), false);
  assert.equal(await canManageRooms(input), false);
});
