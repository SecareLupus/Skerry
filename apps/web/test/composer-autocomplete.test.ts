import test from "node:test";
import assert from "node:assert/strict";
import { detectActiveTrigger, applyCompletion } from "../lib/composer-autocomplete/triggers";
import { searchEmojis, shortcodeToGlyph } from "../lib/composer-autocomplete/emoji-index";
import { mentionItems, emojiItems } from "../lib/composer-autocomplete/providers";
import type { ChatMember } from "../context/chat-context";

function makeMember(p: Partial<ChatMember>): ChatMember {
  return {
    productUserId: "usr_a",
    displayName: "Alice",
    preferredUsername: "alice",
    isOnline: true,
    ...p
  };
}

// --- triggers ---

test("detectActiveTrigger: @ at start of input", () => {
  const t = detectActiveTrigger("@al", 3);
  assert.deepEqual(t, { kind: "mention", query: "al", startIdx: 0, endIdx: 3 });
});

test("detectActiveTrigger: @ after a space", () => {
  const t = detectActiveTrigger("hello @al", 9);
  assert.deepEqual(t, { kind: "mention", query: "al", startIdx: 6, endIdx: 9 });
});

test("detectActiveTrigger: ignores @ embedded in a word (email-like)", () => {
  const t = detectActiveTrigger("user@example.com", 16);
  assert.equal(t, null);
});

test("detectActiveTrigger: dismisses after whitespace", () => {
  const t = detectActiveTrigger("@alice ", 7);
  assert.equal(t, null);
});

test("detectActiveTrigger: : with empty query is not active", () => {
  const t = detectActiveTrigger("hello :", 7);
  assert.equal(t, null);
});

test("detectActiveTrigger: :emoji with query", () => {
  const t = detectActiveTrigger("hello :sm", 9);
  assert.deepEqual(t, { kind: "emoji", query: "sm", startIdx: 6, endIdx: 9 });
});

test("detectActiveTrigger: cursor before active char does not match", () => {
  const t = detectActiveTrigger("hello @alice", 5); // cursor at 'o' in hello
  assert.equal(t, null);
});

test("applyCompletion replaces the trigger range and reports new cursor", () => {
  const trigger = { kind: "mention" as const, query: "al", startIdx: 6, endIdx: 9 };
  const out = applyCompletion("hello @al world", trigger, "@alice ");
  assert.equal(out.text, "hello @alice  world");
  assert.equal(out.cursorPos, 6 + "@alice ".length);
});

// --- emoji index ---

test("searchEmojis: empty query returns no results", () => {
  assert.deepEqual(searchEmojis(""), []);
});

test("searchEmojis: 'smi' returns matches with glyphs", () => {
  const out = searchEmojis("smi", 5);
  assert.ok(out.length > 0, "expected at least one match for 'smi'");
  for (const e of out) {
    assert.ok(e.shortcode.length > 0);
    assert.ok(e.glyph.length > 0);
  }
});

test("shortcodeToGlyph: legacy alias :smile: still resolves", () => {
  assert.equal(shortcodeToGlyph("smile"), "🙂");
});

test("shortcodeToGlyph: unknown name returns null", () => {
  assert.equal(shortcodeToGlyph("not_a_real_emoji_name_xyz"), null);
});

// --- mention provider ---

test("mentionItems: ranks exact > prefix > substring", () => {
  const members = [
    makeMember({ productUserId: "u1", displayName: "Talia", preferredUsername: "tal" }), // substring "ali" in "Talia"
    makeMember({ productUserId: "u2", displayName: "Charlie", preferredUsername: "alistair" }), // prefix "alistair"
    makeMember({ productUserId: "u3", displayName: "Alice", preferredUsername: "ali" }) // exact handle match
  ];
  const items = mentionItems("ali", members);
  assert.equal(items[0]!.key, "u3"); // exact
  assert.equal(items[1]!.key, "u2"); // prefix
  assert.equal(items[2]!.key, "u1"); // substring
});

test("mentionItems: bridged users without preferredUsername are disabled", () => {
  const members = [
    makeMember({ productUserId: "discord_1", displayName: "Bridged Bob", preferredUsername: null, isBridged: true })
  ];
  const items = mentionItems("bo", members);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.disabled, true);
  assert.equal(items[0]!.insertText, "");
});

test("mentionItems: mentionable user inserts '@handle ' with trailing space", () => {
  const members = [makeMember({ productUserId: "u1", displayName: "Alice", preferredUsername: "alice" })];
  const items = mentionItems("ali", members);
  assert.equal(items[0]!.insertText, "@alice ");
});

// --- emoji provider ---

test("emojiItems: returns AutocompleteItems with glyph + insertText", () => {
  const items = emojiItems("rocket");
  assert.ok(items.length > 0);
  const rocket = items.find((i) => i.key === "rocket");
  assert.ok(rocket, "expected :rocket: in results");
  assert.equal(rocket!.glyph, "🚀");
  assert.equal(rocket!.insertText, ":rocket:");
});
