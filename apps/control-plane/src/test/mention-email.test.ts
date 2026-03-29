import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { withDb, initDb } from "../db/client.js";
import { createMessage } from "../services/chat-service.js";

test("Mention Email Notifications", async (t) => {
  // Ensure migrations are run on the test DB
  await initDb();

  // Setup test data
  const senderId = "usr_sender_123";
  const mentionedId = "usr_mentioned_456";
  const mentionedEmail = "mentioned@example.com";
  const mentionedUsername = "silent_bob";
  
  const setupData = async () => {
    await withDb(async (db) => {
      // Clear data to ensure clean state
      // Correct table names: chat_messages, user_presence, identity_mappings, servers, hubs, channels, server_members
      await db.query("delete from chat_messages where channel_id = 'chan_test_123'");
      await db.query("delete from user_presence where product_user_id = $1", [mentionedId]);
      await db.query("delete from identity_mappings where product_user_id in ($1, $2)", [senderId, mentionedId]);
      await db.query("delete from server_members where server_id = 'srv_test_123'");
      await db.query("delete from channels where id = 'chan_test_123'");
      await db.query("delete from servers where id = 'srv_test_123'");
      await db.query("delete from hubs where id = 'hub_test_123'");

      // Insert hub, server, channel
      await db.query("insert into hubs (id, name, owner_user_id) values ('hub_test_123', 'Test Hub', $1)", [senderId]);
      await db.query("insert into servers (id, hub_id, name, created_by_user_id) values ('srv_test_123', 'hub_test_123', 'Test Server', $1)", [senderId]);
      await db.query("insert into channels (id, server_id, name, type) values ('chan_test_123', 'srv_test_123', 'general', 'text')");
      
      // Insert identities
      await db.query(`
        insert into identity_mappings (id, provider, oidc_subject, product_user_id, preferred_username, email)
        values ('idm_1', 'google', 'sub1', $1, 'sender', 'sender@example.com')
      `, [senderId]);
      
      await db.query(`
        insert into identity_mappings (id, provider, oidc_subject, product_user_id, preferred_username, email)
        values ('idm_2', 'google', 'sub2', $1, $2, $3)
      `, [mentionedId, mentionedUsername, mentionedEmail]);

      // Add sender as member (for server membership checks)
      await db.query("insert into server_members (server_id, product_user_id) values ('srv_test_123', $1)", [senderId]);
    });
  };

  await setupData();

  await t.test("Triggers email notification for offline mentioned user", async () => {
    // Intercept console.log to see the simulation
    const logSpy = mock.method(console, "log");
    
    // Send message with mention
    const messageContent = `Hello @${mentionedUsername}, how are you?`;
    
    await createMessage({
      actorUserId: senderId,
      channelId: "chan_test_123",
      content: messageContent,
      type: "text"
    } as any);

    // Wait a bit for async mail sending (it's called without await in chat-service)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify presence check was called (implicitly tested by logic flow)
    const simulationCalled = logSpy.mock.calls.some((call: any) => 
      typeof call.arguments[0] === 'string' && call.arguments[0].includes("EMAIL SIMULATION")
    );
    
    assert.ok(simulationCalled, "Email simulation should have been triggered for offline user");
    
    const recipientFound = logSpy.mock.calls.some((call: any) => 
      typeof call.arguments[0] === 'string' && call.arguments[0].includes(`To: ${mentionedEmail}`)
    );
    assert.ok(recipientFound, `Email should be sent to ${mentionedEmail}`);

    logSpy.mock.restore();
  });

  await t.test("Does NOT trigger email notification for online mentioned user", async () => {
    await withDb(async (db) => {
      // Mark user as online (within the last 2 minutes threshold)
      await db.query(`
        insert into user_presence (product_user_id, last_seen_at) 
        values ($1, now())
        on conflict (product_user_id) 
        do update set last_seen_at = now()
      `, [mentionedId]);
    });

    const logSpy = mock.method(console, "log");
    
    await createMessage({
      actorUserId: senderId,
      channelId: "chan_test_123",
      content: `Hey @${mentionedUsername} you are online now!`,
      type: "text"
    } as any);

    await new Promise(resolve => setTimeout(resolve, 200));

    const simulationCalled = logSpy.mock.calls.some((call: any) => 
      typeof call.arguments[0] === 'string' && call.arguments[0].includes("EMAIL SIMULATION")
    );
    
    assert.strictEqual(simulationCalled, false, "Email simulation should NOT be triggered for online user");

    logSpy.mock.restore();
  });
});
