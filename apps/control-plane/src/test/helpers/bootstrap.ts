import assert from "node:assert/strict";
import type { buildApp } from "../../app.js";
import { config } from "../../config.js";
import { pool } from "../../db/client.js";
import { upsertIdentityMapping } from "../../services/identity-service.js";
import { createAuthCookie } from "./auth.js";

type App = Awaited<ReturnType<typeof buildApp>>;

export interface BootstrapOptions {
  /** Prefix used to build unique oidc subjects / emails / hub names. */
  prefix?: string;
  /** Override the hub name. Defaults to `${prefix} Hub`. */
  hubName?: string;
  /** Accept 409 "already bootstrapped" as success. */
  allowExisting?: boolean;
}

export interface BootstrapResult {
  adminIdentity: Awaited<ReturnType<typeof upsertIdentityMapping>>;
  adminCookie: string;
  defaultServerId: string;
  defaultChannelId: string;
  hubId: string;
}

export async function bootstrap(
  app: App,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const prefix = options.prefix ?? "test";
  const hubName = options.hubName ?? `${prefix} Hub`;

  const adminIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: `${prefix}_admin`,
    email: `${prefix}-admin@dev.local`,
    preferredUsername: `${prefix}-admin`,
    avatarUrl: null,
  });
  const adminCookie = createAuthCookie({
    productUserId: adminIdentity.productUserId,
    provider: "dev",
    oidcSubject: `${prefix}_admin`,
  });

  const bsRes = await app.inject({
    method: "POST",
    url: "/auth/bootstrap-admin",
    headers: { cookie: adminCookie },
    payload: { setupToken: config.setupBootstrapToken, hubName },
  });
  if (options.allowExisting) {
    if (bsRes.statusCode !== 201 && bsRes.statusCode !== 409) {
      assert.fail(`Bootstrap failed with ${bsRes.statusCode}: ${bsRes.body}`);
    }
  } else {
    assert.equal(bsRes.statusCode, 201);
  }
  const { defaultServerId, defaultChannelId } = bsRes.json() as {
    defaultServerId: string;
    defaultChannelId: string;
  };

  const ctxRes = await app.inject({
    method: "GET",
    url: "/v1/bootstrap/context",
    headers: { cookie: adminCookie },
  });
  const hubId = ctxRes.json().hubId as string;

  return { adminIdentity, adminCookie, defaultServerId, defaultChannelId, hubId };
}

export interface BootstrapWithMemberResult extends BootstrapResult {
  memberIdentity: Awaited<ReturnType<typeof upsertIdentityMapping>>;
  memberCookie: string;
}

/**
 * Same as `bootstrap` but also creates a second "member" identity granted the
 * `user` role on the default server. Useful for permission-gate tests.
 */
export async function bootstrapWithMember(
  app: App,
  options: BootstrapOptions & { attachMatrixIds?: boolean } = {}
): Promise<BootstrapWithMemberResult> {
  const prefix = options.prefix ?? "test";
  const base = await bootstrap(app, { ...options, allowExisting: options.allowExisting ?? true });

  const memberIdentity = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: `${prefix}_member`,
    email: `${prefix}-member@dev.local`,
    preferredUsername: `${prefix}-member`,
    avatarUrl: null,
  });
  const memberCookie = createAuthCookie({
    productUserId: memberIdentity.productUserId,
    provider: "dev",
    oidcSubject: `${prefix}_member`,
  });

  await app.inject({
    method: "POST",
    url: "/v1/roles/grant",
    headers: { cookie: base.adminCookie },
    payload: {
      productUserId: memberIdentity.productUserId,
      role: "user",
      serverId: base.defaultServerId,
    },
  });

  if (options.attachMatrixIds && pool) {
    await pool.query("update servers set matrix_space_id = $1 where id = $2", [
      "!testspace:dev.local",
      base.defaultServerId,
    ]);
    await pool.query("update channels set matrix_room_id = $1 where id = $2", [
      "!testroom:dev.local",
      base.defaultChannelId,
    ]);
  }

  return { ...base, memberIdentity, memberCookie };
}
