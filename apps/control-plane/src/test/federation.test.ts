import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { isFederationHostAllowed } from "../services/federation-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("federation allowlist matching handles allowed vs denied homeservers", () => {
  const allowlist = ["matrix.creatorhub.dev", "synapse.partner.net"];
  assert.equal(isFederationHostAllowed(allowlist, "matrix.creatorhub.dev"), true);
  assert.equal(isFederationHostAllowed(allowlist, "evil.example.org"), false);
  assert.equal(isFederationHostAllowed(allowlist, "SYNAPSE.PARTNER.NET"), true);
});

test("federation + discord bridge + video controls admin workflow", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }
  if (!config.setupBootstrapToken) {
    t.skip("SETUP_BOOTSTRAP_TOKEN not configured.");
    return;
  }

  const app = await buildApp();

  try {
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "phase79_admin",
      email: "phase79-admin@dev.local",
      preferredUsername: "phase79-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "phase79_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Phase79 Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as {
      defaultServerId: string;
      defaultChannelId: string;
    };

    const contextResponse = await app.inject({
      method: "GET",
      url: "/v1/bootstrap/context",
      headers: { cookie: adminCookie }
    });
    const hubId = contextResponse.json().hubId as string;
    assert.ok(hubId);

    const federationSave = await app.inject({
      method: "PUT",
      url: `/v1/hubs/${hubId}/federation-policy`,
      headers: { cookie: adminCookie },
      payload: {
        allowlist: ["matrix.creatorhub.dev"]
      }
    });
    assert.equal(federationSave.statusCode, 200);

    const reconcile = await app.inject({
      method: "POST",
      url: `/v1/hubs/${hubId}/federation-policy/reconcile`,
      headers: { cookie: adminCookie }
    });
    assert.equal(reconcile.statusCode, 200);

    const voiceChannelResponse = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: adminCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "phase79-voice",
        type: "voice"
      }
    });
    assert.equal(voiceChannelResponse.statusCode, 201);
    const voiceChannelId = voiceChannelResponse.json().id as string;

    const videoControls = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${voiceChannelId}/video-controls`,
      headers: { cookie: adminCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        videoEnabled: true,
        maxVideoParticipants: 4
      }
    });
    assert.equal(videoControls.statusCode, 200);
    assert.equal(videoControls.json().voiceMetadata?.videoEnabled, true);

    const oauthStart = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthStart.statusCode, 302);
    const location = oauthStart.headers.location;
    assert.ok(location);
    const state = new URL(location).searchParams.get("state");
    assert.ok(state);

    const oauthCallback = await app.inject({
      method: "GET",
      url: `/auth/callback/discord?code=mock-code&state=${encodeURIComponent(state!)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthCallback.statusCode, 302);
    const callbackLocation = oauthCallback.headers.location;
    assert.ok(callbackLocation);
    const pendingSelection = new URL(callbackLocation).searchParams.get("discordPendingSelection");
    assert.ok(pendingSelection);

    const pendingResponse = await app.inject({
      method: "GET",
      url: `/v1/discord/bridge/pending/${pendingSelection}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(pendingResponse.statusCode, 200);
    const firstGuildId = pendingResponse.json().guilds[0]?.id as string;
    assert.ok(firstGuildId);

    const selectGuild = await app.inject({
      method: "POST",
      url: `/v1/discord/bridge/pending/${pendingSelection}/select`,
      headers: { cookie: adminCookie },
      payload: { guildId: firstGuildId }
    });
    assert.equal(selectGuild.statusCode, 200);

    const mappingUpsert = await app.inject({
      method: "PUT",
      url: `/v1/discord/bridge/${bootstrapBody.defaultServerId}/mappings`,
      headers: { cookie: adminCookie },
      payload: {
        guildId: firstGuildId,
        discordChannelId: "discord_chan_general",
        discordChannelName: "general",
        matrixChannelId: bootstrapBody.defaultChannelId,
        enabled: true
      }
    });
    assert.equal(mappingUpsert.statusCode, 200);

    const relay = await app.inject({
      method: "POST",
      url: `/v1/discord/bridge/${bootstrapBody.defaultServerId}/relay`,
      headers: { cookie: adminCookie },
      payload: {
        discordChannelId: "discord_chan_general",
        authorId: "discord_author_123",
        authorName: "discord-user",
        content: "hello from discord"
      }
    });
    assert.equal(relay.statusCode, 200);
    assert.equal(relay.json().relayed, true);
  } finally {
    await app.close();
  }
});
