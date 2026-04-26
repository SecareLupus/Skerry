import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { getIdentityByProviderSubject, upsertIdentityMapping } from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

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

  const app = await buildApp();

  try {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/auth/dev-login?username=it-dev-user"
    });
    assert.equal(loginResponse.statusCode, 302);
    const setCookie = loginResponse.headers["set-cookie"];
    const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
    const sessionCookie = cookieArray.find(c => c.includes("skerry_session="));
    assert.ok(sessionCookie, "Should set skerry_session cookie");

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: {
        cookie: sessionCookie
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
