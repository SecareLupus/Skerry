import test from "node:test";
import assert from "node:assert/strict";
import { encodeDiscordReactionEmoji } from "../services/discord-bot-client.js";

// Regression tests for Phase 27 Item 5: Discord custom-emoji reactions are
// stored in tag form (`<:name:id>` / `<a:name:id>`) so the frontend can
// resolve the CDN URL without a DB lookup. Unicode emoji pass through.

test("encodes a static custom emoji as <:name:id>", () => {
  const out = encodeDiscordReactionEmoji({ id: "123456789", name: "myEmoji", animated: false });
  assert.equal(out, "<:myEmoji:123456789>");
});

test("encodes an animated custom emoji as <a:name:id>", () => {
  const out = encodeDiscordReactionEmoji({ id: "987654321", name: "spin", animated: true });
  assert.equal(out, "<a:spin:987654321>");
});

test("passes Unicode emoji through unchanged", () => {
  // Discord delivers unicode reactions with id=null and name=the codepoint.
  const out = encodeDiscordReactionEmoji({ id: null, name: "👍", animated: false });
  assert.equal(out, "👍");
});

test("returns null when emoji has no name", () => {
  const out = encodeDiscordReactionEmoji({ id: null, name: null, animated: null });
  assert.equal(out, null);
});

test("treats animated=null on a custom emoji as static", () => {
  const out = encodeDiscordReactionEmoji({ id: "555", name: "weird", animated: null });
  assert.equal(out, "<:weird:555>");
});
