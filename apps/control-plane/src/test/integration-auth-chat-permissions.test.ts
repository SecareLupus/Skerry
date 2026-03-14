import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createSessionToken } from "../auth/session.js";
import { initDb, pool } from "../db/client.js";
import { getIdentityByProviderSubject, upsertIdentityMapping } from "../services/identity-service.js";
import { isFederationHostAllowed } from "../services/federation-service.js";

config.discordBridge.mockMode = true;

async function resetDb(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.query("begin");
  try {
    await pool.query("delete from moderation_actions");
    await pool.query("delete from moderation_reports");
    await pool.query("delete from discord_bridge_channel_mappings");
    await pool.query("delete from discord_bridge_connections");
    await pool.query("delete from federation_policy_events");
    await pool.query("delete from room_acl_status");
    await pool.query("delete from hub_federation_policies");
    await pool.query("delete from delegation_audit_events");
    await pool.query("delete from space_admin_assignments");
    await pool.query("delete from role_assignment_audit_logs");
    await pool.query("delete from role_bindings");
    await pool.query("delete from chat_messages");
    await pool.query("delete from channels");
    await pool.query("delete from categories");
    await pool.query("delete from servers");
    await pool.query("delete from hubs");
    await pool.query("delete from identity_mappings");
    await pool.query("delete from idempotency_keys");
    await pool.query(
      "update platform_settings set bootstrap_completed_at = null, bootstrap_admin_user_id = null, bootstrap_hub_id = null, default_server_id = null, default_channel_id = null where id = 'global'"
    );
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

function createAuthCookie(input: {
  productUserId: string;
  provider?: string;
  oidcSubject?: string;
}): string {
  const token = createSessionToken({
    productUserId: input.productUserId,
    provider: input.provider ?? "dev",
    oidcSubject: input.oidcSubject ?? `sub_${input.productUserId}`,
    expiresAt: Date.now() + 60 * 60 * 1000
  });
  return `skerry_session=${token}`;
}

test("auth/session returns structured unauthorized error with correlation id", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/auth/session/me" });

  assert.equal(response.statusCode, 401);
  assert.ok(response.headers["x-request-id"]);
  assert.equal(response.json().code, "unauthorized");
  assert.equal(response.json().requestId, response.headers["x-request-id"]);

  await app.close();
});

test("bootstrap-admin returns unauthorized before bootstrap checks when session is missing", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/auth/bootstrap-admin",
    payload: {
      setupToken: "wrong",
      hubName: "Test Hub"
    }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, "unauthorized");
  await app.close();
});

test("chat and permissions routes return unauthorized before initialization checks without session", async () => {
  const app = await buildApp();

  const chatResponse = await app.inject({
    method: "GET",
    url: "/v1/channels/chn_test/messages?limit=10"
  });
  assert.equal(chatResponse.statusCode, 401);
  assert.equal(chatResponse.json().code, "unauthorized");

  const permissionsResponse = await app.inject({
    method: "GET",
    url: "/v1/permissions?serverId=srv_test"
  });
  assert.equal(permissionsResponse.statusCode, 401);
  assert.equal(permissionsResponse.json().code, "unauthorized");

  await app.close();
});

test("invalid provider on auth login returns structured validation error", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/auth/login/not-a-provider"
  });

  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.code, "validation_error");
  assert.equal(payload.error, "Bad Request");
  assert.ok(payload.requestId);

  await app.close();
});

test("authenticated bootstrap + provisioning context + permission gate flow", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  await initDb();
  await resetDb();

  const app = await buildApp();
  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "it_admin",
      email: "it-admin@dev.local",
      preferredUsername: "it-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "it_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Integration Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as {
      defaultServerId: string;
      defaultChannelId: string;
    };
    assert.ok(bootstrapBody.defaultServerId);
    assert.ok(bootstrapBody.defaultChannelId);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: { cookie: adminCookie }
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().identity?.provider, "dev");

    const contextResponse = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    assert.equal(contextResponse.statusCode, 200);
    assert.equal(contextResponse.json().defaultServerId, bootstrapBody.defaultServerId);
    assert.equal(contextResponse.json().defaultChannelId, bootstrapBody.defaultChannelId);

    const permissionsResponse = await app.inject({
      method: "GET",
      url: `/v1/permissions?serverId=${bootstrapBody.defaultServerId}&channelId=${bootstrapBody.defaultChannelId}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(permissionsResponse.statusCode, 200);
    assert.ok(Array.isArray(permissionsResponse.json().items));
    assert.ok(permissionsResponse.json().items.includes("channel.lock"));

    const memberIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "it_member",
      email: "it-user@dev.local",
      preferredUsername: "it-user",
      avatarUrl: null
    });
    const memberCookie = createAuthCookie({
      productUserId: memberIdentity.productUserId,
      provider: "dev",
      oidcSubject: "it_member"
    });

    const forbiddenControlsResponse = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${bootstrapBody.defaultChannelId}/controls`,
      headers: { cookie: memberCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        lock: true,
        reason: "test gate"
      }
    });
    assert.equal(forbiddenControlsResponse.statusCode, 403);
    assert.equal(forbiddenControlsResponse.json().code, "forbidden_scope");
  } finally {
    await app.close();
  }
});

