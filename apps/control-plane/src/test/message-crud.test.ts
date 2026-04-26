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
  bootstrapHub(app, { prefix: "msg", hubName: "Message CRUD Hub" });

// ---------------------------------------------------------------------------

test("authenticated user can send, read, edit, and delete their own message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // --- send ---
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Hello, world!" }
    });
    assert.equal(sendRes.statusCode, 201);
    const message = sendRes.json() as { id: string; content: string; authorUserId: string };
    assert.equal(message.content, "Hello, world!");
    assert.ok(message.id);

    // --- list messages and confirm presence ---
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listRes.statusCode, 200);
    const items = listRes.json().items as { id: string }[];
    assert.ok(items.some((m) => m.id === message.id), "Sent message must appear in list");

    // --- edit ---
    const editRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${defaultChannelId}/messages/${message.id}`,
      headers: { cookie: adminCookie },
      payload: { content: "Edited content" }
    });
    assert.equal(editRes.statusCode, 200);
    assert.equal(editRes.json().content, "Edited content");

    // --- delete ---
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/channels/${defaultChannelId}/messages/${message.id}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(deleteRes.statusCode, 204);

    // --- confirm message no longer appears in normal listing ---
    const listAfterDelete = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    const itemsAfterDelete = listAfterDelete.json().items as { id: string; deletedAt?: string }[];
    const deletedMsg = itemsAfterDelete.find((m) => m.id === message.id);
    // Either absent or present with deletedAt set (soft-delete)
    assert.ok(
      !deletedMsg || deletedMsg.deletedAt,
      "Deleted message should not appear as active"
    );
  } finally {
    await app.close();
  }
});

test("non-author cannot edit another user's message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId, defaultServerId } = await bootstrap(app);

    // Create a second user
    const otherIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "msg_other",
      email: "msg-other@dev.local",
      preferredUsername: "msg-other",
      avatarUrl: null
    });
    const otherCookie = createAuthCookie({
      productUserId: otherIdentity.productUserId,
      provider: "dev",
      oidcSubject: "msg_other"
    });

    // Grant other user membership
    await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: adminCookie },
      payload: { productUserId: otherIdentity.productUserId, role: "user", serverId: defaultServerId }
    });

    // Admin sends a message
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Admin's message" }
    });
    assert.equal(sendRes.statusCode, 201);
    const messageId = sendRes.json().id as string;

    // Other user attempts to edit it
    const editRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}`,
      headers: { cookie: otherCookie },
      payload: { content: "Stolen edit" }
    });
    assert.ok(
      editRes.statusCode === 403 || editRes.statusCode === 404,
      `Expected 403 or 404, got ${editRes.statusCode}`
    );
  } finally {
    await app.close();
  }
});

