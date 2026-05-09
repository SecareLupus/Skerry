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

test("P2.cleanup: seedDefaultSpaceAccessRules produces all 6 tier rows for a new server", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { seedDefaultSpaceAccessRules } = await import("../services/provisioning-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2b_a', 'P2b Hub A', 'owner_p2b_a')");
  await pool.query(
    `insert into servers
       (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2b_a', 'hub_p2b_a', 'A', 'default', 'owner_p2b_a', null)`
  );
  await seedDefaultSpaceAccessRules(pool, 'srv_p2b_a');

  const rules = await pool.query<{ audience_tier: string; level: string }>(
    "select audience_tier, level from space_access_rules where server_id = $1 order by audience_tier",
    ['srv_p2b_a']
  );
  const byTier = Object.fromEntries(rules.rows.map(r => [r.audience_tier, r.level]));
  assert.equal(byTier.visitor, 'hidden');
  assert.equal(byTier.hub_member, 'chat');
  assert.equal(byTier.space_member, 'chat');
  assert.equal(byTier.hub_admin, 'chat');
  assert.equal(byTier.space_admin, 'chat');
  assert.equal(byTier.space_moderator, 'chat');
});

// (The "legacy column update propagates to rule via trigger" test from
// the P2.b PR is intentionally removed here — P2.cleanup dropped both
// the columns and the trigger. The seed-test above covers the
// equivalent positive path.)

test("P2.b: channel rule overrides server rule for same tier (cascade)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { isActionAllowed } = await import("../services/policy-service.js");
  const { seedDefaultSpaceAccessRules, seedDefaultChannelAccessRules } =
    await import("../services/provisioning-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2b_c', 'P2b Hub C', 'owner_p2b_c')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2b_c', 'hub_p2b_c', 'C', 'default', 'owner_p2b_c', null)`
  );
  await seedDefaultSpaceAccessRules(pool, 'srv_p2b_c');
  // Server says visitor=chat (override the default of hidden).
  await pool.query(
    `update space_access_rules set level = 'chat' where server_id = 'srv_p2b_c' and audience_tier = 'visitor'`
  );

  await pool.query(
    `insert into channels (id, server_id, name, type) values ('chn_p2b_c', 'srv_p2b_c', 'general', 'text')`
  );
  await seedDefaultChannelAccessRules(pool, 'chn_p2b_c', 'hidden');
  // Channel keeps visitor=hidden (default). Verify the channel-level
  // rule overrides the server's chat for visitors.

  const allowed = await isActionAllowed({
    productUserId: "rando_p2b_c",
    action: "channel.message.read",
    scope: { hubId: 'hub_p2b_c', serverId: 'srv_p2b_c', channelId: 'chn_p2b_c' }
  });
  assert.equal(allowed, false, "channel-level visitor=hidden should override server-level visitor=chat");
});

test("P2.b: space_admin tier resolves to admin rule level (not falling through to space_member)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { isActionAllowed } = await import("../services/policy-service.js");
  const { seedDefaultSpaceAccessRules, seedDefaultChannelAccessRules } =
    await import("../services/provisioning-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2b_d', 'P2b Hub D', 'owner_p2b_d')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2b_d', 'hub_p2b_d', 'D', 'default', 'owner_p2b_d', null)`
  );
  await seedDefaultSpaceAccessRules(pool, 'srv_p2b_d');
  // Server denies everyone but hub_admin / space_admin / hub_owner.
  await pool.query(
    `update space_access_rules set level = 'hidden'
       where server_id = 'srv_p2b_d' and audience_tier in ('visitor', 'hub_member', 'space_member')`
  );

  await pool.query(
    `insert into channels (id, server_id, name, type) values ('chn_p2b_d', 'srv_p2b_d', 'general', 'text')`
  );
  await seedDefaultChannelAccessRules(pool, 'chn_p2b_d', 'hidden');
  // Channel is also locked down for member/visitor tiers.
  await pool.query(
    `update channel_access_rules set level = 'hidden'
       where channel_id = 'chn_p2b_d' and audience_tier in ('visitor', 'hub_member', 'space_member')`
  );

  // Grant a user space_admin.
  await pool.query(
    `insert into role_bindings (id, product_user_id, role, hub_id, server_id)
     values ('rb_p2b_d', 'admin_p2b_d', 'space_admin', 'hub_p2b_d', 'srv_p2b_d')`
  );

  const allowed = await isActionAllowed({
    productUserId: "admin_p2b_d",
    action: "channel.message.read",
    scope: { hubId: 'hub_p2b_d', serverId: 'srv_p2b_d', channelId: 'chn_p2b_d' }
  });
  assert.equal(allowed, true, "space_admin resolves to space_admin tier rule, which is 'chat'");
});

test("P2.b: space_moderator tier resolves to moderator rule level when set 'hidden'", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { isActionAllowed } = await import("../services/policy-service.js");
  const { seedDefaultSpaceAccessRules, seedDefaultChannelAccessRules } =
    await import("../services/provisioning-service.js");

  await pool.query("insert into hubs (id, name, owner_user_id) values ('hub_p2b_e', 'P2b Hub E', 'owner_p2b_e')");
  await pool.query(
    `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
     values ('srv_p2b_e', 'hub_p2b_e', 'E', 'default', 'owner_p2b_e', null)`
  );
  await seedDefaultSpaceAccessRules(pool, 'srv_p2b_e');

  await pool.query(
    `insert into channels (id, server_id, name, type) values ('chn_p2b_e', 'srv_p2b_e', 'private', 'text')`
  );
  await seedDefaultChannelAccessRules(pool, 'chn_p2b_e', 'chat');
  // Force the moderator tier off for this channel even though everyone
  // else can read.
  await pool.query(
    `update channel_access_rules set level = 'hidden'
       where channel_id = 'chn_p2b_e' and audience_tier = 'space_moderator'`
  );

  await pool.query(
    `insert into role_bindings (id, product_user_id, role, hub_id, server_id)
     values ('rb_p2b_e', 'mod_p2b_e', 'space_moderator', 'hub_p2b_e', 'srv_p2b_e')`
  );

  const allowed = await isActionAllowed({
    productUserId: "mod_p2b_e",
    action: "channel.message.read",
    scope: { hubId: 'hub_p2b_e', serverId: 'srv_p2b_e', channelId: 'chn_p2b_e' }
  });
  assert.equal(allowed, false, "moderator tier rule of 'hidden' should deny read even though space_member='chat'");
});