test("dev login establishes session when bypass is enabled", async (t) => {
  if (!config.devAuthBypass) {
    t.skip("DEV_AUTH_BYPASS is disabled.");
    return;
  }
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/auth/dev-login?username=it-dev-user"
    });
    assert.equal(loginResponse.statusCode, 302);
    const setCookie = loginResponse.headers["set-cookie"];
    assert.ok(typeof setCookie === "string" && setCookie.includes("skerry_session="));

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: {
        cookie: setCookie
      }
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().identity?.provider, "dev");
    assert.equal(sessionResponse.json().needsOnboarding, true);
  } finally {
    await app.close();
  }
});

test("session includes linked identities for same product user", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const primary = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "linked_primary",
      email: "linked@example.test",
      preferredUsername: "linkeduser",
      avatarUrl: null
    });
    await upsertIdentityMapping({
      provider: "google",
      oidcSubject: "google_sub_1",
      email: "linked@example.test",
      preferredUsername: null,
      avatarUrl: null,
      productUserId: primary.productUserId
    });

    const cookie = createAuthCookie({
      productUserId: primary.productUserId,
      provider: "google",
      oidcSubject: "google_sub_1"
    });

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: { cookie }
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().linkedIdentities.length, 2);
    assert.equal(sessionResponse.json().needsOnboarding, false);
    assert.equal(sessionResponse.json().identity?.provider, "google");
  } finally {
    await app.close();
  }
});

test("onboarding username assignment updates linked identities and enforces uniqueness", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const existing = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "existing_user",
      email: "existing@example.test",
      preferredUsername: "taken_name",
      avatarUrl: null
    });
    const onboardingUser = await upsertIdentityMapping({
      provider: "discord",
      oidcSubject: "discord_pending",
      email: "pending@example.test",
      preferredUsername: null,
      avatarUrl: null
    });
    await upsertIdentityMapping({
      provider: "twitch",
      oidcSubject: "twitch_pending",
      email: "pending@example.test",
      preferredUsername: null,
      avatarUrl: null,
      productUserId: onboardingUser.productUserId
    });

    const onboardingCookie = createAuthCookie({
      productUserId: onboardingUser.productUserId,
      provider: "discord",
      oidcSubject: "discord_pending"
    });

    const takenResponse = await app.inject({
      method: "POST",
      url: "/auth/onboarding/username",
      headers: { cookie: onboardingCookie },
      payload: { username: "taken_name" }
    });
    assert.equal(takenResponse.statusCode, 409);
    assert.equal(takenResponse.json().code, "username_taken");

    const saveResponse = await app.inject({
      method: "POST",
      url: "/auth/onboarding/username",
      headers: { cookie: onboardingCookie },
      payload: { username: "fresh_name" }
    });
    assert.equal(saveResponse.statusCode, 204);

    const discordIdentity = await getIdentityByProviderSubject({
      provider: "discord",
      oidcSubject: "discord_pending"
    });
    const twitchIdentity = await getIdentityByProviderSubject({
      provider: "twitch",
      oidcSubject: "twitch_pending"
    });
    assert.equal(discordIdentity?.preferredUsername, "fresh_name");
    assert.equal(twitchIdentity?.preferredUsername, "fresh_name");

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: { cookie: onboardingCookie }
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().needsOnboarding, false);

    assert.ok(existing.productUserId);
  } finally {
    await app.close();
  }
});

test("federation allowlist matching handles allowed vs denied homeservers", () => {
  const allowlist = ["matrix.creatorhub.dev", "synapse.partner.net"];
  assert.equal(isFederationHostAllowed(allowlist, "matrix.creatorhub.dev"), true);
  assert.equal(isFederationHostAllowed(allowlist, "evil.example.org"), false);
  assert.equal(isFederationHostAllowed(allowlist, "SYNAPSE.PARTNER.NET"), true);
});

