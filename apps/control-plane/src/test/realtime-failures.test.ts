import test from "node:test";
import assert from "node:assert/strict";
import {
  subscribeToChannelMessages,
  subscribeToHubEvents,
  publishChannelMessage,
  warmChannelHubCache
} from "../services/chat-realtime.js";
import { captureEvents } from "./helpers/events.js";

function buildMessage(channelId: string, content = "test"): any {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 8)}`,
    channelId,
    actorUserId: "usr_test",
    content,
    createdAt: new Date().toISOString()
  };
}

test("Realtime Failures: multiple subscribers on same channel both receive event", async () => {
  const channelId = "chn_multi_sub";
  warmChannelHubCache(channelId, "hub_multi_sub_unused");
  const a = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));
  const b = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));

  try {
    await publishChannelMessage(buildMessage(channelId, "shared"));
    a.expect("message.created");
    b.expect("message.created");
  } finally {
    a.unsubscribe();
    b.unsubscribe();
  }
});

test("Realtime Failures: unsubscribe stops one listener but not others", async () => {
  const channelId = "chn_unsub_isolation";
  warmChannelHubCache(channelId, "hub_unsub_unused");
  const a = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));
  const b = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));

  a.unsubscribe();
  try {
    await publishChannelMessage(buildMessage(channelId, "after-a-unsub"));

    assert.equal(a.events.length, 0, "a should receive nothing after unsubscribe");
    b.expect("message.created");
  } finally {
    b.unsubscribe();
  }
});

test("Realtime Failures: re-subscribe after disconnect gets fresh events", async () => {
  const channelId = "chn_resub";
  warmChannelHubCache(channelId, "hub_resub_unused");
  const first = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));
  first.unsubscribe();

  const second = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));
  try {
    await publishChannelMessage(buildMessage(channelId, "after-resub"));
    second.expect("message.created");
  } finally {
    second.unsubscribe();
  }
});

test("Realtime Failures: events fired while no subscriber is active are lost (no buffering)", async () => {
  const channelId = "chn_no_buffer";
  warmChannelHubCache(channelId, "hub_no_buffer_unused");

  // Publish with no subscribers — event vanishes.
  await publishChannelMessage(buildMessage(channelId, "to-the-void"));

  // Subscribe AFTER the gap.
  const after = captureEvents((listener) => subscribeToChannelMessages(channelId, listener));
  try {
    assert.equal(after.events.length, 0, "events fired before subscribing must not replay");

    // New events flow normally.
    await publishChannelMessage(buildMessage(channelId, "after-gap"));
    after.expect("message.created");
    assert.equal(after.events.length, 1);
  } finally {
    after.unsubscribe();
  }
});

test("Realtime Failures: hub subscriber receives events from any channel in that hub", async () => {
  const hubId = "hub_cross_channel";
  const chanA = "chn_a_in_hub";
  const chanB = "chn_b_in_hub";
  warmChannelHubCache(chanA, hubId);
  warmChannelHubCache(chanB, hubId);

  const hubCapture = captureEvents((listener) => subscribeToHubEvents(hubId, listener));
  try {
    await publishChannelMessage(buildMessage(chanA, "msg-a"));
    await publishChannelMessage(buildMessage(chanB, "msg-b"));

    assert.equal(hubCapture.events.length, 2, "hub should receive both channels' events");
    const fromA = hubCapture.find((e) => e.payload.channelId === chanA);
    const fromB = hubCapture.find((e) => e.payload.channelId === chanB);
    assert.ok(fromA, "missing event from chan A");
    assert.ok(fromB, "missing event from chan B");
  } finally {
    hubCapture.unsubscribe();
  }
});

test("Realtime Failures: hub subscribers are isolated across hubs", async () => {
  const hubA = "hub_iso_a";
  const hubB = "hub_iso_b";
  const chanA = "chn_iso_a";
  warmChannelHubCache(chanA, hubA);

  const subA = captureEvents((listener) => subscribeToHubEvents(hubA, listener));
  const subB = captureEvents((listener) => subscribeToHubEvents(hubB, listener));
  try {
    await publishChannelMessage(buildMessage(chanA, "for-a-only"));

    subA.expect("message.created");
    assert.equal(subB.events.length, 0, "hub B must not see hub A's channel events");
  } finally {
    subA.unsubscribe();
    subB.unsubscribe();
  }
});

test("Realtime Failures: warmChannelHubCache lets publishChannelMessage fan out without DB lookup", async () => {
  const hubId = "hub_cache_test";
  const channelId = "chn_cache_test";
  warmChannelHubCache(channelId, hubId);

  const hubCapture = captureEvents((listener) => subscribeToHubEvents(hubId, listener));
  try {
    await publishChannelMessage(buildMessage(channelId, "no-db-lookup"));
    hubCapture.expect("message.created");
  } finally {
    hubCapture.unsubscribe();
  }
});
