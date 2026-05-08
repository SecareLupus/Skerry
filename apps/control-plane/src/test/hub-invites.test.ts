import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { createBadge } from "../services/badge-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";
import { bootstrap as bootstrapHub } from "./helpers/bootstrap.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

const bootstrap = (app: Awaited<ReturnType<typeof buildApp>>) =>
  bootstrapHub(app, { prefix: "inv", hubName: "Hub Invite Hub" });

test("hub invite with defaultRole + defaultServerId applies role binding and server membership", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId, defaultServerId } = await bootstrap(app);

    const createRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: {
        defaultRole: "space_moderator",
        defaultServerId
      }
    });
    assert.equal(createRes.statusCode, 201);
    const invite = createRes.json() as {
      id: string;
      defaultRole: string | null;
      defaultServerId: string | null;
    };
    assert.equal(invite.defaultRole, "space_moderator");
    assert.equal(invite.defaultServerId, defaultServerId);

    const newUserIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "invite_default_joiner",
      email: "invite-default-joiner@dev.local",
      preferredUsername: "invite-default-joiner",
      avatarUrl: null
    });
    const newUserCookie = createAuthCookie({
      productUserId: newUserIdentity.productUserId,
      provider: "dev",
      oidcSubject: "invite_default_joiner"
    });

    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.id}/join`,
      headers: { cookie: newUserCookie }
    });
    assert.ok(
      joinRes.statusCode === 200 || joinRes.statusCode === 204,
      `Expected 200 or 204, got ${joinRes.statusCode}`
    );

    const rb = await pool.query<{ role: string; server_id: string | null }>(
      `select role, server_id from role_bindings
       where product_user_id = $1 and hub_id = $2`,
      [newUserIdentity.productUserId, hubId]
    );
    assert.equal(rb.rows.length, 1);
    assert.equal(rb.rows[0]?.role, "space_moderator");
    assert.equal(rb.rows[0]?.server_id, defaultServerId);

    const sm = await pool.query<{ count: string }>(
      `select count(*)::text as count from server_members
       where server_id = $1 and product_user_id = $2`,
      [defaultServerId, newUserIdentity.productUserId]
    );
    assert.equal(sm.rows[0]?.count, "1");
  } finally {
    await app.close();
  }
});

test("hub invite rejects space_moderator without defaultServerId", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId } = await bootstrap(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: { defaultRole: "space_moderator" }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "invite_role_requires_server");
  } finally {
    await app.close();
  }
});

test("hub invite can be created, looked up, and used to join by a new member", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, hubId } = await bootstrap(app);

    // Create invite
    const createInviteRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: { maxUses: 5 }
    });
    assert.equal(createInviteRes.statusCode, 201);
    const invite = createInviteRes.json() as { id: string; hubId: string };
    assert.ok(invite.id);
    assert.equal(invite.hubId, hubId);

    // Public invite lookup (no auth required)
    const lookupRes = await app.inject({
      method: "GET",
      url: `/v1/invites/${invite.id}`
    });
    assert.equal(lookupRes.statusCode, 200);
    assert.equal(lookupRes.json().id, invite.id);

    // New user joins via invite
    const newUserIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "invite_joiner",
      email: "invite-joiner@dev.local",
      preferredUsername: "invite-joiner",
      avatarUrl: null
    });
    const newUserCookie = createAuthCookie({
      productUserId: newUserIdentity.productUserId,
      provider: "dev",
      oidcSubject: "invite_joiner"
    });

    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.id}/join`,
      headers: { cookie: newUserCookie }
    });
    assert.ok(
      joinRes.statusCode === 200 || joinRes.statusCode === 204,
      `Expected 200 or 204, got ${joinRes.statusCode}`
    );
  } finally {
    await app.close();
  }
});

