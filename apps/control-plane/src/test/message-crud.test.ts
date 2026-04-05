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

/** Boots a fresh hub+space and returns commonly needed IDs */
async function bootstrap(app: Awaited<ReturnType<typeof buildApp>>) {
  const adminIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "msg_admin",
    email: "msg-admin@dev.local",
    preferredUsername: "msg-admin",
    avatarUrl: null
  });
  const adminCookie = createAuthCookie({
    productUserId: adminIdentity.productUserId,
    provider: "dev",
    oidcSubject: "msg_admin"
  });

  const bsRes = await app.inject({
    method: "POST",
    url: "/auth/bootstrap-admin",
    headers: { cookie: adminCookie },
    payload: { setupToken: config.setupBootstrapToken, hubName: "Message CRUD Hub" }
  });
  assert.equal(bsRes.statusCode, 201);
  const { defaultServerId, defaultChannelId } = bsRes.json() as {
    defaultServerId: string;
    defaultChannelId: string;
  };

  const ctxRes = await app.inject({
    method: "GET",
    url: "/v1/bootstrap/context",
    headers: { cookie: adminCookie }
  });
  const hubId = ctxRes.json().hubId as string;

  return { adminIdentity, adminCookie, defaultServerId, defaultChannelId, hubId };
}

// ---------------------------------------------------------------------------

test("authenticated user can send, read, edit, and delete their own message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

test("message full-text search returns matching messages and excludes non-matching", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Send two messages with distinguishable content
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "The quick brown fox" }
    });
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Completely unrelated content here" }
    });

    const searchRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages/search?q=quick+brown+fox`,
      headers: { cookie: adminCookie }
    });
    assert.equal(searchRes.statusCode, 200);
    const results = searchRes.json().items as { content: string }[];
    assert.ok(
      results.some((m) => m.content.includes("quick brown fox")),
      "Search should return the matching message"
    );
    assert.ok(
      !results.some((m) => m.content.includes("unrelated")),
      "Search should not return non-matching messages"
    );
  } finally {
    await app.close();
  }
});

test("hub invite can be created, looked up, and used to join by a new member", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
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

test("message content length is validated at the route boundary", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Empty content
    const emptyRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "" }
    });
    assert.ok(
      emptyRes.statusCode === 400 || emptyRes.statusCode === 422,
      `Expected validation error for empty content, got ${emptyRes.statusCode}`
    );

    // Content over 2000 characters
    const tooLongRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "x".repeat(2001) }
    });
    assert.ok(
      tooLongRes.statusCode === 400 || tooLongRes.statusCode === 422,
      `Expected validation error for oversized content, got ${tooLongRes.statusCode}`
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Regression tests: image attachment posting via mediaUrls
// ---------------------------------------------------------------------------

test("messages can be sent with mediaUrls and attachments are stored", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Send a message with mediaUrls (as the client does after uploading)
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: {
        content: "Here is an image",
        mediaUrls: ["https://example.com/photo.png"]
      }
    });
    assert.equal(sendRes.statusCode, 201, `Expected 201, got ${sendRes.statusCode}: ${sendRes.body}`);
    const message = sendRes.json() as { id: string; attachments?: { url: string; contentType: string; filename: string }[] };
    assert.ok(message.id, "Message should have an id");
    assert.ok(Array.isArray(message.attachments) && message.attachments.length === 1, "Message should have one attachment");
    assert.equal(message.attachments![0]!.url, "https://example.com/photo.png");
    // Content type should be inferred from extension, not hardcoded as image/jpeg
    assert.equal(message.attachments![0]!.contentType, "image/png", "Content type should be inferred as image/png for .png extension");

    // Confirm attachment is persisted and returned in listing
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listRes.statusCode, 200);
    const items = listRes.json().items as { id: string; attachments?: { url: string }[] }[];
    const found = items.find((m) => m.id === message.id);
    assert.ok(found, "Sent message should appear in listing");
    assert.ok(
      Array.isArray(found?.attachments) && found!.attachments!.some((a) => a.url === "https://example.com/photo.png"),
      "Attachment URL should appear in listing"
    );
  } finally {
    await app.close();
  }
});

test("mediaUrls content type is inferred correctly for different file extensions", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const cases: [string, string][] = [
      ["https://cdn.example.com/img.jpeg", "image/jpeg"],
      ["https://cdn.example.com/img.jpg", "image/jpeg"],
      ["https://cdn.example.com/img.png", "image/png"],
      ["https://cdn.example.com/img.gif", "image/gif"],
      ["https://cdn.example.com/img.webp", "image/webp"],
      ["https://cdn.example.com/img.svg", "image/svg+xml"],
    ];

    for (const [url, expectedType] of cases) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/channels/${defaultChannelId}/messages`,
        headers: { cookie: adminCookie },
        payload: { content: `test image ${url}`, mediaUrls: [url] }
      });
      assert.equal(res.statusCode, 201, `Expected 201 for ${url}, got ${res.statusCode}`);
      const attachments = res.json().attachments as { url: string; contentType: string }[];
      assert.ok(attachments?.length === 1, `Expected 1 attachment for ${url}`);
      assert.equal(attachments[0]!.contentType, expectedType, `Expected ${expectedType} for ${url}`);
    }
  } finally {
    await app.close();
  }
});

test("mediaUrls array exceeding 8 entries is rejected", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const tooManyUrls = Array.from({ length: 9 }, (_, i) => `https://example.com/img${i}.png`);
    const res = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "too many attachments", mediaUrls: tooManyUrls }
    });
    assert.ok(
      res.statusCode === 400 || res.statusCode === 422,
      `Expected 400/422 for too many mediaUrls, got ${res.statusCode}`
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Regression tests: message deletion
// ---------------------------------------------------------------------------

test("moderator can delete another user's message", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
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

  await initDb();
  await resetDb();
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

test("message with mediaUrls is rejected when URL is not valid", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  await initDb();
  await resetDb();
  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "bad url", mediaUrls: ["not-a-valid-url"] }
    });
    assert.ok(
      res.statusCode === 400 || res.statusCode === 422,
      `Expected 400/422 for invalid URL in mediaUrls, got ${res.statusCode}: ${res.body}`
    );
  } finally {
    await app.close();
  }
});

