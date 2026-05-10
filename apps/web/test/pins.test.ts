import test from "node:test";
import assert from "node:assert/strict";
import { applyPinUpdate } from "../lib/pins";

function pin(id: string, ts: string, isPinned = true) {
  return { id, isPinned, createdAt: ts };
}

test("applyPinUpdate: inserts a newly-pinned message in createdAt-desc order", () => {
  const pins = [pin("m3", "2026-05-09T15:00:00Z"), pin("m1", "2026-05-09T13:00:00Z")];
  const next = applyPinUpdate(pins, pin("m2", "2026-05-09T14:00:00Z"));
  assert.deepEqual(next.map((p) => p.id), ["m3", "m2", "m1"]);
});

test("applyPinUpdate: prepends when the new message is the newest", () => {
  const pins = [pin("m1", "2026-05-09T12:00:00Z")];
  const next = applyPinUpdate(pins, pin("m2", "2026-05-09T14:00:00Z"));
  assert.deepEqual(next.map((p) => p.id), ["m2", "m1"]);
});

test("applyPinUpdate: appends when the new message is the oldest", () => {
  const pins = [pin("m1", "2026-05-09T14:00:00Z")];
  const next = applyPinUpdate(pins, pin("m2", "2026-05-09T12:00:00Z"));
  assert.deepEqual(next.map((p) => p.id), ["m1", "m2"]);
});

test("applyPinUpdate: removes the entry when isPinned flips false", () => {
  const pins = [pin("m1", "2026-05-09T14:00:00Z"), pin("m2", "2026-05-09T12:00:00Z")];
  const next = applyPinUpdate(pins, pin("m1", "2026-05-09T14:00:00Z", false));
  assert.deepEqual(next.map((p) => p.id), ["m2"]);
});

test("applyPinUpdate: replaces in place when an already-pinned message is edited", () => {
  const original = { id: "m1", isPinned: true, createdAt: "2026-05-09T14:00:00Z", content: "old" };
  const edited = { id: "m1", isPinned: true, createdAt: "2026-05-09T14:00:00Z", content: "new" };
  const next = applyPinUpdate([original], edited);
  assert.equal(next.length, 1);
  assert.equal((next[0] as any).content, "new");
});

test("applyPinUpdate: no-op when an unpinned message arrives that wasn't in the list", () => {
  const pins = [pin("m1", "2026-05-09T14:00:00Z")];
  const next = applyPinUpdate(pins, pin("m_new", "2026-05-09T13:00:00Z", false));
  assert.deepEqual(next.map((p) => p.id), ["m1"]);
});