test("emoji reactions can be added and removed on a message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "React to me" }
    });
    assert.equal(sendRes.statusCode, 201);
    const messageId = sendRes.json().id as string;

    // Add reaction
    const addRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}/reactions`,
      headers: { cookie: adminCookie },
      payload: { emoji: "👍" }
    });
    assert.equal(addRes.statusCode, 204);

    // Fetch the message and confirm reaction appears
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    const msgs = listRes.json().items as { id: string; reactions?: { emoji: string; count: number }[] }[];
    const msg = msgs.find((m) => m.id === messageId);
    assert.ok(msg, "Message should still be listed");
    const thumbsUp = msg?.reactions?.find((r) => r.emoji === "👍");
    assert.ok(thumbsUp && thumbsUp.count >= 1, "👍 reaction count should be at least 1");

    // Remove reaction
    const removeRes = await app.inject({
      method: "DELETE",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}/reactions/${encodeURIComponent("👍")}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(removeRes.statusCode, 204);

    // Confirm reaction is gone
    const listAfterRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    const msgsAfter = listAfterRes.json().items as { id: string; reactions?: { emoji: string; count: number }[] }[];
    const msgAfter = msgsAfter.find((m) => m.id === messageId);
    const thumbsUpAfter = msgAfter?.reactions?.find((r) => r.emoji === "👍" && r.count > 0);
    assert.ok(!thumbsUpAfter, "👍 reaction should be removed");
  } finally {
    await app.close();
  }
});

test("moderator can pin and unpin messages; pinned flag is reflected in listing", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Pin this" }
    });
    assert.equal(sendRes.statusCode, 201);
    const messageId = sendRes.json().id as string;

    // Pin
    const pinRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}/pin`,
      headers: { cookie: adminCookie }
    });
    assert.equal(pinRes.statusCode, 200);
    assert.equal(pinRes.json().isPinned, true);

    // Confirm pinned in listing
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    const pinnedMsg = (listRes.json().items as { id: string; isPinned?: boolean }[]).find(
      (m) => m.id === messageId
    );
    assert.equal(pinnedMsg?.isPinned, true);

    // Unpin
    const unpinRes = await app.inject({
      method: "DELETE",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}/pin`,
      headers: { cookie: adminCookie }
    });
    assert.equal(unpinRes.statusCode, 200);
    assert.equal(unpinRes.json().isPinned, false);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Moderation: cross-user delete
// ---------------------------------------------------------------------------

test("moderator can delete another user's message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, adminIdentity, defaultChannelId, defaultServerId } = await bootstrap(app);

    // Create a second regular user
    const regularIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "del_regular",
      email: "del-regular@dev.local",
      preferredUsername: "del-regular",
      avatarUrl: null
    });
    const regularCookie = createAuthCookie({
      productUserId: regularIdentity.productUserId,
      provider: "dev",
      oidcSubject: "del_regular"
    });

    // Grant regular user membership so they can post
    await app.inject({
      method: "POST",
      url: "/v1/roles/grant",
      headers: { cookie: adminCookie },
      payload: { productUserId: regularIdentity.productUserId, role: "user", serverId: defaultServerId }
    });

    // Regular user sends a message
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: regularCookie },
      payload: { content: "Regular user message" }
    });
    assert.equal(sendRes.statusCode, 201);
    const messageId = sendRes.json().id as string;

    // Admin (moderator) deletes the regular user's message
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(deleteRes.statusCode, 204, `Moderator should be able to delete message, got ${deleteRes.statusCode}: ${deleteRes.body}`);

    // Confirm deleted message no longer appears
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=50`,
      headers: { cookie: adminCookie }
    });
    const items = listRes.json().items as { id: string; deletedAt?: string }[];
    const found = items.find((m) => m.id === messageId);
    assert.ok(!found || found.deletedAt, "Deleted message should not appear in listing");

    // Keep adminIdentity referenced to avoid unused warning
    assert.ok(adminIdentity.productUserId);
  } finally {
    await app.close();
  }
});

test("non-moderator cannot delete another user's message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId, defaultServerId } = await bootstrap(app);

    // Two regular users
    const user1 = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "del_user1",
      email: "del-u1@dev.local",
      preferredUsername: "del-user1",
      avatarUrl: null
    });
    const user2 = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "del_user2",
      email: "del-u2@dev.local",
      preferredUsername: "del-user2",
      avatarUrl: null
    });
    const cookie1 = createAuthCookie({ productUserId: user1.productUserId, provider: "dev", oidcSubject: "del_user1" });
    const cookie2 = createAuthCookie({ productUserId: user2.productUserId, provider: "dev", oidcSubject: "del_user2" });

    // Grant both users membership
    for (const uid of [user1.productUserId, user2.productUserId]) {
      await app.inject({
        method: "POST",
        url: "/v1/roles/grant",
        headers: { cookie: adminCookie },
        payload: { productUserId: uid, role: "user", serverId: defaultServerId }
      });
    }

    // User1 sends a message
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: cookie1 },
      payload: { content: "User1 message" }
    });
    assert.equal(sendRes.statusCode, 201);
    const messageId = sendRes.json().id as string;

    // User2 tries to delete User1's message — should fail (403 or 500 from service throw)
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/channels/${defaultChannelId}/messages/${messageId}`,
      headers: { cookie: cookie2 }
    });
    assert.ok(
      deleteRes.statusCode >= 400,
      `Non-moderator should not be able to delete another user's message, got ${deleteRes.statusCode}`
    );

    // Message should still be present
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=50`,
      headers: { cookie: adminCookie }
    });
    const items = listRes.json().items as { id: string }[];
    assert.ok(items.some((m) => m.id === messageId), "Message should still be present after failed delete");
  } finally {
    await app.close();
  }
});
