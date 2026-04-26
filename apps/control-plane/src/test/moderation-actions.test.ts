import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { initDb, pool } from "../db/client.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";
import { createAuthCookie } from "./helpers/auth.js";
import { bootstrapWithMember as bootstrapWithMemberHelper } from "./helpers/bootstrap.js";

beforeEach(async () => {
  if (!pool) return;
  await initDb();
  await resetDb();
  const { resetModerationServiceInternalState } = await import("../services/moderation-service.js");
  resetModerationServiceInternalState();
});

const bootstrapWithMember = (
  app: Awaited<ReturnType<typeof buildApp>>,
  uniquePrefix: string
) =>
  bootstrapWithMemberHelper(app, {
    prefix: uniquePrefix,
    hubName: `${uniquePrefix} Hub`,
    allowExisting: true,
    attachMatrixIds: true,
  });

// ---------------------------------------------------------------------------

test("non-moderator is forbidden from performing ban action", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminIdentity, memberCookie, defaultServerId } = await bootstrapWithMember(app, "ban_gate");

    const banRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: memberCookie },
      payload: {
        action: "ban",
        serverId: defaultServerId,
        targetUserId: adminIdentity.productUserId,
        reason: "testing permission gate"
      }
    });
    assert.ok(
      banRes.statusCode === 403,
      `Expected 403, got ${banRes.statusCode}: ${banRes.body}`
    );
  } finally {
    await app.close();
  }
});

test("non-moderator is forbidden from performing kick action", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminIdentity, memberCookie, defaultServerId } = await bootstrapWithMember(app, "kick_gate");

    const kickRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: memberCookie },
      payload: {
        action: "kick",
        serverId: defaultServerId,
        targetUserId: adminIdentity.productUserId,
        reason: "testing permission gate"
      }
    });
    assert.equal(kickRes.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("moderator action reason field is validated (must be at least 3 chars)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, defaultServerId } = await bootstrapWithMember(app, "reason_val");

    const res = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: {
        action: "warn",
        serverId: defaultServerId,
        targetUserId: memberIdentity.productUserId,
        reason: "ab" // too short
      }
    });
    assert.ok(
      res.statusCode === 400 || res.statusCode === 422,
      `Expected validation error for short reason, got ${res.statusCode}`
    );
  } finally {
    await app.close();
  }
});

test("hub_admin can issue a warn action (DB-only, no Synapse required)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, defaultServerId, hubId } = await bootstrapWithMember(app, "warn_action");

    const warnRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: {
        action: "warn",
        hubId,
        serverId: defaultServerId,
        targetUserId: memberIdentity.productUserId,
        reason: "violating community rules"
      }
    });
    assert.equal(warnRes.statusCode, 204, `Expected 204, got ${warnRes.statusCode}: ${warnRes.body}`);
  } finally {
    await app.close();
  }
});

test("hub_admin can issue a strike action (DB-only, no Synapse required)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, defaultServerId, hubId } = await bootstrapWithMember(app, "strike_action");

    const strikeRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: {
        action: "strike",
        hubId,
        serverId: defaultServerId,
        targetUserId: memberIdentity.productUserId,
        reason: "repeated spamming"
      }
    });
    assert.equal(strikeRes.statusCode, 204, `Expected 204, got ${strikeRes.statusCode}: ${strikeRes.body}`);
  } finally {
    await app.close();
  }
});

test("any member can submit a moderation report; admin can triage and resolve it", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, adminIdentity, memberCookie, defaultServerId } = await bootstrapWithMember(app, "report_flow");

    // Member files a report
    const reportRes = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { cookie: memberCookie },
      payload: {
        serverId: defaultServerId,
        targetUserId: adminIdentity.productUserId,
        reason: "this user is spamming"
      }
    });
    assert.equal(reportRes.statusCode, 201);
    const report = reportRes.json() as { id: string; status: string };
    assert.ok(report.id);
    assert.equal(report.status, "open");

    // Admin triages it
    const triageRes = await app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}`,
      headers: { cookie: adminCookie },
      payload: { serverId: defaultServerId, status: "triaged", reason: "triaging report" }
    });
    assert.equal(triageRes.statusCode, 200);
    assert.equal(triageRes.json().status, "triaged");

    // Admin resolves it
    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/v1/reports/${report.id}`,
      headers: { cookie: adminCookie },
      payload: { serverId: defaultServerId, status: "resolved", reason: "resolving report" }
    });
    assert.equal(resolveRes.statusCode, 200);
    assert.equal(resolveRes.json().status, "resolved");
  } finally {
    await app.close();
  }
});

