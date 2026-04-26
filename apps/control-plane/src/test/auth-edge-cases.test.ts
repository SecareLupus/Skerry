import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import {
  createSessionToken,
  verifyMasqueradeToken,
  type SessionPayload
} from "../auth/session.js";
import {
  upsertIdentityMapping,
  ensureIdentityTokenValid,
  getIdentityByProductUserId
} from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { withMockedFetch } from "./helpers/fetch-mock.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

function buildPayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    productUserId: "usr_test",
    provider: "dev",
    oidcSubject: "sub_test",
    expiresAt: Date.now() + 60_000,
    ...overrides
  };
}

// ===========================================================================
// Session token verification — unit, no DB required
// ===========================================================================

function splitToken(token: string): { encoded: string; sig: string } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`expected token "encoded.sig", got: ${token}`);
  }
  return { encoded: parts[0], sig: parts[1] };
}

test("Auth Edge: tampered signature returns null", () => {
  const { encoded, sig } = splitToken(createSessionToken(buildPayload()));
  // Flip the last character to force HMAC mismatch.
  const swapped = sig.slice(-1) === "A" ? "B" : "A";
  const tampered = `${encoded}.${sig.slice(0, -1)}${swapped}`;
  assert.equal(verifyMasqueradeToken(tampered), null);
});

test("Auth Edge: tampered payload (re-encoded with different content) returns null", () => {
  const { sig } = splitToken(createSessionToken(buildPayload({ productUserId: "usr_alice" })));
  const evilEncoded = Buffer.from(
    JSON.stringify(buildPayload({ productUserId: "usr_eve" }))
  ).toString("base64url");
  const tampered = `${evilEncoded}.${sig}`;
  assert.equal(verifyMasqueradeToken(tampered), null);
});

test("Auth Edge: expired token returns null", () => {
  const expired = createSessionToken(buildPayload({ expiresAt: Date.now() - 1000 }));
  assert.equal(verifyMasqueradeToken(expired), null);
});

test("Auth Edge: malformed token without delimiter returns null", () => {
  assert.equal(verifyMasqueradeToken("not-a-real-token"), null);
  assert.equal(verifyMasqueradeToken(""), null);
  assert.equal(verifyMasqueradeToken("only-one-part"), null);
});

test("Auth Edge: garbled (non-JSON) payload returns null instead of throwing", () => {
  // Forge a token with a valid HMAC over a non-JSON encoded payload. This is
  // the regression case for verify() unwrapping JSON.parse — without the
  // try/catch, this throws SyntaxError out of getSession, which surfaces as
  // a 500 instead of a 401.
  const encoded = Buffer.from("not-json{").toString("base64url");
  const sig = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(encoded)
    .digest("base64url");
  const token = `${encoded}.${sig}`;

  assert.doesNotThrow(() => verifyMasqueradeToken(token));
  assert.equal(verifyMasqueradeToken(token), null);
});

// ===========================================================================
// Auth middleware — HTTP integration via app.inject
// ===========================================================================

test("Auth Edge: tampered session cookie surfaces as 401, not 500", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const app = await buildApp();
  try {
    const { encoded, sig } = splitToken(createSessionToken(buildPayload()));
    const tampered = `${encoded}.${sig.slice(0, -1)}X`;

    const response = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: { cookie: `skerry_session=${tampered}` }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "unauthorized");
  } finally {
    await app.close();
  }
});

test("Auth Edge: expired session cookie returns 401", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  const app = await buildApp();
  try {
    const expired = createSessionToken(buildPayload({ expiresAt: Date.now() - 1000 }));

    const response = await app.inject({
      method: "GET",
      url: "/auth/session/me",
      headers: { cookie: `skerry_session=${expired}` }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "unauthorized");
  } finally {
    await app.close();
  }
});

// ===========================================================================
// OAuth refresh resilience — provider failure must not crash or corrupt state
// ===========================================================================

test("Auth Edge: concurrent ensureIdentityTokenValid calls share one OAuth refresh", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  config.oidc.discordClientId = config.oidc.discordClientId ?? "test_discord_client";
  config.oidc.discordClientSecret = config.oidc.discordClientSecret ?? "test_discord_secret";

  const expiredTime = new Date(Date.now() - 1000).toISOString();
  const identity = await upsertIdentityMapping({
    provider: "discord",
    oidcSubject: "discord_user_concurrent",
    email: "concurrent@discord.com",
    preferredUsername: "concurrent",
    avatarUrl: null,
    accessToken: "old_access",
    refreshToken: "old_refresh",
    tokenExpiresAt: expiredTime
  });

  // Count only OAuth token-refresh calls. upsertIdentityMapping triggers
  // additional Synapse fetches (registerUser + setUserDisplayName) that we
  // don't care about here.
  let oauthRefreshCount = 0;
  const mockFetch = (async (url: string | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const isOauthRefresh = urlStr.includes("discord") && urlStr.includes("token");
    if (isOauthRefresh) {
      oauthRefreshCount += 1;
      // Yield to the event loop so a concurrent call has a chance to enter
      // the critical section before this one resolves. Without single-flight
      // protection, both calls fire fetch.
      await new Promise((resolve) => setImmediate(resolve));
      return {
        ok: true,
        json: async () => ({
          access_token: "new_access",
          refresh_token: "new_refresh",
          expires_in: 3600
        })
      } as Response;
    }
    // Synapse / other side-effect calls — return benign success.
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => ""
    } as Response;
  }) as typeof fetch;

  await withMockedFetch(mockFetch, async () => {
    await Promise.all([
      ensureIdentityTokenValid(identity.productUserId),
      ensureIdentityTokenValid(identity.productUserId)
    ]);
  });

  assert.equal(
    oauthRefreshCount,
    1,
    "concurrent refreshes for the same identity must share a single OAuth call"
  );

  // And the identity should be in the post-refresh state, not corrupted.
  const after = await getIdentityByProductUserId(identity.productUserId);
  assert.equal(after?.accessToken, "new_access");
  assert.equal(after?.refreshToken, "new_refresh");
});

test("Auth Edge: ensureIdentityTokenValid handles OAuth provider 500 without crashing", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }

  // refreshDiscordToken bails early without creds. Inject placeholders so
  // the code path falls through to the mocked fetch.
  config.oidc.discordClientId = config.oidc.discordClientId ?? "test_discord_client";
  config.oidc.discordClientSecret = config.oidc.discordClientSecret ?? "test_discord_secret";

  const expiredTime = new Date(Date.now() - 1000).toISOString();
  const identity = await upsertIdentityMapping({
    provider: "discord",
    oidcSubject: "discord_user_500",
    email: "test_500@discord.com",
    preferredUsername: "tester500",
    avatarUrl: null,
    accessToken: "old_access",
    refreshToken: "old_refresh",
    tokenExpiresAt: expiredTime
  });

  const mockFetch = (async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "internal_server_error" })
  } as Response)) as typeof fetch;

  await withMockedFetch(mockFetch, async () => {
    // Must not throw — failure is logged, not propagated
    await ensureIdentityTokenValid(identity.productUserId);

    // Identity record's tokens must remain unchanged after a failed refresh
    const after = await getIdentityByProductUserId(identity.productUserId);
    assert.equal(after?.accessToken, "old_access", "access token must remain unchanged after refresh failure");
    assert.equal(after?.refreshToken, "old_refresh", "refresh token must remain unchanged after refresh failure");
  });
});