test("Issue #38: PATCH /v1/servers/:id/settings persists all six audience-tier access levels", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { config } = await import("../config.js");
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const { buildApp } = await import("../app.js");
  const { bootstrap: bootstrapHub } = await import("./helpers/bootstrap.js");

  const app = await buildApp();
  try {
    const { adminCookie, defaultServerId } = await bootstrapHub(app, { prefix: "issue38" });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/servers/${defaultServerId}/settings`,
      headers: { cookie: adminCookie },
      payload: {
        visitorAccess: "read",
        hubMemberAccess: "locked",
        spaceMemberAccess: "read",
        spaceModeratorAccess: "read",
        spaceAdminAccess: "chat",
        hubAdminAccess: "chat"
      }
    });
    assert.equal(patchRes.statusCode, 204, `Expected 204 but got ${patchRes.statusCode}: ${patchRes.body}`);

    const rules = await pool.query<{ audience_tier: string; level: string }>(
      "select audience_tier, level from space_access_rules where server_id = $1",
      [defaultServerId]
    );
    const byTier = Object.fromEntries(rules.rows.map(r => [r.audience_tier, r.level]));
    assert.equal(byTier.visitor, 'read', "visitorAccess should persist");
    assert.equal(byTier.hub_member, 'locked', "hubMemberAccess should persist");
    assert.equal(byTier.space_member, 'read', "spaceMemberAccess should persist");
    assert.equal(byTier.space_moderator, 'read', "spaceModeratorAccess should persist");
    assert.equal(byTier.space_admin, 'chat', "spaceAdminAccess should persist");
    assert.equal(byTier.hub_admin, 'chat', "hubAdminAccess should persist");

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/servers/${defaultServerId}/settings`,
      headers: { cookie: adminCookie }
    });
    assert.equal(getRes.statusCode, 200);
    const settings = getRes.json() as Record<string, string>;
    assert.equal(settings.visitorAccess, 'read');
    assert.equal(settings.hubMemberAccess, 'locked');
    assert.equal(settings.spaceMemberAccess, 'read');
    assert.equal(settings.spaceModeratorAccess, 'read');
    assert.equal(settings.spaceAdminAccess, 'chat');
    assert.equal(settings.hubAdminAccess, 'chat');
  } finally {
    await app.close();
  }
});

test("Issue #34: onboarding accepts display names with spaces", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { config } = await import("../config.js");
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const { buildApp } = await import("../app.js");
  const { upsertIdentityMapping } = await import("../services/identity-service.js");
  const { createAuthCookie } = await import("./helpers/auth.js");
  const { bootstrap: bootstrapHub } = await import("./helpers/bootstrap.js");

  const app = await buildApp();
  try {
    await bootstrapHub(app, { prefix: "issue34" });

    // A second user signs up; they're prompted to choose a display name.
    const newUser = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "issue34_newcomer",
      email: "issue34-newcomer@dev.local",
      preferredUsername: null,
      avatarUrl: null
    });
    const cookie = createAuthCookie({
      productUserId: newUser.productUserId,
      provider: "dev",
      oidcSubject: "issue34_newcomer"
    });

    const okRes = await app.inject({
      method: "POST",
      url: "/auth/onboarding/username",
      headers: { cookie },
      payload: { username: "Alice Smith" }
    });
    assert.equal(okRes.statusCode, 204, `Expected 204 but got ${okRes.statusCode}: ${okRes.body}`);

    const stored = await pool.query<{ preferred_username: string | null }>(
      "select preferred_username from identity_mappings where product_user_id = $1 limit 1",
      [newUser.productUserId]
    );
    assert.equal(stored.rows[0]?.preferred_username, "Alice Smith");
  } finally {
    await app.close();
  }
});

test("Issue #34: onboarding rejects whitespace-only display names", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const { config } = await import("../config.js");
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const { buildApp } = await import("../app.js");
  const { upsertIdentityMapping } = await import("../services/identity-service.js");
  const { createAuthCookie } = await import("./helpers/auth.js");
  const { bootstrap: bootstrapHub } = await import("./helpers/bootstrap.js");

  const app = await buildApp();
  try {
    await bootstrapHub(app, { prefix: "issue34b" });

    const newUser = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "issue34b_newcomer",
      email: "issue34b-newcomer@dev.local",
      preferredUsername: null,
      avatarUrl: null
    });
    const cookie = createAuthCookie({
      productUserId: newUser.productUserId,
      provider: "dev",
      oidcSubject: "issue34b_newcomer"
    });

    // Three spaces — passes min(3) and the regex, but trims to empty.
    const res = await app.inject({
      method: "POST",
      url: "/auth/onboarding/username",
      headers: { cookie },
      payload: { username: "   " }
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as { code?: string };
    assert.equal(body.code, "display_name_too_short");
  } finally {
    await app.close();
  }
});
