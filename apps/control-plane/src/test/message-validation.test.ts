import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { resetDb } from "./helpers/reset-db.js";
import { bootstrap as bootstrapHub } from "./helpers/bootstrap.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

const bootstrap = (app: Awaited<ReturnType<typeof buildApp>>) =>
  bootstrapHub(app, { prefix: "msgval", hubName: "Message Validation Hub" });

// ---------------------------------------------------------------------------
// Content length validation
// ---------------------------------------------------------------------------

test("message content length is validated at the route boundary", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Empty content
    const emptyRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "" }
    });
    assert.ok(
      emptyRes.statusCode === 400 || emptyRes.statusCode === 422,
      `Expected validation error for empty content, got ${emptyRes.statusCode}`
    );

    // Content over 2000 characters
    const tooLongRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "x".repeat(2001) }
    });
    assert.ok(
      tooLongRes.statusCode === 400 || tooLongRes.statusCode === 422,
      `Expected validation error for oversized content, got ${tooLongRes.statusCode}`
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// mediaUrls / attachments
// ---------------------------------------------------------------------------

test("messages can be sent with mediaUrls and attachments are stored", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Send a message with mediaUrls (as the client does after uploading)
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: {
        content: "Here is an image",
        mediaUrls: ["https://example.com/photo.png"]
      }
    });
    assert.equal(sendRes.statusCode, 201, `Expected 201, got ${sendRes.statusCode}: ${sendRes.body}`);
    const message = sendRes.json() as { id: string; attachments?: { url: string; contentType: string; filename: string }[] };
    assert.ok(message.id, "Message should have an id");
    assert.ok(Array.isArray(message.attachments) && message.attachments.length === 1, "Message should have one attachment");
    assert.equal(message.attachments![0]!.url, "https://example.com/photo.png");
    // Content type should be inferred from extension, not hardcoded as image/jpeg
    assert.equal(message.attachments![0]!.contentType, "image/png", "Content type should be inferred as image/png for .png extension");

    // Confirm attachment is persisted and returned in listing
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages?limit=20`,
      headers: { cookie: adminCookie }
    });
    assert.equal(listRes.statusCode, 200);
    const items = listRes.json().items as { id: string; attachments?: { url: string }[] }[];
    const found = items.find((m) => m.id === message.id);
    assert.ok(found, "Sent message should appear in listing");
    assert.ok(
      Array.isArray(found?.attachments) && found!.attachments!.some((a) => a.url === "https://example.com/photo.png"),
      "Attachment URL should appear in listing"
    );
  } finally {
    await app.close();
  }
});

test("mediaUrls content type is inferred correctly for different file extensions", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const cases: [string, string][] = [
      ["https://cdn.example.com/img.jpeg", "image/jpeg"],
      ["https://cdn.example.com/img.jpg", "image/jpeg"],
      ["https://cdn.example.com/img.png", "image/png"],
      ["https://cdn.example.com/img.gif", "image/gif"],
      ["https://cdn.example.com/img.webp", "image/webp"],
      ["https://cdn.example.com/img.svg", "image/svg+xml"],
    ];

    for (const [url, expectedType] of cases) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/channels/${defaultChannelId}/messages`,
        headers: { cookie: adminCookie },
        payload: { content: `test image ${url}`, mediaUrls: [url] }
      });
      assert.equal(res.statusCode, 201, `Expected 201 for ${url}, got ${res.statusCode}`);
      const attachments = res.json().attachments as { url: string; contentType: string }[];
      assert.ok(attachments?.length === 1, `Expected 1 attachment for ${url}`);
      assert.equal(attachments[0]!.contentType, expectedType, `Expected ${expectedType} for ${url}`);
    }
  } finally {
    await app.close();
  }
});

test("mediaUrls array exceeding 8 entries is rejected", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const tooManyUrls = Array.from({ length: 9 }, (_, i) => `https://example.com/img${i}.png`);
    const res = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "too many attachments", mediaUrls: tooManyUrls }
    });
    assert.ok(
      res.statusCode === 400 || res.statusCode === 422,
      `Expected 400/422 for too many mediaUrls, got ${res.statusCode}`
    );
  } finally {
    await app.close();
  }
});

test("message with mediaUrls is rejected when URL is not valid", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "bad url", mediaUrls: ["not-a-valid-url"] }
    });
    assert.ok(
      res.statusCode === 400 || res.statusCode === 422,
      `Expected 400/422 for invalid URL in mediaUrls, got ${res.statusCode}: ${res.body}`
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

test("message full-text search returns matching messages and excludes non-matching", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultChannelId } = await bootstrap(app);

    // Send two messages with distinguishable content
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "The quick brown fox" }
    });
    await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: "Completely unrelated content here" }
    });

    const searchRes = await app.inject({
      method: "GET",
      url: `/v1/channels/${defaultChannelId}/messages/search?q=quick+brown+fox`,
      headers: { cookie: adminCookie }
    });
    assert.equal(searchRes.statusCode, 200);
    const results = searchRes.json().items as { content: string }[];
    assert.ok(
      results.some((m) => m.content.includes("quick brown fox")),
      "Search should return the matching message"
    );
    assert.ok(
      !results.some((m) => m.content.includes("unrelated")),
      "Search should not return non-matching messages"
    );
  } finally {
    await app.close();
  }
});
