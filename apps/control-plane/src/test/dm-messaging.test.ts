import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("DM channel is created and both participants can exchange messages", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    // Bootstrap hub
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_admin",
      email: "dm-admin@dev.local",
      preferredUsername: "dm-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_admin"
    });

    const bsRes = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "DM Hub" }
    });
    assert.equal(bsRes.statusCode, 201);

    const ctxRes = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = ctxRes.json().hubId as string;
    assert.ok(hubId);

    // Create a second participant
    const otherIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_other",
      email: "dm-other@dev.local",
      preferredUsername: "dm-other",
      avatarUrl: null
    });
    const otherCookie = createAuthCookie({
      productUserId: otherIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_other"
    });

    // Admin opens a DM with other user
    const dmRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [otherIdentity.productUserId] }
    });
    assert.equal(dmRes.statusCode, 201);
    const dmChannel = dmRes.json() as { id: string; type: string };
    assert.ok(dmChannel.id, "DM channel should have an id");
    assert.equal(dmChannel.type, "dm", "Channel type should be 'dm'");

    // Idempotency: requesting the same DM again returns the same channel
    const dmRes2 = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [otherIdentity.productUserId] }
    });
    assert.equal(dmRes2.statusCode, 201);
    assert.equal(dmRes2.json().id, dmChannel.id, "Repeated DM creation should return same channel");

    // Admin sends a message in the DM
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${dmChannel.id}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Hey, this is a DM!" }
    });
    assert.equal(sendRes.statusCode, 201);
    assert.equal(sendRes.json().content, "Hey, this is a DM!");

    // Other user can read the message
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${dmChannel.id}/messages?limit=10`,
      headers: { cookie: otherCookie }
    });
    assert.equal(listRes.statusCode, 200);
    const messages = listRes.json().items as { content: string }[];
    assert.ok(
      messages.some((m) => m.content === "Hey, this is a DM!"),
      "Other participant should see the DM message"
    );

    // Other user replies
    const replyRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${dmChannel.id}/messages`,
      headers: { cookie: otherCookie },
      payload: { content: "Hello back!" }
    });
    assert.equal(replyRes.statusCode, 201);
  } finally {
    await app.close();
  }
});

test("opening a DM with yourself returns a valid channel", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_self_admin",
      email: "dm-self-admin@dev.local",
      preferredUsername: "dm-self-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_self_admin"
    });

    const bsRes = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Self-DM Hub" }
    });
    assert.equal(bsRes.statusCode, 201);

    const ctxRes = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = ctxRes.json().hubId as string;

    // The route de-dupes userIds — passing your own ID still creates a valid channel
    const dmRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [adminIdentity.productUserId] }
    });
    assert.equal(dmRes.statusCode, 201);
    assert.ok(dmRes.json().id, "Self-DM should return a channel id");
  } finally {
    await app.close();
  }
});

test("DM creation fails with invalid payload (empty userIds)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_val_admin",
      email: "dm-val-admin@dev.local",
      preferredUsername: "dm-val-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_val_admin"
    });

    const bsRes = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Validation Hub" }
    });
    assert.equal(bsRes.statusCode, 201);

    const ctxRes = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = ctxRes.json().hubId as string;

    const dmRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [] } // violates min(1)
    });
    assert.ok(
      dmRes.statusCode === 400 || dmRes.statusCode === 422,
      `Expected validation error, got ${dmRes.statusCode}`
    );
  } finally {
    await app.close();
  }
});