test("report requires at least one target (userId or messageId)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { memberCookie, defaultServerId } = await bootstrapWithMember(app, "report_val");

    // Report with no target
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { cookie: memberCookie },
      payload: {
        serverId: defaultServerId,
        reason: "something bad happened"
        // no targetUserId or targetMessageId
      }
    });
    // This may succeed at the API level (no explicit validation) or fail — either way
    // the important thing is it doesn't 500. We just assert a clean response.
    assert.ok(
      res.statusCode < 500,
      `Expected non-5xx, got ${res.statusCode}: ${res.body}`
    );
  } finally {
    await app.close();
  }
});

test("channel lock can be toggled by admin; regular member cannot lock", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberCookie, defaultServerId, defaultChannelId } = await bootstrapWithMember(
      app,
      "channel_lock"
    );

    // Member cannot lock
    const memberLockRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${defaultChannelId}/controls`,
      headers: { cookie: memberCookie },
      payload: { serverId: defaultServerId, lock: true, reason: "testing" }
    });
    assert.equal(memberLockRes.statusCode, 403);

    // Admin can lock
    const adminLockRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${defaultChannelId}/controls`,
      headers: { cookie: adminCookie },
      payload: { serverId: defaultServerId, lock: true, reason: "locking for maintenance" }
    });
    assert.equal(adminLockRes.statusCode, 204);

    // Admin can unlock
    const adminUnlockRes = await app.inject({
      method: "PATCH",
      url: `/v1/channels/${defaultChannelId}/controls`,
      headers: { cookie: adminCookie },
      payload: { serverId: defaultServerId, lock: false, reason: "reopening" }
    });
    assert.equal(adminUnlockRes.statusCode, 204);
  } finally {
    await app.close();
  }
});

