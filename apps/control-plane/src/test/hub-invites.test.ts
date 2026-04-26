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
  bootstrapHub(app, { prefix: "inv", hubName: "Hub Invite Hub" });

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
