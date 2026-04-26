import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping, getIdentityByProductUserId, ensureIdentityTokenValid } from "../services/identity-service.js";
import { isTokenExpired } from "../auth/oidc.js";
import { resetDb } from "./helpers/reset-db.js";
import { withMockedFetch } from "./helpers/fetch-mock.js";

// `refreshDiscordToken()` throws early if client creds are missing. Inject
// placeholders so it falls through to the mocked global fetch instead.
config.oidc.discordClientId = config.oidc.discordClientId ?? "test_discord_client";
config.oidc.discordClientSecret = config.oidc.discordClientSecret ?? "test_discord_secret";

// Pin "now" to a fixed instant in tests that reason about token expiry. Token
// times are then expressed as absolute ISO offsets from this anchor, which
// makes the assertions read directly ("token expires 1h after NOW, NOW is X,
// so it's not expired") instead of forcing the reader to mentally compute
// `Date.now() - 1000`.
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

beforeEach(async () => {
    if (pool) {
        await initDb();
        await resetDb();
    }
});

test("isTokenExpired helper", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(NOW);

    // Far in the future (1 hour from now) — well past the 5-minute buffer.
    const future = new Date(NOW + ONE_HOUR_MS).toISOString();
    assert.equal(isTokenExpired(future), false);

    // 2 minutes from now — inside the 5-minute expiry buffer.
    const nearExpiry = new Date(NOW + 2 * ONE_MINUTE_MS).toISOString();
    assert.equal(isTokenExpired(nearExpiry), true);

    // 1 second in the past — already expired.
    const past = new Date(NOW - 1000).toISOString();
    assert.equal(isTokenExpired(past), true);

    // No expiry (long-lived or handled elsewhere).
    assert.equal(isTokenExpired(null), false);
});

test("ensureIdentityTokenValid refreshes token when expired", async (t) => {
    if (!pool) {
        t.skip("DATABASE_URL not configured.");
        return;
    }

    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(NOW);

    // Token expired 1 second before NOW.
    const expiredTime = new Date(NOW - 1000).toISOString();
    const identity = await upsertIdentityMapping({
        provider: "discord",
        oidcSubject: "discord_user_refresh_test",
        email: "refresh_test@discord.com",
        preferredUsername: "refreshtester",
        avatarUrl: null,
        accessToken: "old_access_token",
        refreshToken: "old_refresh_token",
        tokenExpiresAt: expiredTime
    });

    const mockFetch = (async () => ({
        ok: true,
        json: async () => ({
            access_token: "new_access_token",
            refresh_token: "new_refresh_token",
            expires_in: 3600
        })
    } as Response)) as typeof fetch;

    await withMockedFetch(mockFetch, async () => {
        await ensureIdentityTokenValid(identity.productUserId);

        const updated = await getIdentityByProductUserId(identity.productUserId);
        assert.equal(updated?.accessToken, "new_access_token");
        assert.equal(updated?.refreshToken, "new_refresh_token");
        // The new expiry should be NOW + 3600s (the mocked refresh response's expires_in).
        assert.ok(updated?.tokenExpiresAt && new Date(updated.tokenExpiresAt).getTime() > NOW);
    });
});

test("ensureIdentityTokenValid does nothing if token is valid", async (t) => {
    if (!pool) {
        t.skip("DATABASE_URL not configured.");
        return;
    }

    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(NOW);

    // Token valid for 1 hour past NOW.
    const validTime = new Date(NOW + ONE_HOUR_MS).toISOString();
    const identity = await upsertIdentityMapping({
        provider: "discord",
        oidcSubject: "discord_user_valid_test",
        email: "valid_test@discord.com",
        preferredUsername: "validtester",
        avatarUrl: null,
        accessToken: "original_access_token",
        refreshToken: "original_refresh_token",
        tokenExpiresAt: validTime
    });

    let fetchCalled = false;
    const mockFetch = (async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await withMockedFetch(mockFetch, async () => {
        await ensureIdentityTokenValid(identity.productUserId);

        const after = await getIdentityByProductUserId(identity.productUserId);
        assert.equal(after?.accessToken, "original_access_token");
        assert.equal(fetchCalled, false);
    });
});
