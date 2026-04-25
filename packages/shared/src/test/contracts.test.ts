import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SERVER_BLUEPRINT,
  MasqueradeParamsSchema,
  type AccessLevel,
  type Role,
  type ChannelType,
  type JoinPolicy,
  type ModerationActionType,
  type ReportStatus,
  type PrivilegedAction,
  type DelegationAssignmentStatus,
  type IdentityProvider
} from "../index.js";

// ---------------------------------------------------------------------------
// DEFAULT_SERVER_BLUEPRINT
// ---------------------------------------------------------------------------

test("default server blueprint includes required channels", () => {
  const names = DEFAULT_SERVER_BLUEPRINT.defaultChannels.map((channel) => channel.name);
  assert.deepEqual(names, ["announcements", "general", "voice-lounge"]);
});

test("default server blueprint includes one voice channel", () => {
  const voiceChannels = DEFAULT_SERVER_BLUEPRINT.defaultChannels.filter((channel) => channel.type === "voice");
  assert.equal(voiceChannels.length, 1);
});

// ---------------------------------------------------------------------------
// String-union exhaustive checks
//
// Each test below uses TypeScript's exhaustive `never` pattern. The runtime
// check is a sanity assertion on the array length; the *real* coverage comes
// at compile time:
//
//   - Adding a value to a union: the `default` branch's `assertNever` call
//     becomes reachable, fails to compile because the value is no longer
//     `never`.
//   - Removing a value: the explicit array literal contains a string that's
//     no longer assignable to the union, fails to compile.
//
// `pnpm typecheck` is what enforces this; `pnpm test` is the runtime smoke.
// ---------------------------------------------------------------------------

function assertNever(value: never): never {
  throw new Error(`Unhandled enum value: ${JSON.stringify(value)}`);
}

test("Contract: AccessLevel union is exhaustive", () => {
  const all: AccessLevel[] = ["hidden", "locked", "read", "chat"];
  for (const v of all) {
    switch (v) {
      case "hidden":
      case "locked":
      case "read":
      case "chat":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 4);
});

test("Contract: Role union is exhaustive", () => {
  const all: Role[] = [
    "hub_owner",
    "hub_admin",
    "space_owner",
    "space_admin",
    "space_moderator",
    "user",
    "visitor"
  ];
  for (const v of all) {
    switch (v) {
      case "hub_owner":
      case "hub_admin":
      case "space_owner":
      case "space_admin":
      case "space_moderator":
      case "user":
      case "visitor":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 7);
});

test("Contract: ChannelType union is exhaustive", () => {
  const all: ChannelType[] = ["text", "voice", "announcement", "dm", "forum", "landing"];
  for (const v of all) {
    switch (v) {
      case "text":
      case "voice":
      case "announcement":
      case "dm":
      case "forum":
      case "landing":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 6);
});

test("Contract: JoinPolicy union is exhaustive", () => {
  const all: JoinPolicy[] = ["open", "approval", "invite"];
  for (const v of all) {
    switch (v) {
      case "open":
      case "approval":
      case "invite":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 3);
});

test("Contract: ModerationActionType union is exhaustive", () => {
  const all: ModerationActionType[] = [
    "kick",
    "ban",
    "unban",
    "timeout",
    "warn",
    "strike",
    "redact_message",
    "lock_channel",
    "unlock_channel",
    "set_slow_mode",
    "set_posting_restrictions"
  ];
  for (const v of all) {
    switch (v) {
      case "kick":
      case "ban":
      case "unban":
      case "timeout":
      case "warn":
      case "strike":
      case "redact_message":
      case "lock_channel":
      case "unlock_channel":
      case "set_slow_mode":
      case "set_posting_restrictions":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 11);
});

test("Contract: ReportStatus union is exhaustive", () => {
  const all: ReportStatus[] = ["open", "triaged", "resolved", "dismissed"];
  for (const v of all) {
    switch (v) {
      case "open":
      case "triaged":
      case "resolved":
      case "dismissed":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 4);
});

test("Contract: PrivilegedAction union is exhaustive", () => {
  const all: PrivilegedAction[] = [
    "moderation.kick",
    "moderation.ban",
    "moderation.unban",
    "moderation.timeout",
    "moderation.warn",
    "moderation.strike",
    "moderation.redact",
    "channel.lock",
    "channel.unlock",
    "channel.slowmode",
    "channel.posting",
    "voice.token.issue",
    "reports.triage",
    "audit.read",
    "hub.suspend",
    "hub.delete",
    "badges.manage",
    "channel.message.read",
    "channel.message.send",
    "channel.voice.join"
  ];
  for (const v of all) {
    switch (v) {
      case "moderation.kick":
      case "moderation.ban":
      case "moderation.unban":
      case "moderation.timeout":
      case "moderation.warn":
      case "moderation.strike":
      case "moderation.redact":
      case "channel.lock":
      case "channel.unlock":
      case "channel.slowmode":
      case "channel.posting":
      case "voice.token.issue":
      case "reports.triage":
      case "audit.read":
      case "hub.suspend":
      case "hub.delete":
      case "badges.manage":
      case "channel.message.read":
      case "channel.message.send":
      case "channel.voice.join":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 20);
});

test("Contract: DelegationAssignmentStatus union is exhaustive", () => {
  const all: DelegationAssignmentStatus[] = ["active", "revoked", "expired"];
  for (const v of all) {
    switch (v) {
      case "active":
      case "revoked":
      case "expired":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 3);
});

test("Contract: IdentityProvider union is exhaustive", () => {
  const all: IdentityProvider[] = ["discord", "keycloak", "google", "github", "twitch", "dev"];
  for (const v of all) {
    switch (v) {
      case "discord":
      case "keycloak":
      case "google":
      case "github":
      case "twitch":
      case "dev":
        break;
      default:
        assertNever(v);
    }
  }
  assert.equal(all.length, 6);
});

// ---------------------------------------------------------------------------
// Zod schema runtime contract: MasqueradeParamsSchema
// ---------------------------------------------------------------------------

test("Contract: MasqueradeParamsSchema accepts a valid full payload", () => {
  const parsed = MasqueradeParamsSchema.parse({
    role: "space_moderator",
    serverId: "srv_1",
    badgeIds: ["bdg_a", "bdg_b"]
  });
  assert.equal(parsed.role, "space_moderator");
  assert.equal(parsed.serverId, "srv_1");
  assert.deepEqual(parsed.badgeIds, ["bdg_a", "bdg_b"]);
});

test("Contract: MasqueradeParamsSchema accepts minimal payload (role only)", () => {
  const parsed = MasqueradeParamsSchema.parse({ role: "user" });
  assert.equal(parsed.role, "user");
  assert.equal(parsed.serverId, undefined);
  assert.equal(parsed.badgeIds, undefined);
});

test("Contract: MasqueradeParamsSchema rejects unknown role", () => {
  assert.throws(() =>
    MasqueradeParamsSchema.parse({ role: "supreme_overlord" })
  );
});

test("Contract: MasqueradeParamsSchema rejects missing role", () => {
  assert.throws(() => MasqueradeParamsSchema.parse({ serverId: "srv_1" }));
});

test("Contract: MasqueradeParamsSchema rejects non-string badgeIds", () => {
  assert.throws(() =>
    MasqueradeParamsSchema.parse({ role: "user", badgeIds: [123, 456] })
  );
});
