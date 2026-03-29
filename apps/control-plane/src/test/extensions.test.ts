import { test } from "node:test";
import assert from "node:assert";
import { createWebhook, getWebhookByToken } from "../services/extension-service.js";
import { withDb } from "../db/client.js";

test("Webhook CRUD and lookup", async () => {
  const serverId = "srv_test_extensions";
  const channelId = "ch_test_webhooks";
  
  // Setup: Ensure server/channel exist
  await withDb(async (db) => {
    await db.query("insert into hubs (id, name, owner_user_id) values ('h_test', 'Test Hub', 'u1') on conflict do nothing");
    await db.query("insert into servers (id, hub_id, name, created_by_user_id) values ($1, 'h_test', 'Test Server', 'u1') on conflict do nothing", [serverId]);
    await db.query("insert into channels (id, server_id, name, type) values ($1, $2, 'Test Channel', 'text') on conflict do nothing", [channelId, serverId]);
  });

  const webhook = await createWebhook({
    channelId,
    serverId,
    name: "Test Webhook"
  });

  assert.strictEqual(webhook.name, "Test Webhook");
  assert.ok(webhook.secretToken);

  const found = await getWebhookByToken(webhook.id, webhook.secretToken);
  assert.ok(found);
  assert.strictEqual(found.id, webhook.id);

  const wrong = await getWebhookByToken(webhook.id, "wrong_token");
  assert.strictEqual(wrong, null);
});
