import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

test("list channels includes forums and threads in mock mode", async () => {
    const app = await buildApp();
    // We need a server with a connection. In mock mode, many things are bypassed or return defaults.
    // The endpoint is GET /discord-bridge/:serverId/channels

    // Note: This requires a valid serverId from the DB. 
    // For a smoke test, we'll just check if the service function returns what we expect.
    const { listDiscordGuildChannels } = await import("../services/discord-bridge-service.js");
    const channels = await listDiscordGuildChannels("any-guild-id");

    const forum = channels.find(c => c.id === "mock_forum_1");
    const thread = channels.find(c => c.id === "mock_thread_1");

    assert.ok(forum, "Should find mock forum");
    assert.ok(thread, "Should find mock thread");
    assert.ok(forum.name.startsWith("[Forum]"), "Forum should have prefix");
    assert.ok(thread.name.startsWith("[Thread]"), "Thread should have prefix");

    await app.close();
});
