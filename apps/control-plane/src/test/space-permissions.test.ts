import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("space owner can rename their own space and manage categories", async (t) => {
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
      oidcSubject: "space_perm_admin",
      email: "space-perm-admin@dev.local",
      preferredUsername: "space-perm-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_perm_admin"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Permission Hub"
      }
    });
    assert.equal(bootstrapResponse.statusCode, 201);
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };

    const ownerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "space_perm_owner",
      email: "space-perm-owner@dev.local",
      preferredUsername: "space-perm-owner",
      avatarUrl: null
    });
    const ownerCookie = createAuthCookie({
      productUserId: ownerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "space_perm_owner"
    });

    // Delegate space ownership
    await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: { productUserId: ownerIdentity.productUserId }
    });

    // 1. Verify Space Owner can rename the space
    const renameResponse = await app.inject({
      method: "PATCH",
      url: `/v1/servers/${bootstrapBody.defaultServerId}`,
      headers: { cookie: ownerCookie },
      payload: { name: "Renamed by Space Owner" }
    });
    assert.equal(renameResponse.statusCode, 200);
    assert.equal(renameResponse.json().name, "Renamed by Space Owner");

    // 2. Verify Space Owner can create and delete a category
    const createCatResponse = await app.inject({
      method: "POST",
      url: "/v1/categories",
      headers: { cookie: ownerCookie },
      payload: {
        serverId: bootstrapBody.defaultServerId,
        name: "Test Category"
      }
    });
    assert.equal(createCatResponse.statusCode, 201);
    const categoryId = createCatResponse.json().id as string;

    const deleteCatResponse = await app.inject({
      method: "DELETE",
      url: `/v1/categories/${categoryId}?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(deleteCatResponse.statusCode, 204);

    // 3. Verify role bindings include the space_owner role
    const rolesResponse = await app.inject({
      method: "GET",
      url: "/v1/me/roles",
      headers: { cookie: ownerCookie }
    });
    assert.equal(rolesResponse.statusCode, 200);
    const hasOwnerRole = rolesResponse.json().items.some(
      (item: { role: string; serverId: string }) =>
        item.role === "space_owner" && item.serverId === bootstrapBody.defaultServerId
    );
    assert.ok(hasOwnerRole, "Space Owner role should be present in roles list");

  } finally {
    await app.close();
  }
});

test("Discord bridge permissions respect Hub setting for Space Owners", async (t) => {
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
      oidcSubject: "bridge_adm",
      email: "bridge-admin@dev.local",
      preferredUsername: "bridge-admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "bridge_adm"
    });

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: {
        setupToken: config.setupBootstrapToken,
        hubName: "Bridge Test Hub"
      }
    });
    const bootstrapBody = bootstrapResponse.json() as { defaultServerId: string };
    const hubId = (await app.inject({ method: "GET", url: "/v1/bootstrap/context", headers: { cookie: adminCookie } })).json().hubId as string;

    const ownerIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "bridge_owner",
      email: "bridge-owner@dev.local",
      preferredUsername: "bridge-owner",
      avatarUrl: null
    });
    const ownerCookie = createAuthCookie({
      productUserId: ownerIdentity.productUserId,
      provider: "dev",
      oidcSubject: "bridge_owner"
    });

    // Make bridge_owner a space_owner
    await app.inject({
      method: "POST",
      url: `/v1/servers/${bootstrapBody.defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: { productUserId: ownerIdentity.productUserId }
    });

    // 1. By default, Space Owner CAN start bridge
    const oauthStartAllowed = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(oauthStartAllowed.statusCode, 302);

    // 2. Disable Space bridge at Hub level
    await app.inject({
      method: "PATCH",
      url: `/v1/hubs/${hubId}/settings`,
      headers: { cookie: adminCookie },
      payload: { allowSpaceDiscordBridge: false }
    });

    // 3. Space Owner should now be FORBIDDEN
    const oauthStartDisabled = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: ownerCookie }
    });
    assert.equal(oauthStartDisabled.statusCode, 403);

    // 4. Hub Admin should STILL be allowed
    const oauthStartAdmin = await app.inject({
      method: "GET",
      url: `/v1/discord/oauth/start?serverId=${encodeURIComponent(bootstrapBody.defaultServerId)}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(oauthStartAdmin.statusCode, 302);

  } finally {
    await app.close();
  }
});

test("hub admin can see all channels in a server even if they are not a server member", async () => {
  const app = await buildApp();
  try {
    // 1. Setup Hub Admin
    const adminIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "hub_admin_sub",
      email: "admin@dev.local",
      preferredUsername: "admin",
      avatarUrl: null
    });
    const adminCookie = createAuthCookie({
      productUserId: adminIdentity.productUserId,
      provider: "dev",
      oidcSubject: "hub_admin_sub"
    });

    // 2. Bootstrap Hub
    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie: adminCookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Test Hub" }
    });
    const bootstrapBody = bootstrapResponse.json() as { hubId: string; defaultServerId: string };
    const hubId = bootstrapBody.hubId;

    // 3. Setup another user who creates another server
    const otherIdentity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "other_sub",
      email: "other@dev.local",
      preferredUsername: "other",
      avatarUrl: null
    });
    const otherCookie = createAuthCookie({
      productUserId: otherIdentity.productUserId,
      provider: "dev",
      oidcSubject: "other_sub"
    });

    // Grant other user hub_admin role so they can create a server in this hub
    await pool?.query(
      "insert into role_bindings (id, product_user_id, role, hub_id) values ($1, $2, 'hub_admin', $3)",
      ["rb-other-hub-admin", otherIdentity.productUserId, hubId]
    );

    // Create a new server owned by "other"
    const createServerResponse = await app.inject({
      method: "POST",
      url: "/v1/servers",
      headers: { cookie: otherCookie },
      payload: { hubId, name: "Other Server", visitorAccess: 'hidden' }
    });
    const otherServerId = createServerResponse.json().id;

    // Create a private channel in that server
    const createChannelResponse = await app.inject({
      method: "POST",
      url: "/v1/channels",
      headers: { cookie: otherCookie },
      payload: { serverId: otherServerId, name: "secret-channel", type: "text", visitorAccess: 'hidden' }
    });
    const secretChannelId = createChannelResponse.json().id;

    // 4. Hub Admin (not a member of 'Other Server') should be able to list channels
    const listChannelsResponse = await app.inject({
      method: "GET",
      url: `/v1/servers/${otherServerId}/channels`,
      headers: { cookie: adminCookie }
    });

    assert.equal(listChannelsResponse.statusCode, 200);
    const channels = (listChannelsResponse.json() as { items: { id: string }[] }).items;
    const hasSecret = channels.some((c) => c.id === secretChannelId);
    assert.ok(hasSecret, "Hub Admin should see the secret channel");

  } finally {
    await app.close();
  }
});
