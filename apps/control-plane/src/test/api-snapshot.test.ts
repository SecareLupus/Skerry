import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createSessionToken } from "../auth/session.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";

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

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("API Snapshot: Core Domain Endpoints", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "api_admin",
      email: "api-admin@dev.local",
      preferredUsername: "api-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "api_admin"
    });

    // 1. Bootstrap
    const bootRes = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Snapshot Hub" }
    });
    assert.equal(bootRes.statusCode, 201, "Bootstrap should succeed");
    const { defaultServerId, defaultChannelId } = bootRes.json();

    // 2. GET Hubs (via context)
    const ctxRes = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    assert.equal(ctxRes.statusCode, 200);
    const { hubId } = ctxRes.json();
    assert.ok(hubId);

    // 3. GET Spaces (Servers)
    const serversRes = await app.inject({
      method: "GET",
      url: `/v1/hubs/${hubId}/servers`,
      headers: { cookie: adminCookie }
    });
    assert.equal(serversRes.statusCode, 200);
    const servers = serversRes.json().items;
    assert.ok(Array.isArray(servers));
    assert.ok(servers.some((s: any) => s.id === defaultServerId));

    // 4. GET Channels
    const channelsRes = await app.inject({
      method: "GET",
      url: `/v1/servers/${defaultServerId}/channels`,
      headers: { cookie: adminCookie }
    });
    assert.equal(channelsRes.statusCode, 200);
    const channels = channelsRes.json().items;
    assert.ok(Array.isArray(channels));
    assert.ok(channels.some((c: any) => c.id === defaultChannelId));

    // 5. POST Message
    const msgRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Snapshot message" }
    });
    assert.equal(msgRes.statusCode, 201);
    
  } finally {
    await app.close();
  }
});