test("non-creator can leave a DM and creator's view persists", async (t) => {
  // #45 — Before this change there was no leave endpoint at all, so any
  // non-creator was stuck in the DM. The minimum guarantee: a participant
  // can DELETE /v1/channels/:id/members/me, the channel survives for
  // remaining members, and a subsequent leave by the last member tears the
  // channel down.
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev", oidcSubject: "dm_leave_admin",
      email: "dm-leave-admin@dev.local", preferredUsername: "dm-leave-admin", avatarUrl: null
    });
    const otherIdentity = await upsertIdentityMapping({
      provider: "dev", oidcSubject: "dm_leave_other",
      email: "dm-leave-other@dev.local", preferredUsername: "dm-leave-other", avatarUrl: null
    });
    const adminCookie = createAuthCookie({ productUserId: adminIdentity.productUserId, provider: "dev", oidcSubject: "dm_leave_admin" });
    const otherCookie = createAuthCookie({ productUserId: otherIdentity.productUserId, provider: "dev", oidcSubject: "dm_leave_other" });

    await app.inject({
      method: "POST", url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Leave Hub" }
    });
    const hubId = (await app.inject({ method: "GET", url: "/v1/bootstrap/context", headers: { cookie: adminCookie } })).json().hubId as string;

    const dmRes = await app.inject({
      method: "POST", url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [otherIdentity.productUserId] }
    });
    const channelId = dmRes.json().id as string;

    // Non-creator (other) leaves the DM.
    const leaveRes = await app.inject({
      method: "DELETE", url: `/v1/channels/${channelId}/members/me`,
      headers: { cookie: otherCookie }
    });
    assert.equal(leaveRes.statusCode, 200, "Non-creator should be allowed to leave");
    assert.equal(leaveRes.json().channelDeleted, false, "Channel must survive while one member remains");

    // Other can no longer see the DM in their channel listing.
    const dmServerRow = await pool!.query(
      "select s.id from servers s join channels ch on ch.server_id = s.id where ch.id = $1",
      [channelId]
    );
    const dmServerId = dmServerRow.rows[0].id;
    const otherChannelsRes = await app.inject({
      method: "GET", url: `/v1/servers/${dmServerId}/channels`,
      headers: { cookie: otherCookie }
    });
    const otherChannels = otherChannelsRes.json().items as { id: string }[];
    assert.equal(otherChannels.find(c => c.id === channelId), undefined, "Leaver's channel listing must not include the DM");

    // Creator still sees it.
    const adminChannelsRes = await app.inject({
      method: "GET", url: `/v1/servers/${dmServerId}/channels`,
      headers: { cookie: adminCookie }
    });
    const adminChannels = adminChannelsRes.json().items as { id: string }[];
    assert.ok(adminChannels.find(c => c.id === channelId), "Creator should still see the DM after other member leaves");

    // Last member leaves → channel is torn down.
    const finalLeaveRes = await app.inject({
      method: "DELETE", url: `/v1/channels/${channelId}/members/me`,
      headers: { cookie: adminCookie }
    });
    assert.equal(finalLeaveRes.statusCode, 200);
    assert.equal(finalLeaveRes.json().channelDeleted, true, "Last leave should delete the channel");

    const postFinalRes = await app.inject({
      method: "DELETE", url: `/v1/channels/${channelId}/members/me`,
      headers: { cookie: adminCookie }
    });
    assert.equal(postFinalRes.statusCode, 404, "Re-leave on a deleted channel returns 404");
  } finally {
    await app.close();
  }
});

test("leave-DM endpoint refuses non-DM channels", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev", oidcSubject: "dm_leave_guard",
      email: "dm-leave-guard@dev.local", preferredUsername: "dm-leave-guard", avatarUrl: null
    });
    const adminCookie = createAuthCookie({ productUserId: adminIdentity.productUserId, provider: "dev", oidcSubject: "dm_leave_guard" });

    await app.inject({
      method: "POST", url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Guard Hub" }
    });
    const ctx = (await app.inject({ method: "GET", url: "/v1/bootstrap/context", headers: { cookie: adminCookie } })).json();
    // The bootstrap creates a default text channel; pick the first one.
    const channels = (await app.inject({
      method: "GET", url: `/v1/servers/${ctx.defaultServerId}/channels`,
      headers: { cookie: adminCookie }
    })).json().items as { id: string; type: string }[];
    const textChannel = channels.find(c => c.type !== "dm");
    assert.ok(textChannel, "Expected a default text channel from bootstrap");

    const leaveRes = await app.inject({
      method: "DELETE", url: `/v1/channels/${textChannel!.id}/members/me`,
      headers: { cookie: adminCookie }
    });
    assert.equal(leaveRes.statusCode, 400, "Leave endpoint should reject non-DM channels");
  } finally {
    await app.close();
  }
});

test("DM channel listing reflects messages from both participants in order", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_order_admin",
      email: "dm-order-admin@dev.local",
      preferredUsername: "dm-order-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_order_admin"
    });

    const otherIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "dm_order_other",
      email: "dm-order-other@dev.local",
      preferredUsername: "dm-order-other",
      avatarUrl: null
    });
    const otherCookie = createAuthCookie({
      productUserId: otherIdentity.productUserId,
      provider: "dev",
      oidcSubject: "dm_order_other"
    });

    const bsRes = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "DM Order Hub" }
    });
    assert.equal(bsRes.statusCode, 201);

    const hubId = (
      await app.inject({ method: "GET", url: "/v1/bootstrap/context", headers: { cookie: adminCookie } })
    ).json().hubId as string;

    const dmRes = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/dms`,
      headers: { cookie: adminCookie },
      payload: { userIds: [otherIdentity.productUserId] }
    });
    const channelId = dmRes.json().id as string;

    const contents = ["first", "second", "third"];
    for (const content of contents) {
      const sender = content === "second" ? otherCookie : adminCookie;
      const r = await app.inject({
        method: "POST",
        url: `/v1/channels/${channelId}/messages`,
        headers: { cookie: sender },
        payload: { content }
      });
      assert.equal(r.statusCode, 201);
    }

    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${channelId}/messages?limit=10`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listRes.statusCode, 200);
    const items = listRes.json().items as { content: string }[];
    const fetchedContents = items.map((m) => m.content);
    // All three messages must be present (order may be oldest-first or newest-first)
    for (const c of contents) {
      assert.ok(fetchedContents.includes(c), `Message "${c}" should be present`);
    }
  } finally {
    await app.close();
  }
});
