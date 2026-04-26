import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/client.js";
import { createMessage, updateMessageByExternalId, deleteMessage } from "../services/chat/message-service.js";
import { subscribeToChannelMessages } from "../services/chat-realtime.js";
import { resetDb } from "./helpers/reset-db.js";
import { captureEvents } from "./helpers/events.js";

beforeEach(async () => {
  if (pool) await resetDb();
});

async function seedChannel(): Promise<void> {
  await pool!.query("insert into hubs (id, name, owner_user_id) values ('hub_1', 'Test Hub', 'usr_1')");
  await pool!.query("insert into servers (id, hub_id, name, created_by_user_id, owner_user_id) values ('srv_1', 'hub_1', 'Test Server', 'usr_1', 'usr_1')");
  await pool!.query("insert into channels (id, server_id, name, type) values ('chn_1', 'srv_1', 'General', 'text')");
}

test("Real-time Sync: createMessage emits events to subscribers", async () => {
  await seedChannel();

  const capture = captureEvents((listener) =>
    subscribeToChannelMessages("chn_1", listener)
  );

  try {
    const msg = await createMessage({
      channelId: "chn_1",
      actorUserId: "usr_1",
      content: "Hello from service layer!"
    });

    const created = capture.expect("message.created");
    assert.equal(created.payload.id, msg.id);
    assert.equal(created.payload.content, "Hello from service layer!");
  } finally {
    capture.unsubscribe();
  }
});

test("Real-time Sync: updateMessageByExternalId (Discord) emits events", async () => {
  await seedChannel();

  const msg = await createMessage({
    channelId: "chn_1",
    actorUserId: "usr_1",
    content: "Original"
  });

  await pool!.query("update chat_messages set external_provider = 'discord', external_message_id = '123' where id = $1", [msg.id]);

  const capture = captureEvents((listener) =>
    subscribeToChannelMessages("chn_1", listener)
  );

  try {
    await updateMessageByExternalId({
      externalProvider: "discord",
      externalMessageId: "123",
      content: "Updated from Discord"
    });

    const updated = capture.expect("message.updated");
    assert.equal(updated.payload.content, "Updated from Discord");
  } finally {
    capture.unsubscribe();
  }
});

test("Real-time Sync: deleteMessage emits message.deleted event", async () => {
  await seedChannel();

  const msg = await createMessage({
    channelId: "chn_1",
    actorUserId: "usr_1",
    content: "Will be deleted"
  });

  const capture = captureEvents((listener) =>
    subscribeToChannelMessages("chn_1", listener)
  );

  try {
    await deleteMessage({
      messageId: msg.id,
      actorUserId: "usr_1"
    });

    const deleted = capture.expect("message.deleted");
    assert.equal(deleted.payload.id, msg.id);
  } finally {
    capture.unsubscribe();
  }
});
