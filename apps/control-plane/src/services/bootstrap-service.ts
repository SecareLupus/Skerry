import crypto from "node:crypto";
import { withDb } from "../db/client.js";

const BOOTSTRAP_LOCK_ID = 49092301;

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export interface BootstrapStatus {
  initialized: boolean;
  bootstrapCompletedAt: string | null;
  bootstrapAdminUserId: string | null;
  bootstrapHubId: string | null;
  defaultServerId: string | null;
  defaultChannelId: string | null;
}

interface PlatformSettingsRow {
  id: string;
  bootstrap_completed_at: string | null;
  bootstrap_admin_user_id: string | null;
  bootstrap_hub_id: string | null;
  default_server_id: string | null;
  default_channel_id: string | null;
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  return withDb(async (db) => {
    await db.query("insert into platform_settings (id) values ('global') on conflict (id) do nothing");
    const row = await db.query<PlatformSettingsRow>(
      "select * from platform_settings where id = 'global' limit 1"
    );

    const settings = row.rows[0] ?? null;
    return {
      initialized: Boolean(settings?.bootstrap_completed_at),
      bootstrapCompletedAt: settings?.bootstrap_completed_at ?? null,
      bootstrapAdminUserId: settings?.bootstrap_admin_user_id ?? null,
      bootstrapHubId: settings?.bootstrap_hub_id ?? null,
      defaultServerId: settings?.default_server_id ?? null,
      defaultChannelId: settings?.default_channel_id ?? null
    };
  });
}

export async function bootstrapAdmin(input: {
  productUserId: string;
  setupToken: string;
  expectedSetupToken: string;
  hubName: string;
}): Promise<{ hubId: string; defaultServerId: string; defaultChannelId: string }> {
  if (!input.expectedSetupToken) {
    throw new Error("Bootstrap token is not configured.");
  }

  if (input.setupToken !== input.expectedSetupToken) {
    throw new Error("Invalid bootstrap token.");
  }

  return withDb(async (db) => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK_ID]);
      await db.query("insert into platform_settings (id) values ('global') on conflict (id) do nothing");

      const settings = await db.query<PlatformSettingsRow>(
        "select * from platform_settings where id = 'global' for update"
      );
      const current = settings.rows[0];
      if (!current) {
        throw new Error("Platform settings row missing.");
      }

      if (current.bootstrap_completed_at) {
        throw new Error("Platform bootstrap already completed.");
      }

      const hubId = randomId("hub");
      const { config } = await import("../config.js");
      const s3Config = config.s3.bucket && config.s3.accessKeyId && config.s3.secretAccessKey && config.s3.publicUrlPrefix
        ? JSON.stringify({
          bucket: config.s3.bucket,
          region: config.s3.region,
          endpoint: config.s3.endpoint,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
          publicUrlPrefix: config.s3.publicUrlPrefix
        })
        : null;

      await db.query("insert into hubs (id, name, owner_user_id, s3_config) values ($1, $2, $3, $4)", [
        hubId,
        input.hubName,
        input.productUserId,
        s3Config
      ]);

      const defaultServerId = randomId("srv");
      await db.query(
        `insert into servers (id, hub_id, name, type, matrix_space_id, created_by_user_id, owner_user_id)
         values ($1, $2, $3, 'default', null, $4, $5)`,
        [defaultServerId, hubId, "General Server", input.productUserId, input.productUserId]
      );

      const dmServerId = randomId("srv");
      await db.query(
        `insert into servers (id, hub_id, name, type, matrix_space_id, created_by_user_id, owner_user_id)
         values ($1, $2, $3, 'dm', null, $4, $5)`,
        [dmServerId, hubId, "Direct Messages", input.productUserId, input.productUserId]
      );

      const defaultChannelId = randomId("chn");
      await db.query(
        `insert into channels
         (id, server_id, category_id, name, type, matrix_room_id, is_locked, slow_mode_seconds, posting_restricted_to_roles)
         values ($1, $2, null, $3, 'text', null, false, 0, '{}')`,
        [defaultChannelId, defaultServerId, "general"]
      );

      // P2.cleanup: seed default access rules for both servers + the
      // bootstrap channel. The legacy `*_access` columns are gone.
      const { seedDefaultSpaceAccessRules, seedDefaultChannelAccessRules } =
        await import("./provisioning-service.js");
      await seedDefaultSpaceAccessRules(db, defaultServerId);
      await seedDefaultSpaceAccessRules(db, dmServerId);
      await seedDefaultChannelAccessRules(db, defaultChannelId, "hidden");

      await db.query(
        `insert into role_bindings (id, product_user_id, role, hub_id, server_id, channel_id)
         values ($1, $2, 'hub_admin', $3, null, null)`,
        [randomId("rb"), input.productUserId, hubId]
      );

      await db.query(
        `update platform_settings
         set bootstrap_completed_at = now(),
             bootstrap_admin_user_id = $1,
             bootstrap_hub_id = $2,
             default_server_id = $3,
             default_channel_id = $4
         where id = 'global'`,
        [input.productUserId, hubId, defaultServerId, defaultChannelId]
      );

      await db.query("commit");
      return { hubId, defaultServerId, defaultChannelId };
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

export async function ensureInitialized(): Promise<void> {
  const status = await getBootstrapStatus();
  if (!status.initialized) {
    throw new Error("Platform is not initialized.");
  }
}

export async function hasInitializedPlatform(): Promise<boolean> {
  const status = await getBootstrapStatus();
  return status.initialized;
}
