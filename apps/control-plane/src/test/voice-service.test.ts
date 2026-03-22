import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { withDb } from "../db/client.js";

test("Voice Service Integration", async (t) => {
  config.devAuthBypass = true;
  const app = await buildApp();
  
  // 1. Setup State
  // We perform setup directly in the main block to ensure sequential execution 
  // and stable variables for sub-tests.
  
  // Create a user via dev-login
  const loginRes = await app.inject({
    method: "POST",
    url: "/auth/dev-login",
    payload: { username: "voice-test-user" },
  });
  assert.strictEqual(loginRes.statusCode, 200);
  const loginBody = JSON.parse(loginRes.body);
  const productUserId = loginBody.productUserId;
  const cookies = loginRes.cookies.map(c => `${c.name}=${c.value}`);

  // 1. Setup State: Initialize Hub, Server, and Channel directly in DB
  const hubId = "hub_voice_test";
  const serverId = "srv_voice_test";
  const voiceChannelId = "chn_voice_test";
  const sfuRoomId = `sfu_chn_${voiceChannelId}`;

  await withDb(async (db) => {
    // Clear existing for this test to be idempotent
    await db.query("DELETE FROM voice_presence WHERE channel_id = $1", [voiceChannelId]);
    await db.query("DELETE FROM channels WHERE id = $1", [voiceChannelId]);
    await db.query("DELETE FROM servers WHERE id = $1", [serverId]);
    await db.query("DELETE FROM hubs WHERE id = $1", [hubId]);
    await db.query("DELETE FROM role_bindings WHERE product_user_id = $1", [productUserId]);

    // Insert test data
    await db.query(
      "INSERT INTO hubs (id, name, owner_user_id) VALUES ($1, $2, $3)",
      [hubId, "Voice Test Hub", productUserId]
    );
    await db.query(
      "INSERT INTO servers (id, name, hub_id, created_by_user_id) VALUES ($1, $2, $3, $4)",
      [serverId, "Voice Test Server", hubId, productUserId]
    );
    await db.query(
      "INSERT INTO channels (id, name, server_id, type, voice_sfu_room_id) VALUES ($1, $2, $3, $4, $5)",
      [voiceChannelId, "Voice Channel", serverId, "voice", sfuRoomId]
    );
    // Explicitly grant hub_admin to ensure permissions pass
    await db.query(
      "INSERT INTO role_bindings (id, product_user_id, role, hub_id) VALUES ($1, $2, $3, $4)",
      [`rb_${Date.now()}`, productUserId, "hub_admin", hubId]
    );
  });

  await t.test("POST /v1/voice/token issues valid token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/voice/token",
      headers: { cookie: cookies.join("; ") },
      payload: {
        serverId,
        channelId: voiceChannelId,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.token, "Should have a token");
    assert.strictEqual(body.channelId, voiceChannelId);
    assert.strictEqual(body.serverId, serverId);
    assert.ok(body.sfuUrl, "Should have an sfuUrl");
    assert.ok(body.sfuRoomId, "Should have an sfuRoomId");
    assert.ok(body.sfuRoomId.startsWith("sfu_chn_"), "Room ID should follow expected pattern");
    assert.strictEqual(typeof body.expiresAt, "string");
  });

  await t.test("Voice Presence lifecycle", async (t) => {
    await t.test("POST /v1/voice/presence/join", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice/presence/join",
        headers: { cookie: cookies.join("; ") },
        payload: {
          serverId,
          channelId: voiceChannelId,
          muted: true,
          deafened: false,
        },
      });
      assert.strictEqual(res.statusCode, 204);
    });

    await t.test("GET /v1/voice/presence lists members", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/voice/presence",
        headers: { cookie: cookies.join("; ") },
        query: { serverId, channelId: voiceChannelId },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.items));
      const me = body.items.find((m: any) => m.userId === productUserId);
      assert.ok(me, "User should be in presence list");
      assert.strictEqual(me.muted, true);
      assert.strictEqual(me.deafened, false);
      assert.strictEqual(typeof me.joinedAt, "string");
      assert.strictEqual(typeof me.updatedAt, "string");
      assert.ok(me.joinedAt.includes("T") && me.joinedAt.includes("Z"), "joinedAt should be ISO string");
    });

    await t.test("PATCH /v1/voice/presence/state updates state", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/voice/presence/state",
        headers: { cookie: cookies.join("; ") },
        payload: {
          serverId,
          channelId: voiceChannelId,
          muted: false,
          deafened: true,
        },
      });
      assert.strictEqual(res.statusCode, 204);

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/voice/presence",
        headers: { cookie: cookies.join("; ") },
        query: { serverId, channelId: voiceChannelId },
      });
      const body = JSON.parse(listRes.body);
      const me = body.items.find((m: any) => m.userId === productUserId);
      assert.strictEqual(me.muted, false);
      assert.strictEqual(me.deafened, true);
    });

    await t.test("POST /v1/voice/presence/leave removes member", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/voice/presence/leave",
        headers: { cookie: cookies.join("; ") },
        payload: { serverId, channelId: voiceChannelId },
      });
      assert.strictEqual(res.statusCode, 204);

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/voice/presence",
        headers: { cookie: cookies.join("; ") },
        query: { serverId, channelId: voiceChannelId },
      });
      const body = JSON.parse(listRes.body);
      const me = body.items.find((m: any) => m.userId === productUserId);
      assert.ok(!me, "User should be removed from presence list");
    });
  });

  // Cleanup
  await withDb(async (db) => {
    await db.query("delete from hubs where id = $1", [hubId]);
    await db.query("delete from identity_mappings where product_user_id = $1", [productUserId]);
  });
});
