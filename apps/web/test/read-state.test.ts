import test from "node:test";
import assert from "node:assert/strict";
import { firstUnreadMessageId, latestSeenOwnMessageId } from "../lib/read-state";

const VIEWER = "usr_viewer";
const PEER = "usr_peer";

function msg(id: string, author: string, ts: string) {
  return { id, authorUserId: author, createdAt: ts };
}

// --- firstUnreadMessageId ---

test("firstUnreadMessageId: returns null when lastReadAt is missing (first-time open)", () => {
  const messages = [msg("m1", PEER, "2026-05-09T12:00:00Z")];
  assert.equal(firstUnreadMessageId(messages, null, VIEWER), null);
});

test("firstUnreadMessageId: returns null when no message is newer than lastReadAt", () => {
  const messages = [msg("m1", PEER, "2026-05-09T12:00:00Z")];
  assert.equal(firstUnreadMessageId(messages, "2026-05-09T13:00:00Z", VIEWER), null);
});

test("firstUnreadMessageId: returns the first message strictly newer than lastReadAt", () => {
  const messages = [
    msg("m1", PEER, "2026-05-09T12:00:00Z"),
    msg("m2", PEER, "2026-05-09T13:00:00Z"),
    msg("m3", PEER, "2026-05-09T14:00:00Z")
  ];
  assert.equal(firstUnreadMessageId(messages, "2026-05-09T12:30:00Z", VIEWER), "m2");
});

test("firstUnreadMessageId: skips messages authored by the viewer", () => {
  const messages = [
    msg("m1", VIEWER, "2026-05-09T13:00:00Z"), // viewer's own message — skipped
    msg("m2", PEER, "2026-05-09T13:30:00Z") // first unread from peer
  ];
  assert.equal(firstUnreadMessageId(messages, "2026-05-09T12:30:00Z", VIEWER), "m2");
});

test("firstUnreadMessageId: returns null when only the viewer's own messages are newer", () => {
  const messages = [msg("m1", VIEWER, "2026-05-09T13:00:00Z")];
  assert.equal(firstUnreadMessageId(messages, "2026-05-09T12:00:00Z", VIEWER), null);
});

// --- latestSeenOwnMessageId ---

test("latestSeenOwnMessageId: returns null when peer has no read state", () => {
  const messages = [msg("m1", VIEWER, "2026-05-09T12:00:00Z")];
  assert.equal(latestSeenOwnMessageId(messages, null, VIEWER), null);
  assert.equal(latestSeenOwnMessageId(messages, undefined, VIEWER), null);
});

test("latestSeenOwnMessageId: returns the most recent own message older-or-equal to peer's lastReadAt", () => {
  const messages = [
    msg("m1", VIEWER, "2026-05-09T12:00:00Z"),
    msg("m2", PEER, "2026-05-09T12:30:00Z"),
    msg("m3", VIEWER, "2026-05-09T13:00:00Z"),
    msg("m4", VIEWER, "2026-05-09T14:00:00Z") // peer hasn't read this one
  ];
  assert.equal(latestSeenOwnMessageId(messages, "2026-05-09T13:30:00Z", VIEWER), "m3");
});

test("latestSeenOwnMessageId: returns null when none of the viewer's messages have been read yet", () => {
  const messages = [
    msg("m1", PEER, "2026-05-09T12:00:00Z"),
    msg("m2", VIEWER, "2026-05-09T14:00:00Z")
  ];
  assert.equal(latestSeenOwnMessageId(messages, "2026-05-09T13:00:00Z", VIEWER), null);
});

test("latestSeenOwnMessageId: ignores peer-authored messages even if older than the cutoff", () => {
  const messages = [
    msg("m1", PEER, "2026-05-09T12:00:00Z"),
    msg("m2", PEER, "2026-05-09T13:00:00Z")
  ];
  assert.equal(latestSeenOwnMessageId(messages, "2026-05-09T14:00:00Z", VIEWER), null);
});
