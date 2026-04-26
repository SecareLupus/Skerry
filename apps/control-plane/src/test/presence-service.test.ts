import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createSessionToken } from "../auth/session.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { updateUserPresence, listUserPresence } from "../services/presence-service.js";
import { resetDb } from "./helpers/reset-db.js";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // mirrors the constant in presence-service.ts

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

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

test("user is considered online immediately after updateUserPresence", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }


  const identity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "presence_online",
    email: "presence-online@dev.local",
    preferredUsername: "presence-online",
    avatarUrl: null
  });

  await updateUserPresence(identity.productUserId);

  const presenceMap = await listUserPresence([identity.productUserId]);
  const entry = presenceMap[identity.productUserId];

  assert.ok(entry, "Presence entry should exist after update");
  assert.equal(entry.isOnline, true, "User should be online immediately after presence ping");
  assert.ok(entry.lastSeenAt, "lastSeenAt should be set");
});

test("unknown user has no presence entry", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }


  const presenceMap = await listUserPresence(["usr_unknown_never_seen"]);
  assert.equal(
    Object.keys(presenceMap).length,
    0,
    "No presence entry should exist for an unseen user"
  );
});

test("empty input to listUserPresence returns empty map without error", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  const presenceMap = await listUserPresence([]);
  assert.deepEqual(presenceMap, {}, "Empty input should return empty map");
});

test("user is marked offline after last_seen_at exceeds the 2-minute threshold", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }


  const identity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "presence_stale",
    email: "presence-stale@dev.local",
    preferredUsername: "presence-stale",
    avatarUrl: null
  });

  // Write a presence timestamp that is clearly beyond the 2-minute window
  const staleTimestamp = new Date(Date.now() - ONLINE_THRESHOLD_MS - 10_000).toISOString();
  await pool!.query(
    `insert into user_presence (product_user_id, last_seen_at)
     values ($1, $2)
     on conflict (product_user_id)
     do update set last_seen_at = $2`,
    [identity.productUserId, staleTimestamp]
  );

  const presenceMap = await listUserPresence([identity.productUserId]);
  const entry = presenceMap[identity.productUserId];

  assert.ok(entry, "Presence entry should exist");
  assert.equal(entry.isOnline, false, "User with stale presence should be offline");
  assert.equal(entry.lastSeenAt, staleTimestamp, "lastSeenAt should match the stale timestamp");
});

test("presence update is idempotent — repeated pings keep user online", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }


  const identity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "presence_idempotent",
    email: "presence-idempotent@dev.local",
    preferredUsername: "presence-idempotent",
    avatarUrl: null
  });

  await updateUserPresence(identity.productUserId);
  await updateUserPresence(identity.productUserId);
  await updateUserPresence(identity.productUserId);

  const presenceMap = await listUserPresence([identity.productUserId]);
  assert.equal(presenceMap[identity.productUserId]?.isOnline, true);
});

test("listUserPresence handles multiple users with mixed online/offline state", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }


  const onlineIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "presence_multi_online",
    email: "presence-multi-online@dev.local",
    preferredUsername: "presence-multi-online",
    avatarUrl: null
  });

  const offlineIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "presence_multi_offline",
    email: "presence-multi-offline@dev.local",
    preferredUsername: "presence-multi-offline",
    avatarUrl: null
  });

  // Bring online user up to date
  await updateUserPresence(onlineIdentity.productUserId);

  // Write a stale timestamp for the offline user
  const staleTimestamp = new Date(Date.now() - ONLINE_THRESHOLD_MS - 30_000).toISOString();
  await pool!.query(
    `insert into user_presence (product_user_id, last_seen_at)
     values ($1, $2)
     on conflict (product_user_id)
     do update set last_seen_at = $2`,
    [offlineIdentity.productUserId, staleTimestamp]
  );

  const presenceMap = await listUserPresence([
    onlineIdentity.productUserId,
    offlineIdentity.productUserId
  ]);

  assert.equal(presenceMap[onlineIdentity.productUserId]?.isOnline, true, "Recent user should be online");
  assert.equal(presenceMap[offlineIdentity.productUserId]?.isOnline, false, "Stale user should be offline");
});

test("POST /v1/me/presence endpoint updates presence and returns 204", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const identity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: "presence_route_user",
      email: "presence-route@dev.local",
      preferredUsername: "presence-route",
      avatarUrl: null
    });
    const cookie = createAuthCookie({
      productUserId: identity.productUserId,
      provider: "dev",
      oidcSubject: "presence_route_user"
    });

    // Bootstrap so requireInitialized passes
    await app.inject({
      method: "POST",
      url: "/auth/bootstrap-admin",
      headers: { cookie },
      payload: { setupToken: config.setupBootstrapToken, hubName: "Presence Route Hub" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/me/presence",
      headers: { cookie }
    });
    assert.equal(res.statusCode, 204);

    // Confirm the DB was updated
    const presenceMap = await listUserPresence([identity.productUserId]);
    assert.equal(presenceMap[identity.productUserId]?.isOnline, true);
  } finally {
    await app.close();
  }
});