test("federation + discord bridge + video controls admin workflow", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "phase79_admin",
      email: "phase79-admin@dev.local",
      preferredUsername: "phase79-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "phase79_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Phase79 Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as {
      defaultServerId: string;
      defaultChannelId: string;
    };

    const contextResponse = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = contextResponse.json().hubId as string;
    assert.ok(hubId);

    const federationSave = await app.inject({
      method: "PUT",
      url: `/v1/hubs/${hubId}/federation-policy`,
      headers: { cookie: adminCookie },
      payload: {
        allowlist: ["matrix.creatorhub.dev"]
      }
    });
    assert.equal(federationSave.statusCode, 200);

    const reconcile = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/federation-policy/reconcile`,
      headers: { cookie: adminCookie }
    });
    assert.equal(reconcile.statusCode, 200);

    const voiceChannelResponse = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: adminCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "phase79-voice",
        type: "voice"
      }
    });
    assert.equal(voiceChannelResponse.statusCode, 201);
    const voiceChannelId = voiceChannelResponse.json().id as string;

    const videoControls = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${voiceChannelId}/video-controls`,
      headers: { cookie: adminCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        videoEnabled: true,
        maxVideoParticipants: 4
      }
    });
    assert.equal(videoControls.statusCode, 200);
    assert.equal(videoControls.json().voiceMetadata?.videoEnabled, true);

    const oauthStart = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthStart.statusCode, 302);
    const location = oauthStart.headers.location;
    assert.ok(location);
    const state = new URL(location).searchParams.get("state");
    assert.ok(state);

    const oauthCallback = await app.inject({
      method: "GET",
      url: `/auth/callback/discord?code=mock-code&state=${encodeURIComponent(state!)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthCallback.statusCode, 302);
    const callbackLocation = oauthCallback.headers.location;
    assert.ok(callbackLocation);
    const pendingSelection = new URL(callbackLocation).searchParams.get("discordPendingSelection");
    assert.ok(pendingSelection);

    const pendingResponse = await app.inject({
      method: "GET",
      url: `/v1/discord/bridge/pending/${pendingSelection}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(pendingResponse.statusCode, 200);
    const firstGuildId = pendingResponse.json().guilds[0]?.id as string;
    assert.ok(firstGuildId);

    const selectGuild = await app.inject({
      method: "POST",
      url: `/v1/discord/bridge/pending/${pendingSelection}/select`,
      headers: { cookie: adminCookie },
      payload: { guildId: firstGuildId }
    });
    assert.equal(selectGuild.statusCode, 200);

    const mappingUpsert = await app.inject({
      method: "PUT",
      url: `/v1/discord/bridge/${bootstrapBody.defaultServerId}/mappings`,
      headers: { cookie: adminCookie },
      payload: {
        guildId: firstGuildId,
        discordChannelId: "discord_chan_general",
        discordChannelName: "general",
        matrixChannelId: bootstrapBody.defaultChannelId,
        enabled: true
      }
    });
    assert.equal(mappingUpsert.statusCode, 200);

    const relay = await app.inject({
      method: "POST",
      url: `/v1/discord/bridge/${bootstrapBody.defaultServerId}/relay`,
      headers: { cookie: adminCookie },
      payload: {
        discordChannelId: "discord_chan_general",
        authorName: "discord-user",
        content: "hello from discord"
      }
    });
    assert.equal(relay.statusCode, 200);
    assert.equal(relay.json().relayed, true);
  } finally {
    await app.close();
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

  await initDb();
  await resetDb();
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
        role: "space_owner",
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

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

test("space owner can rename their own space and manage categories", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "space_perm_admin",
      email: "space-perm-admin@dev.local",
      preferredUsername: "space-perm-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_perm_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Permission Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const ownerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "space_perm_owner",
      email: "space-perm-owner@dev.local",
      preferredUsername: "space-perm-owner",
      avatarUrl: null
    });
    const ownerCookie = createAuthCookie({
      productUserId: ownerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_perm_owner"
    });

    // Delegate space ownership
    await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: { productUserId: ownerIdentity.productUserId }
    });

    // 1. Verify Space Owner can rename the space
    const renameResponse = await app.inject({
      method: "PATCH",
      url: `/v1/servers/${bootstrapBody.defaultServerId}`,
      headers: { cookie: ownerCookie },
      payload: { name: "Renamed by Space Owner" }
    });
    assert.equal(renameResponse.statusCode, 200);
    assert.equal(renameResponse.json().name, "Renamed by Space Owner");

    // 2. Verify Space Owner can create and delete a category
    const createCatResponse = await app.inject({
      method: "POST",
      url: "/v1/categories",
      headers: { cookie: ownerCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "Test Category"
      }
    });
    assert.equal(createCatResponse.statusCode, 201);
    const categoryId = createCatResponse.json().id as string;

    const deleteCatResponse = await app.inject({
      method: "DELETE",
      url: `/v1/categories/${categoryId}?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(deleteCatResponse.statusCode, 204);

    // 3. Verify role bindings include the space_owner role
    const rolesResponse = await app.inject({
      method: "GET",
      url: "/v1/me/roles",
      headers: { cookie: ownerCookie }
    });
    assert.equal(rolesResponse.statusCode, 200);
    const hasOwnerRole = rolesResponse.json().items.some(
      (item: { role: string; serverId: string }) =>
        item.role === "space_owner" && item.serverId === bootstrapBody.defaultServerId
    );
    assert.ok(hasOwnerRole, "Space Owner role should be present in roles list");

  } finally {
    await app.close();
  }
});

test("Discord bridge permissions respect Hub setting for Space Owners", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "bridge_adm",
      email: "bridge-admin@dev.local",
      preferredUsername: "bridge-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "bridge_adm"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Bridge Test Hub"
      }
    });
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };
    const hubId = (await app.inject({ method: "GET", url: "/v1/bootstrap/context", headers: { cookie: adminCookie } })).json().hubId as string;

    const ownerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "bridge_owner",
      email: "bridge-owner@dev.local",
      preferredUsername: "bridge-owner",
      avatarUrl: null
    });
    const ownerCookie = createAuthCookie({
      productUserId: ownerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "bridge_owner"
    });

    // Make bridge_owner a space_owner
    await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: { productUserId: ownerIdentity.productUserId }
    });

    // 1. By default, Space Owner CAN start bridge
    const oauthStartAllowed = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(oauthStartAllowed.statusCode, 302);

    // 2. Disable Space bridge at Hub level
    await app.inject({
      method: "PATCH",
      url: `/v1/hubs/${hubId}/settings`,
      headers: { cookie: adminCookie },
      payload: { allowSpaceDiscordBridge: false }
    });

    // 3. Space Owner should now be FORBIDDEN
    const oauthStartDisabled = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(oauthStartDisabled.statusCode, 403);

    // 4. Hub Admin should STILL be allowed
    const oauthStartAdmin = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthStartAdmin.statusCode, 302);

  } finally {
    await app.close();
  }
});

test("hub admin can see all channels in a server even if they are not a server member", async () => {
  await resetDb();
  const app = await buildApp();
  try {
    // 1. Setup Hub Admin
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "hub_admin_sub",
      email: "admin@dev.local",
      preferredUsername: "admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "hub_admin_sub"
    });

    // 2. Bootstrap Hub
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Test Hub" }
    });
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    // 3. Setup another user who creates another server
    const otherIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "other_sub",
      email: "other@dev.local",
      preferredUsername: "other",
      avatarUrl: null
    });
    const otherCookie = createAuthCookie({
      productUserId: otherIdentity.productUserId,
      provider: "dev",
      oidcSubject: "other_sub"
    });

    // Create a new server owned by "other"
    const createServerResponse = await app.inject({
      method: "POST",
      url: "/v1/servers",
      headers: { cookie: otherCookie },
      payload: { name: "Other Server", visitorAccess: 'hidden' }
    });
    const otherServerId = createServerResponse.json().id;

    // Create a private channel in that server
    const createChannelResponse = await app.inject({
      method: "POST",
      url: `/v1/servers/${otherServerId}/channels`,
      headers: { cookie: otherCookie },
      payload: { name: "secret-channel", type: "text", visitorAccess: 'hidden' }
    });
    const secretChannelId = createChannelResponse.json().id;

    // 4. Hub Admin (not a member of 'Other Server') should be able to list channels
    const listChannelsResponse = await app.inject({
      method: "GET",
      url: `/v1/servers/${otherServerId}/channels`,
      headers: { cookie: adminCookie }
    });

    assert.equal(listChannelsResponse.statusCode, 200);
    const channels = listChannelsResponse.json() as { id: string }[];
    const hasSecret = channels.some((c) => c.id === secretChannelId);
    assert.ok(hasSecret, "Hub Admin should see the secret channel");

  } finally {
    await app.close();
  }
});
