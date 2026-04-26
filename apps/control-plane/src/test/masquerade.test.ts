import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { withDb, pool } from "../db/client.js";
import { createSessionToken } from "../auth/session.js";
import { resetDb as sharedResetDb } from "./helpers/reset-db.js";

// Helper to create a real session cookie
function createAuthCookie(payload: any) {
  const token = createSessionToken({
    expiresAt: Date.now() + 3600000,
    ...payload
  });
  return `skerry_session=${token}`;
}

beforeEach(async () => {
  if (!pool) return;
  await sharedResetDb();
  // Masquerade tests assume the platform has finished bootstrap; the shared
  // resetDb nulls those fields so we restore them here.
  await pool.query(
    "update platform_settings set bootstrap_completed_at = now() where id = 'global'"
  );
});

test("Masquerade: admin masquerading as user with badge can see hidden channel", async (t) => {
  const app = await buildApp();

  const adminIdentity = {
    productUserId: "usr_admin",
    provider: "google",
    oidcSubject: "admin_sub"
  };

  await pool!.query("insert into identity_mappings (id, product_user_id, provider, oidc_subject) values ($1, $1, $2, $3)", [adminIdentity.productUserId, adminIdentity.provider, adminIdentity.oidcSubject]);
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_3', 'Badge Hub', $1)", [adminIdentity.productUserId]);
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_badge', 'hub_3', 'Badge Server', $1, $1)", [adminIdentity.productUserId]);

  // Create a hidden channel
  await pool!.query("insert into channels (id, server_id, name, type, visitor_access) values ('chn_hidden', 'srv_badge', 'top-secret', 'text', 'hidden')", []);

  // Create a badge and a rule that grants access to the hidden channel
  await pool!.query("insert into badges (id, hub_id, server_id, name, rank) values ('bdg_vip', 'hub_3', 'srv_badge', 'VIP', 10)", []);
  await pool!.query("insert into channel_badge_rules (id, channel_id, badge_id, access_level) values ('cbr_hidden_vip', 'chn_hidden', 'bdg_vip', 'chat')", []);

  // First verify: masquerading as visitor (no badge) -> channel is hidden
  const visitorCookie = createAuthCookie({
    ...adminIdentity,
    realProductUserId: adminIdentity.productUserId,
    masqueradeRole: "visitor"
  });

  const visitorResponse = await app.inject({
    method: "GET",
    url: "/v1/servers/srv_badge/channels",
    headers: { cookie: visitorCookie }
  });
  const visitorData = JSON.parse(visitorResponse.body);
  assert.ok(!visitorData.items.some((c: any) => c.id === 'chn_hidden'), "Channel should be hidden for visitor");

  // Second verify: masquerading as visitor WITH the VIP badge -> channel is visible
  const badgeCookie = createAuthCookie({
    ...adminIdentity,
    realProductUserId: adminIdentity.productUserId,
    masqueradeRole: "visitor",
    masqueradeBadgeIds: ["bdg_vip"]
  });

  const badgeResponse = await app.inject({
    method: "GET",
    url: "/v1/servers/srv_badge/channels",
    headers: { cookie: badgeCookie }
  });
  const badgeData = JSON.parse(badgeResponse.body);
  assert.ok(badgeData.items.some((c: any) => c.id === 'chn_hidden'), "Channel should be visible when masquerading with VIP badge");
});

