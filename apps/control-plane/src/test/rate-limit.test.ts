import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

// Builds a minimal Fastify app that mirrors the rate-limit registration
// from app.ts but with a configurable, tiny `max` so tests can actually trip
// the limiter without sending hundreds of requests.
async function buildLimitedApp(opts: { max: number }) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, {
    max: opts.max,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const forwardedFor = request.headers["x-forwarded-for"];
      return (typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0]?.trim()
        : request.ip) || request.id;
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      code: "rate_limited",
      message: `Rate limit exceeded. Retry in ${context.after}.`,
      requestId: request.id
    })
  });
  app.get("/ping", async () => ({ ok: true }));
  return app;
}

test("Rate Limit: request beyond max returns 429 with structured body", async () => {
  const app = await buildLimitedApp({ max: 2 });
  try {
    const r1 = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(r1.statusCode, 200, "first request should pass");
    const r2 = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(r2.statusCode, 200, "second request should pass");
    const r3 = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(r3.statusCode, 429, "third request should be rate limited");

    const body = r3.json();
    assert.equal(body.statusCode, 429);
    assert.equal(body.error, "Too Many Requests");
    assert.equal(body.code, "rate_limited");
    assert.match(body.message, /Rate limit exceeded/);
    assert.match(body.message, /Retry in/);
    assert.ok(body.requestId, "requestId must be present in error body");
  } finally {
    await app.close();
  }
});

test("Rate Limit: x-ratelimit-* headers present on successful responses", async () => {
  const app = await buildLimitedApp({ max: 5 });
  try {
    const r = await app.inject({ method: "GET", url: "/ping" });
    assert.equal(r.statusCode, 200);
    assert.ok(r.headers["x-ratelimit-limit"], "x-ratelimit-limit header missing");
    assert.ok(r.headers["x-ratelimit-remaining"], "x-ratelimit-remaining header missing");
    assert.ok(r.headers["x-ratelimit-reset"], "x-ratelimit-reset header missing");
    assert.equal(String(r.headers["x-ratelimit-limit"]), "5");
    assert.equal(String(r.headers["x-ratelimit-remaining"]), "4");
  } finally {
    await app.close();
  }
});

test("Rate Limit: different x-forwarded-for IPs get independent buckets", async () => {
  const app = await buildLimitedApp({ max: 2 });
  try {
    // Burn through IP-A's budget.
    const a1 = await app.inject({ method: "GET", url: "/ping", headers: { "x-forwarded-for": "10.0.0.1" } });
    const a2 = await app.inject({ method: "GET", url: "/ping", headers: { "x-forwarded-for": "10.0.0.1" } });
    const a3 = await app.inject({ method: "GET", url: "/ping", headers: { "x-forwarded-for": "10.0.0.1" } });
    assert.equal(a1.statusCode, 200);
    assert.equal(a2.statusCode, 200);
    assert.equal(a3.statusCode, 429, "IP-A's third request must be rate limited");

    // IP-B should still have its own fresh bucket.
    const b1 = await app.inject({ method: "GET", url: "/ping", headers: { "x-forwarded-for": "10.0.0.2" } });
    assert.equal(b1.statusCode, 200, "IP-B must have an independent bucket");
  } finally {
    await app.close();
  }
});

test("Rate Limit: x-forwarded-for first IP wins when chain is present", async () => {
  const app = await buildLimitedApp({ max: 1 });
  try {
    // First request as the leading IP.
    const r1 = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "10.0.0.5, 192.168.1.1, 172.16.0.1" }
    });
    assert.equal(r1.statusCode, 200);

    // Same leading IP, different downstream chain — must hit the same bucket.
    const r2 = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "10.0.0.5, 192.168.99.99" }
    });
    assert.equal(r2.statusCode, 429, "same leading IP must share the bucket regardless of chain suffix");
  } finally {
    await app.close();
  }
});
