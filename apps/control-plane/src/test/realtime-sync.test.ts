import test from "node:test";
import assert from "node:assert/strict";
import { withDb, pool } from "../db/client.js";
import { createMessage, updateMessageByExternalId, deleteMessage } from "../services/chat/message-service.js";
import { subscribeToChannelMessages } from "../services/chat-realtime.js";

async function resetDb() {
  if (!pool) return;
  await pool.query("begin");
  try {
    await pool.query("delete from chat_messages");
    await pool.query("delete from channels");
    await pool.query("delete from servers");
    await pool.query("delete from hubs");
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

test("Real-time Sync: createMessage emits events to subscribers", async (t) => {
  await resetDb();

  // Setup data
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', 'usr_1')");
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', 'usr_1', 'usr_1')");
  await pool!.query("insert into channels (id, server_id, name, type) values ('chn_1', 'srv_1', 'General', 'text')");

  let eventReceived: any = null;
  const unsubscribe = subscribeToChannelMessages("chn_1", (event, payload) => {
    eventReceived = { event, payload };
  });

  try {
    const msg = await createMessage({
      channelId: "chn_1",
      actorUserId: "usr_1",
      content: "Hello from service layer!"
    });

    assert.ok(eventReceived, "Should have received an event");
    assert.equal(eventReceived.event, "message.created");
    assert.equal(eventReceived.payload.id, msg.id);
    assert.equal(eventReceived.payload.content, "Hello from service layer!");
  } finally {
    unsubscribe();
  }
});

test("Real-time Sync: updateMessageByExternalId (Discord) emits events", async (t) => {
  await resetDb();

  // Setup data
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', 'usr_1')");
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', 'usr_1', 'usr_1')");
  await pool!.query("insert into channels (id, server_id, name, type) values ('chn_1', 'srv_1', 'General', 'text')");

  const msg = await createMessage({
    channelId: "chn_1",
    actorUserId: "usr_1",
    content: "Original"
  });

  // Attach external ID
  await pool!.query("update chat_messages set external_provider = 'discord', external_message_id = '123' where id = $1", [msg.id]);

  let eventReceived: any = null;
  const unsubscribe = subscribeToChannelMessages("chn_1", (event, payload) => {
    eventReceived = { event, payload };
  });

  try {
    await updateMessageByExternalId({
      externalProvider: "discord",
      externalMessageId: "123",
      content: "Updated from Discord"
    });

    assert.ok(eventReceived, "Should have received an event");
    assert.equal(eventReceived.event, "message.updated");
    assert.equal(eventReceived.payload.content, "Updated from Discord");
  } finally {
    unsubscribe();
  }
});

test("Real-time Sync: deleteMessage emits message.deleted event", async (t) => {
  await resetDb();

  // Setup data
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', 'usr_1')");
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', 'usr_1', 'usr_1')");
  await pool!.query("insert into channels (id, server_id, name, type) values ('chn_1', 'srv_1', 'General', 'text')");

  const msg = await createMessage({
    channelId: "chn_1",
    actorUserId: "usr_1",
    content: "Will be deleted"
  });

  let eventReceived: any = null;
  const unsubscribe = subscribeToChannelMessages("chn_1", (event, payload) => {
    eventReceived = { event, payload };
  });

  try {
    await deleteMessage({
      messageId: msg.id,
      actorUserId: "usr_1"
    });

    assert.ok(eventReceived, "Should have received an event");
    assert.equal(eventReceived.event, "message.deleted");
    assert.equal(eventReceived.payload.id, msg.id);
  } finally {
    unsubscribe();
  }
});
