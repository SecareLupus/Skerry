import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createSessionToken } from "../auth/session.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";

async function resetDb(): Promise<void> {
  if (!pool) return;
  await pool.query("begin");
  try {
    await pool.query("delete from mention_markers");
    await pool.query("delete from channel_read_states");
    await pool.query("delete from chat_messages");
    await pool.query("delete from channels");
    await pool.query("delete from categories");
    await pool.query("delete from servers");
    await pool.query("delete from hubs");
    await pool.query("delete from identity_mappings");
    await pool.query(
      "update platform_settings set bootstrap_completed_at = null, bootstrap_admin_user_id = null, bootstrap_hub_id = null, default_server_id = null, default_channel_id = null where id = 'global'"
    );
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

function createAuthCookie(productUserId: string): string {
  const token = createSessionToken({
    productUserId,
    provider: "dev",
    oidcSubject: `sub_${productUserId.replaceAll("-", "")}`,
    expiresAt: Date.now() + 60 * 60 * 1000
  });
  return `skerry_session=${token}`;
}

test("notifications summary returns unread counts and mentions", async (t) => {
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
    // 1. Setup Admin and Hub
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "notif_admin",
      email: "notif-admin@dev.local",
      preferredUsername: "notif-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie(adminIdentity.productUserId);

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Notification Hub"
      }
    });
    const { defaultServerId, defaultChannelId } = bootstrapResponse.json();

    // 2. Setup Member
    const memberIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "notif_member",
      email: "notif-member@dev.local",
      preferredUsername: "notif-member",
      avatarUrl: null
    });
    const memberCookie = createAuthCookie(memberIdentity.productUserId);

    // 3. Initial state: zero notifications
    const initialNotifResponse = await app.inject({
      method: "GET",
      url: "/v1/me/notifications",
      headers: { cookie: memberCookie }
    });
    assert.equal(initialNotifResponse.statusCode, 200);
    assert.deepEqual(initialNotifResponse.json().summary, {});

    // 4. Admin sends a message
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: {
        content: "Hello member!"
      }
    });

    // 5. Member should have 1 unread message
    const unreadResponse = await app.inject({
      method: "GET",
      url: "/v1/me/notifications",
      headers: { cookie: memberCookie }
    });
    assert.equal(unreadResponse.json().summary[defaultChannelId].unreadCount, 1);
    assert.equal(unreadResponse.json().summary[defaultChannelId].mentionCount, 0);

    // 6. Admin mentions member
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: {
        content: "Ping @notif-member"
      }
    });

    // 7. Member should have 2 unread messages and 1 mention
    const mentionResponse = await app.inject({
      method: "GET",
      url: "/v1/me/notifications",
      headers: { cookie: memberCookie }
    });
    assert.equal(mentionResponse.json().summary[defaultChannelId].unreadCount, 2);
    assert.equal(mentionResponse.json().summary[defaultChannelId].mentionCount, 1);

    // 8. Member reads the channel
    await app.inject({
      method: "PUT",
      url: `/v1/channels/${defaultChannelId}/read-state`,
      headers: { cookie: memberCookie }
    });

    // 9. Notifications should be clear
    const clearResponse = await app.inject({
      method: "GET",
      url: "/v1/me/notifications",
      headers: { cookie: memberCookie }
    });
    assert.deepEqual(clearResponse.json().summary, {});

  } finally {
    await app.close();
  }
});