test("hub invite list excludes revoked invites; revoke 404s the public lookup but preserves redeemed bindings", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId } = await bootstrap(app);

    const createRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: {}
    });
    assert.equal(createRes.statusCode, 201);
    const invite = createRes.json() as { id: string };

    // Redeem first so we can verify the role binding survives revoke.
    const redeemer = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "redeem_then_revoke",
      email: "redeem-then-revoke@dev.local",
      preferredUsername: "redeem-then-revoke",
      avatarUrl: null
    });
    const redeemerCookie = createAuthCookie({
      productUserId: redeemer.productUserId,
      provider: "dev",
      oidcSubject: "redeem_then_revoke"
    });
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.id}/join`,
      headers: { cookie: redeemerCookie }
    });
    assert.ok(joinRes.statusCode === 200 || joinRes.statusCode === 204);

    // List shows the active invite.
    const listBefore = await app.inject({
      method: "GET",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listBefore.statusCode, 200);
    const listBeforeJson = listBefore.json() as { items: Array<{ id: string }> };
    assert.ok(listBeforeJson.items.some((i) => i.id === invite.id));

    // Revoke.
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/hubs/${hubId}/invites/${invite.id}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(revokeRes.statusCode, 204);

    // List no longer includes the revoked invite.
    const listAfter = await app.inject({
      method: "GET",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listAfter.statusCode, 200);
    const listAfterJson = listAfter.json() as { items: Array<{ id: string }> };
    assert.ok(!listAfterJson.items.some((i) => i.id === invite.id));

    // Public lookup 404s.
    const publicRes = await app.inject({
      method: "GET",
      url: `/v1/invites/${invite.id}`
    });
    assert.equal(publicRes.statusCode, 404);

    // Redeeming the revoked link 404s.
    const lateUser = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "late_redeemer",
      email: "late-redeemer@dev.local",
      preferredUsername: "late-redeemer",
      avatarUrl: null
    });
    const lateCookie = createAuthCookie({
      productUserId: lateUser.productUserId,
      provider: "dev",
      oidcSubject: "late_redeemer"
    });
    const lateRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.id}/join`,
      headers: { cookie: lateCookie }
    });
    assert.notEqual(lateRes.statusCode, 200);
    assert.notEqual(lateRes.statusCode, 204);

    // Original redeemer kept their hub membership. (P1: a redemption with
    // no defaultRole writes hub_members, not role_bindings.)
    const hm = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from hub_members
        where product_user_id = $1 and hub_id = $2`,
      [redeemer.productUserId, hubId]
    );
    assert.equal(hm.rows[0]?.count, "1");
  } finally {
    await app.close();
  }
});

test("redeeming the same invite twice is idempotent (one role binding, one audit log)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId, defaultServerId } = await bootstrap(app);

    // Use a space_moderator invite so we exercise BOTH the hub_members
    // path and the role_bindings path. A no-defaultRole invite would
    // only test hub_members idempotency since P1 (no role binding is
    // written for plain "member" redemptions).
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: { defaultRole: "space_moderator", defaultServerId }
    });
    const invite = createRes.json() as { id: string };

    const user = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "double_redeemer",
      email: "double-redeemer@dev.local",
      preferredUsername: "double-redeemer",
      avatarUrl: null
    });
    const cookie = createAuthCookie({
      productUserId: user.productUserId,
      provider: "dev",
      oidcSubject: "double_redeemer"
    });

    for (let i = 0; i < 2; i++) {
      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/invites/${invite.id}/join`,
        headers: { cookie }
      });
      assert.ok(
        joinRes.statusCode === 200 || joinRes.statusCode === 204,
        `Iteration ${i}: expected 200/204, got ${joinRes.statusCode}`
      );
    }

    const hm = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from hub_members
        where product_user_id = $1 and hub_id = $2`,
      [user.productUserId, hubId]
    );
    assert.equal(hm.rows[0]?.count, "1", "expected exactly one hub_members row after double redemption");

    const rb = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from role_bindings
        where product_user_id = $1 and hub_id = $2 and role = 'space_moderator'`,
      [user.productUserId, hubId]
    );
    assert.equal(rb.rows[0]?.count, "1", "expected exactly one role binding after double redemption");

    const audit = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from role_assignment_audit_logs
        where target_user_id = $1 and hub_id = $2 and role = 'space_moderator'`,
      [user.productUserId, hubId]
    );
    assert.equal(audit.rows[0]?.count, "1", "expected exactly one audit log after double redemption");
  } finally {
    await app.close();
  }
});

test("hub invite with default badges grants user_badges on redemption", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId, defaultServerId } = await bootstrap(app);

    const badge = await createBadge({
      hubId,
      serverId: defaultServerId,
      name: "Founders"
    });

    const createRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: {
        defaultServerId,
        defaultBadgeIds: [badge.id]
      }
    });
    assert.equal(createRes.statusCode, 201);
    const invite = createRes.json() as { id: string; defaultBadgeIds: string[] };
    assert.deepEqual(invite.defaultBadgeIds, [badge.id]);

    const user = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "badge_redeemer",
      email: "badge-redeemer@dev.local",
      preferredUsername: "badge-redeemer",
      avatarUrl: null
    });
    const cookie = createAuthCookie({
      productUserId: user.productUserId,
      provider: "dev",
      oidcSubject: "badge_redeemer"
    });
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.id}/join`,
      headers: { cookie }
    });
    assert.ok(joinRes.statusCode === 200 || joinRes.statusCode === 204);

    const ub = await pool.query<{ badge_id: string }>(
      "select badge_id from user_badges where product_user_id = $1",
      [user.productUserId]
    );
    assert.deepEqual(
      ub.rows.map((r) => r.badge_id),
      [badge.id]
    );
  } finally {
    await app.close();
  }
});

test("hub invite rejects defaultBadgeIds from a different hub", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();
  try {
    const { adminCookie, hubId } = await bootstrap(app);

    // Create a badge under a fabricated alien hub by inserting raw rows.
    // Bootstrap-admin only initializes one hub, so we can't easily spawn a
    // second through the API; the raw insert is enough to exercise the
    // cross-hub guard.
    const alienHubRes = await pool.query<{ id: string }>(
      "insert into hubs (id, name, owner_user_id) values ($1, $2, $3) returning id",
      [`hub_alien_${Date.now()}`, "Alien Hub", "usr_alien"]
    );
    const alienHubId = alienHubRes.rows[0]!.id;
    const alienServerRes = await pool.query<{ id: string }>(
      `insert into servers (id, hub_id, name, type, created_by_user_id, owner_user_id)
       values ($1, $2, $3, 'space', $4, $4) returning id`,
      [`srv_alien_${Date.now()}`, alienHubId, "Alien Space", "usr_alien"]
    );
    const alienServerId = alienServerRes.rows[0]!.id;
    const alienBadge = await createBadge({
      hubId: alienHubId,
      serverId: alienServerId,
      name: "Alien"
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/invites`,
      headers: { cookie: adminCookie },
      payload: { defaultBadgeIds: [alienBadge.id] }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "invite_invalid_default_badge");
  } finally {
    await app.close();
  }
});
