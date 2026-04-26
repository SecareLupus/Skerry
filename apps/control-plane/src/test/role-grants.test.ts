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

test("role grants are scope-gated and prevent escalation", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "deleg_admin",
      email: "deleg-admin@dev.local",
      preferredUsername: "deleg-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "deleg_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Delegation Policy Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const memberIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "deleg_member",
      email: "deleg-user@dev.local",
      preferredUsername: "deleg-user",
      avatarUrl: null
    });
    const memberCookie = createAuthCookie({
      productUserId: memberIdentity.productUserId,
      provider: "dev",
      oidcSubject: "deleg_member"
    });

    const unauthorizedGrant = await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: memberCookie },
      payload: {
        productUserId: memberIdentity.productUserId,
        role: "space_moderator",
        serverId: bootstrapBody.defaultServerId
      }
    });
    assert.equal(unauthorizedGrant.statusCode, 403);
    assert.equal(unauthorizedGrant.json().code, "forbidden_scope");

    const grantAsAdmin = await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: adminCookie },
      payload: {
        productUserId: memberIdentity.productUserId,
        role: "space_admin",
        serverId: bootstrapBody.defaultServerId
      }
    });
    assert.equal(grantAsAdmin.statusCode, 204);

    const outsiderIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "deleg_outsider",
      email: "deleg-outsider@dev.local",
      preferredUsername: "deleg-outsider",
      avatarUrl: null
    });

    const escalationAttempt = await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: memberCookie },
      payload: {
        productUserId: outsiderIdentity.productUserId,
        role: "hub_admin",
        serverId: bootstrapBody.defaultServerId
      }
    });
    assert.equal(escalationAttempt.statusCode, 409);
    assert.equal(escalationAttempt.json().code, "role_escalation_denied");
  } finally {
    await app.close();
  }
});

