import test from "node:test";
import assert from "node:assert/strict";
import type { Channel } from "@skerry/shared";
import { chatReducer, initialState } from "../context/chat-context";

function makeDmChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chn_dm_1",
    serverId: "srv_dm",
    categoryId: null,
    name: "DM: 2 members",
    type: "dm",
    matrixRoomId: null,
    position: 0,
    isLocked: false,
    slowModeSeconds: 0,
    postingRestrictedToRoles: [],
    voiceMetadata: null,
    hubAdminAccess: "chat",
    spaceMemberAccess: "chat",
    hubMemberAccess: "chat",
    visitorAccess: "hidden",
    topic: null,
    ...overrides,
  } as Channel;
}

// Regression: after creating a new DM, the sidebar must show it without waiting
// for the 60s poll in use-dms.ts. ADD_DM_CHANNEL prepends to allDmChannels.
test("ADD_DM_CHANNEL prepends a new DM into allDmChannels", () => {
  const existing = makeDmChannel({ id: "chn_dm_old" });
  const incoming = makeDmChannel({ id: "chn_dm_new" });
  const state = { ...initialState, allDmChannels: [existing] };

  const next = chatReducer(state, { type: "ADD_DM_CHANNEL", payload: incoming });

  assert.equal(next.allDmChannels.length, 2);
  assert.equal(next.allDmChannels[0]!.id, "chn_dm_new");
  assert.equal(next.allDmChannels[1]!.id, "chn_dm_old");
});

// Regression: opening an existing DM in a new tab, then creating one with the same
// participant must not duplicate the row. The backend's getOrCreateDMChannel
// returns the same channel ID for an existing DM.
test("ADD_DM_CHANNEL dedupes by channel id and moves the entry to the front", () => {
  const a = makeDmChannel({ id: "chn_dm_a" });
  const b = makeDmChannel({ id: "chn_dm_b" });
  const state = { ...initialState, allDmChannels: [a, b] };

  const next = chatReducer(state, { type: "ADD_DM_CHANNEL", payload: b });

  assert.equal(next.allDmChannels.length, 2);
  assert.equal(next.allDmChannels[0]!.id, "chn_dm_b");
  assert.equal(next.allDmChannels[1]!.id, "chn_dm_a");
});

// Regression: when the active server is the DM server, the new DM must also
// land in state.channels so refreshChatState's validator finds it even if
// listChannels lags the just-committed write (Bug 2: routing to wrong DM).
test("ADD_DM_CHANNEL prepends to state.channels when the DM server is active", () => {
  const existingDm = makeDmChannel({ id: "chn_dm_old", serverId: "srv_dm" });
  const incoming = makeDmChannel({ id: "chn_dm_new", serverId: "srv_dm" });
  const state = {
    ...initialState,
    allDmChannels: [existingDm],
    channels: [existingDm],
  };

  const next = chatReducer(state, { type: "ADD_DM_CHANNEL", payload: incoming });

  assert.equal(next.channels[0]!.id, "chn_dm_new");
  assert.equal(next.channels.length, 2);
});

// And conversely: when a non-DM server is active, don't pollute its channel list.
test("ADD_DM_CHANNEL leaves state.channels untouched when a non-DM server is active", () => {
  const textChannel = {
    ...makeDmChannel({ id: "chn_general", serverId: "srv_other", type: "text" as any, name: "general" })
  } as Channel;
  const incoming = makeDmChannel({ id: "chn_dm_new", serverId: "srv_dm" });
  const state = { ...initialState, channels: [textChannel] };

  const next = chatReducer(state, { type: "ADD_DM_CHANNEL", payload: incoming });

  assert.equal(next.channels.length, 1);
  assert.equal(next.channels[0]!.id, "chn_general");
  assert.equal(next.allDmChannels[0]!.id, "chn_dm_new");
});