test("Masquerade: admin masquerading as guest cannot see private channels", async (t) => {
  const app = await buildApp();

  const adminIdentity = {
    productUserId: "usr_admin",
    provider: "google",
    oidcSubject: "admin_sub"
  };

  await pool!.query("insert into identity_mappings (id, product_user_id, provider, oidc_subject) values ($1, $1, $2, $3)", [adminIdentity.productUserId, adminIdentity.provider, adminIdentity.oidcSubject]);

  // Create a Hub and Server
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', $1)", [adminIdentity.productUserId]);
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', $1, $1)", [adminIdentity.productUserId]);

  // Create a public and a private channel
  // visitor_access = 'chat' means visible to guests
  // visitor_access = 'hidden' means invisible to guests
  await pool!.query("insert into channels (id, server_id, name, type, visitor_access) values ('chn_pub', 'srv_1', 'public', 'text', 'chat')", []);
  await pool!.query("insert into channels (id, server_id, name, type, visitor_access) values ('chn_priv', 'srv_1', 'private', 'text', 'hidden')", []);

  const guestCookie = createAuthCookie({
    ...adminIdentity,
    realProductUserId: adminIdentity.productUserId,
    masqueradeRole: "visitor"
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/servers/srv_1/channels",
    headers: { cookie: guestCookie }
  });

  assert.equal(response.statusCode, 200, `Expected 200 but got ${response.statusCode}: ${response.body}`);
  const data = JSON.parse(response.body);
  const channelNames = data.items.map((c: any) => c.name);

  assert.ok(channelNames.includes("public"), "Should see public channel");
  assert.ok(!channelNames.includes("private"), "Should NOT see private channel when masquerading as guest");
});

test("Masquerade: admin masquerading as moderator of server A cannot manage server B", async (t) => {
  const app = await buildApp();

  const adminIdentity = {
    productUserId: "usr_admin",
    provider: "google",
    oidcSubject: "admin_sub"
  };

  await pool!.query("insert into identity_mappings (id, product_user_id, provider, oidc_subject) values ($1, $1, $2, $3)", [adminIdentity.productUserId, adminIdentity.provider, adminIdentity.oidcSubject]);
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_2', 'Test Hub', $1)", [adminIdentity.productUserId]);
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_a', 'hub_2', 'Server A', $1, $1)", [adminIdentity.productUserId]);
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_b', 'hub_2', 'Server B', $1, $1)", [adminIdentity.productUserId]);

  const modCookie = createAuthCookie({
    ...adminIdentity,
    realProductUserId: adminIdentity.productUserId,
    masqueradeRole: "space_moderator",
    masqueradeServerId: "srv_a"
  });

  // Try to GET Server B settings - should fail with 403 (Forbidden)
  const getBResponse = await app.inject({
    method: "GET",
    url: "/v1/servers/srv_b/settings",
    headers: { cookie: modCookie }
  });
  assert.equal(getBResponse.statusCode, 403, `Expected 403 but got ${getBResponse.statusCode}: ${getBResponse.body}`);

  // Check permissions list for Server A vs Server B
  const permsAResponse = await app.inject({
    method: "GET",
    url: "/v1/permissions?serverId=srv_a",
    headers: { cookie: modCookie }
  });
  assert.equal(permsAResponse.statusCode, 200, `Expected 200 for permsA but got ${permsAResponse.statusCode}`);
  const permsA = JSON.parse(permsAResponse.body).items;
  assert.ok(permsA.includes("moderation.kick"), "Should have moderator perms for Server A");

  const permsBResponse = await app.inject({
    method: "GET",
    url: "/v1/permissions?serverId=srv_b",
    headers: { cookie: modCookie }
  });
  assert.equal(permsBResponse.statusCode, 200, `Expected 200 for permsB but got ${permsBResponse.statusCode}`);
  const permsB = JSON.parse(permsBResponse.body).items;
  assert.ok(!permsB.includes("moderation.kick"), "Should NOT have moderator perms for Server B");

  // Verify that mutations are blocked by the read-only middleware with 403 masquerade_read_only
  const patchAResponse = await app.inject({
    method: "PATCH",
    url: "/v1/servers/srv_a",
    headers: { cookie: modCookie },
    payload: { name: "Renamed" }
  });
  assert.equal(patchAResponse.statusCode, 403);
  const patchABody = JSON.parse(patchAResponse.body);
  assert.equal(patchABody.code, "masquerade_read_only");
});