test("space owner assignment lifecycle grants and revokes scoped management", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "space_owner",
      email: "space-owner@dev.local",
      preferredUsername: "space-owner",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_owner"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Space Delegation Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const delegatedIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "space_delegate",
      email: "space-delegate@dev.local",
      preferredUsername: "space-delegate",
      avatarUrl: null
    });
    const delegatedCookie = createAuthCookie({
      productUserId: delegatedIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_delegate"
    });

    const assignResponse = await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: {
        productUserId: delegatedIdentity.productUserId
      }
    });
    assert.equal(assignResponse.statusCode, 201);
    const assignmentId = assignResponse.json().id as string;
    assert.ok(assignmentId);

    const delegatedCreateChannel = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: delegatedCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "delegate-room",
        type: "text"
      }
    });
    assert.equal(delegatedCreateChannel.statusCode, 201);

    const listAssignments = await app.inject({
      method: "GET",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listAssignments.statusCode, 200);
    assert.ok(listAssignments.json().items.some((item: { id: string }) => item.id === assignmentId));

    const bootstrapContext = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = bootstrapContext.json().hubId as string;

    const auditEvents = await app.inject({
      method: "GET",
      url: `/v1/hubs/${hubId}/delegation/audit-events`,
      headers: { cookie: adminCookie }
    });
    assert.equal(auditEvents.statusCode, 200);
    assert.ok(
      auditEvents.json().items.some((item: { actionType: string }) => item.actionType === "space_owner_assigned")
    );

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/v1/delegation/space-owners/${assignmentId}?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(revokeResponse.statusCode, 204);

    const delegatedCreateAfterRevoke = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: delegatedCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "should-fail",
        type: "text"
      }
    });
    assert.equal(delegatedCreateAfterRevoke.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("expired space owner assignments no longer grant management scope", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "exp_admin",
      email: "exp-admin@dev.local",
      preferredUsername: "exp-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "exp_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Expiry Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const delegatedIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "exp_delegate",
      email: "exp-delegate@dev.local",
      preferredUsername: "exp-delegate",
      avatarUrl: null
    });
    const delegatedCookie = createAuthCookie({
      productUserId: delegatedIdentity.productUserId,
      provider: "dev",
      oidcSubject: "exp_delegate"
    });

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const assignmentResponse = await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: {
        productUserId: delegatedIdentity.productUserId,
        expiresAt: expiredAt
      }
    });
    assert.equal(assignmentResponse.statusCode, 201);

    const delegatedCreateChannel = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: delegatedCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "expired-should-fail",
        type: "text"
      }
    });
    assert.equal(delegatedCreateChannel.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("space ownership transfer updates effective management owner", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const ownerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "owner_transfer_from",
      email: "owner-transfer-from@dev.local",
      preferredUsername: "owner-transfer-from",
      avatarUrl: null
    });
    const ownerCookie = createAuthCookie({
      productUserId: ownerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "owner_transfer_from"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: ownerCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Owner Transfer Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const targetOwnerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "owner_transfer_to",
      email: "owner-transfer-to@dev.local",
      preferredUsername: "owner-transfer-to",
      avatarUrl: null
    });
    const targetOwnerCookie = createAuthCookie({
      productUserId: targetOwnerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "owner_transfer_to"
    });

    const transferResponse = await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/ownership/transfer`,
      headers: { cookie: ownerCookie },
      payload: {
        newOwnerUserId: targetOwnerIdentity.productUserId
      }
    });
    assert.equal(transferResponse.statusCode, 200);
    assert.equal(transferResponse.json().newOwnerUserId, targetOwnerIdentity.productUserId);

    const newOwnerCreateChannel = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: targetOwnerCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "owner-room",
        type: "text"
      }
    });
    assert.equal(newOwnerCreateChannel.statusCode, 201);
  } finally {
    await app.close();
  }
});

test("read-state mention markers and voice presence flows work for scoped users", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "flow_admin",
      email: "flow-admin@dev.local",
      preferredUsername: "flow-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "flow_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Flow Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string; defaultChannelId: string };

    const voiceChannelResponse = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: adminCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "voice-room",
        type: "voice"
      }
    });
    assert.equal(voiceChannelResponse.statusCode, 201);
    const voiceChannelId = voiceChannelResponse.json().id as string;

    const memberIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "flow_member",
      email: "flow-user@dev.local",
      preferredUsername: "flowmember",
      avatarUrl: null
    });
    const memberCookie = createAuthCookie({
      productUserId: memberIdentity.productUserId,
      provider: "dev",
      oidcSubject: "flow_member"
    });

    const grantMemberRoleResponse = await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: adminCookie },
      payload: {
        productUserId: memberIdentity.productUserId,
        role: "user",
        serverId: bootstrapBody.defaultServerId
      }
    });
    assert.equal(grantMemberRoleResponse.statusCode, 204);

    // Role grants don't imply membership — the policy engine resolves access
    // via hub_members / server_members. Normally `joinHub()` is called during
    // invite redemption; here we shortcut and insert directly.
    const ctxRes = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = ctxRes.json().hubId as string;
    await pool.query(
      "insert into hub_members (hub_id, product_user_id) values ($1, $2) on conflict do nothing",
      [hubId, memberIdentity.productUserId]
    );
    await pool.query(
      "insert into server_members (server_id, product_user_id) values ($1, $2) on conflict do nothing",
      [bootstrapBody.defaultServerId, memberIdentity.productUserId]
    );

    const sendMentionResponse = await app.inject({
      method: "POST",
      url: `/v1/channels/${bootstrapBody.defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: {
        content: "hello @flowmember"
      }
    });
    assert.equal(sendMentionResponse.statusCode, 201);

    const memberMentionsResponse = await app.inject({
      method: "GET",
      url: `/v1/channels/${bootstrapBody.defaultChannelId}/mentions`,
      headers: { cookie: memberCookie }
    });
    assert.equal(memberMentionsResponse.statusCode, 200);
    assert.ok(memberMentionsResponse.json().items.length >= 1);

    const markReadResponse = await app.inject({
      method: "PUT",
      url: `/v1/channels/${bootstrapBody.defaultChannelId}/read-state`,
      headers: { cookie: memberCookie },
      payload: {}
    });
    assert.equal(markReadResponse.statusCode, 200);

    const memberMentionsAfterReadResponse = await app.inject({
      method: "GET",
      url: `/v1/channels/${bootstrapBody.defaultChannelId}/mentions`,
      headers: { cookie: memberCookie }
    });
    assert.equal(memberMentionsAfterReadResponse.statusCode, 200);
    assert.equal(memberMentionsAfterReadResponse.json().items.length, 0);

    const issueVoiceTokenResponse = await app.inject({
      method: "POST",
      url: "/v1/voice/token",
      headers: { cookie: memberCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        channelId: voiceChannelId
      }
    });
    assert.equal(issueVoiceTokenResponse.statusCode, 200);

    const joinVoiceResponse = await app.inject({
      method: "POST",
      url: "/v1/voice/presence/join",
      headers: { cookie: memberCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        channelId: voiceChannelId
      }
    });
    assert.equal(joinVoiceResponse.statusCode, 204);

    const updateVoiceStateResponse = await app.inject({
      method: "PATCH",
      url: "/v1/voice/presence/state",
      headers: { cookie: memberCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        channelId: voiceChannelId,
        muted: true,
        deafened: false
      }
    });
    assert.equal(updateVoiceStateResponse.statusCode, 204);

    const listVoicePresenceResponse = await app.inject({
      method: "GET",
      url: `/v1/voice/presence?serverId=${bootstrapBody.defaultServerId}&channelId=${voiceChannelId}`,
      headers: { cookie: memberCookie }
    });
    assert.equal(listVoicePresenceResponse.statusCode, 200);
    assert.equal(listVoicePresenceResponse.json().items.length, 1);
    assert.equal(listVoicePresenceResponse.json().items[0].muted, true);

    const leaveVoiceResponse = await app.inject({
      method: "POST",
      url: "/v1/voice/presence/leave",
      headers: { cookie: memberCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        channelId: voiceChannelId
      }
    });
    assert.equal(leaveVoiceResponse.statusCode, 204);
  } finally {
    await app.close();
  }
});