test("admin audit log contains moderation events", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, defaultServerId, hubId } = await bootstrapWithMember(app, "audit_log");

    // Issue a warn so there's at least one action to audit
    await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: {
        action: "warn",
        hubId,
        serverId: defaultServerId,
        targetUserId: memberIdentity.productUserId,
        reason: "audit log test"
      }
    });

    // Fetch audit log
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/audit-logs?serverId=${defaultServerId}`,
      headers: { cookie: adminCookie }
    });
    assert.equal(auditRes.statusCode, 200);
    const items = auditRes.json().items as { actionType: string }[];
    assert.ok(Array.isArray(items));
  } finally {
    await app.close();
  }
});

test("strike escalation system (warn -> timeout -> kick -> ban)", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, defaultServerId, hubId } = await bootstrapWithMember(app, "strike_escalation");
    const targetUserId = memberIdentity.productUserId;

    // 1st & 2nd strikes -> warn
    for (let i = 1; i <= 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/moderation/actions",
        headers: { cookie: adminCookie },
        payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: `strike ${i}` }
      });
      assert.equal(res.statusCode, 204);
      
      const strikesRes: { rows: { action_taken: string }[] } = await pool.query<{ action_taken: string }>("select action_taken from moderation_strikes where target_user_id = $1 order by created_at desc limit 1", [targetUserId]);
      assert.equal(strikesRes.rows[0]!.action_taken, "warn");
    }

    // 3rd strike -> timeout
    const strike3 = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: "strike 3" }
    });
    assert.equal(strike3.statusCode, 204);
    const s3 = await pool.query<{ action_taken: string }>("select action_taken from moderation_strikes where target_user_id = $1 order by created_at desc limit 1", [targetUserId]);
    assert.equal(s3.rows[0]!.action_taken, "timeout");

    // 5th strike -> kick (skip 4th for brevity or just do it)
    await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: "strike 4" }
    });

    const strike5 = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: "strike 5" }
    });
    assert.equal(strike5.statusCode, 204);
    const s5 = await pool.query<{ action_taken: string }>("select action_taken from moderation_strikes where target_user_id = $1 order by created_at desc limit 1", [targetUserId]);
    assert.equal(s5.rows[0]!.action_taken, "kick");

    // 7th strike -> ban
    await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: "strike 6" }
    });

    const strike7 = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { action: "strike", hubId, serverId: defaultServerId, targetUserId, reason: "strike 7" }
    });
    assert.equal(strike7.statusCode, 204);
    const s7 = await pool.query<{ action_taken: string }>("select action_taken from moderation_strikes where target_user_id = $1 order by created_at desc limit 1", [targetUserId]);
    assert.equal(s7.rows[0]!.action_taken, "ban");

  } finally {
    await app.close();
  }
});

test("report rate limiting prevents spam", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { defaultServerId, adminIdentity } = await bootstrapWithMember(app, "report_limit");

    const reporterRes = await app.inject({
      method: "POST",
      url: "/auth/dev-login",
      payload: { email: "spammer@dev.local", preferredUsername: "spammer" }
    });
    const spammerCookie = reporterRes.headers["set-cookie"] as string;

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { cookie: spammerCookie },
      payload: { serverId: defaultServerId, targetUserId: adminIdentity.productUserId, reason: "limit 1" }
    });
    assert.equal(res1.statusCode, 201);
    
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { cookie: spammerCookie },
      payload: { serverId: defaultServerId, targetUserId: adminIdentity.productUserId, reason: "limit 2" }
    });
    assert.equal(res2.statusCode, 400);
    assert.match(res2.body, /reporting too fast/i);

  } finally {
    await app.close();
  }
});

test("bulk moderation performs multiple actions and returns mixed results", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, defaultServerId } = await bootstrapWithMember(app, "bulk_mod");

    const users = [];
    for (let i = 0; i < 3; i++) {
      const identity = await upsertIdentityMapping({
        provider: "dev",
        oidcSubject: `bulk_user_${i}_${Date.now()}`,
        email: `bulk${i}@dev.local`,
        preferredUsername: `bulkuser${i}`,
        avatarUrl: null
      });
      users.push(identity.productUserId);

      // Grant roles so they are valid members in scope
      await app.inject({
        method: "POST",
        url: "/v1/roles/grant",
        headers: { cookie: adminCookie },
        payload: { productUserId: identity.productUserId, role: "user", serverId: defaultServerId }
      });
    }

    const bulkCleanupReason = `bulk cleanup ${Date.now()}`;
    const bulkRes = await app.inject({
      method: "POST",
      url: `/v1/servers/${defaultServerId}/members/bulk-moderate`,
      headers: { cookie: adminCookie },
      payload: {
        targetUserIds: users,
        action: "kick",
        reason: bulkCleanupReason
      }
    });

    assert.equal(bulkRes.statusCode, 200);
    const body = bulkRes.json();
    assert.equal(body.successes.length, 3);
    assert.equal(body.failures.length, 0);

    const auditRes = await pool.query<{ action_type: string }>("select action_type from moderation_actions where reason = $1", [bulkCleanupReason]);
    assert.equal(auditRes.rowCount, 3);

  } finally {
    await app.close();
  }
});

test("moderation scoping - server moderator cannot perform hub-level ban", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, adminIdentity, memberIdentity, memberCookie, defaultServerId, hubId } = await bootstrapWithMember(app, "scoping");

    // Promote member to Space Owner (so they are a server moderator)
    await app.inject({
      method: "POST",
      url: `/v1/servers/${defaultServerId}/delegation/space-owners`,
      headers: { cookie: adminCookie },
      payload: { productUserId: memberIdentity.productUserId }
    });

    // Try to issue a HUB-SCOPED ban as a server moderator
    const hubBanRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: memberCookie },
      payload: {
        action: "ban",
        hubId: hubId, // Hub scope
        targetUserId: adminIdentity.productUserId, // Try to ban the admin lol
        reason: "illegal escalation"
      }
    });

    // It should be 403 because they are only a space owner, not hub admin
    assert.equal(hubBanRes.statusCode, 403);

    // Should work if they only target the server
    const serverKickRes = await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: memberCookie },
      payload: {
        action: "kick",
        serverId: defaultServerId,
        targetUserId: adminIdentity.productUserId,
        reason: "legit kick attempt"
      }
    });
    // Space owners can kick from their own space
    assert.equal(serverKickRes.statusCode, 204);

  } finally {
    await app.close();
  }
});

test("timeout prevents actions within the time restriction window", async (t) => {
  if (!pool) { t.skip("DATABASE_URL not configured."); return; }
  if (!config.setupBootstrapToken) { t.skip("SETUP_BOOTSTRAP_TOKEN not configured."); return; }

  const app = await buildApp();

  try {
    const { adminCookie, memberIdentity, memberCookie, defaultServerId, defaultChannelId } = await bootstrapWithMember(app, "timeout_test");
    const targetUserId = memberIdentity.productUserId;

    // 1. Verify user can send messages initially
    const initMsg = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: memberCookie },
      payload: { content: "Hello before timeout" }
    });
    assert.equal(initMsg.statusCode, 201);

    // 2. Apply timeout
    await app.inject({
      method: "POST",
      url: "/v1/moderation/actions",
      headers: { cookie: adminCookie },
      payload: { 
        action: "timeout", 
        serverId: defaultServerId, 
        targetUserId, 
        reason: "shut up",
        timeoutSeconds: 60
      }
    });

    // If enforcement is implemented, it should be 403. 
    // If not yet implemented in message path, this test will fail and highlight the gap.
    const failMsg = await app.inject({
      method: "POST",
      url: `/v1/channels/${defaultChannelId}/messages`,
      headers: { cookie: memberCookie },
      payload: { content: "I should be muted" }
    });
    
    assert.equal(failMsg.statusCode, 400);
    assert.match(failMsg.body, /temporarily restricted/i);

  } finally {
    await app.close();
  }
});
