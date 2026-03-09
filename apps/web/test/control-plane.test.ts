import test from "node:test";
import assert from "node:assert/strict";
import {
  ControlPlaneApiError,
  discordBridgeStartUrl,
  fetchAllowedActions,
  providerLinkUrl,
  providerLoginUrl
} from "../lib/control-plane";

test("providerLoginUrl builds Discord auth route", () => {
  assert.equal(providerLoginUrl("discord"), "http://control-plane:4000/auth/login/discord");
});

test("providerLoginUrl builds developer login route", () => {
  assert.equal(providerLoginUrl("dev", "alice"), "http://control-plane:4000/auth/dev-login?username=alice");
});

test("providerLinkUrl builds OAuth linking route", () => {
  assert.equal(providerLinkUrl("google"), "http://control-plane:4000/auth/link/google");
});

test("discordBridgeStartUrl builds bridge OAuth route", () => {
  assert.equal(
    discordBridgeStartUrl("hub_123"),
    "http://control-plane:4000/v1/discord/oauth/start?serverId=hub_123"
  );
});

test("api errors include correlation request id when available", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        message: "Forbidden",
        code: "forbidden_scope",
        requestId: "req_test_123"
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", "x-request-id": "req_header_ignored" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      async () => {
        await fetchAllowedActions("srv_test");
      },
      (error) => {
        assert.ok(error instanceof ControlPlaneApiError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, "forbidden_scope");
        assert.equal(error.requestId, "req_test_123");
        assert.match(error.message, /request req_test_123/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
