import type { FastifyInstance } from "fastify";
import { DEFAULT_SERVER_BLUEPRINT } from "@skerry/shared";
import { bootstrapAdmin } from "../services/bootstrap-service.js";
import { upsertIdentityMapping } from "../services/identity-service.js";
import { config } from "../config.js";
import { getBootstrapStatus } from "../services/bootstrap-service.js";
import { getMetrics } from "../services/observability-service.js";
import { logEvent } from "../services/observability-service.js";
import { checkSynapseHealth } from "../matrix/synapse-adapter.js";
import { withDb } from "../db/client.js";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/health", async () => {
    const dbOk = config.databaseUrl 
      ? await withDb(async (db) => {
          const res = await db.query("SELECT 1");
          return res.rowCount === 1;
        }).catch(() => false) 
      : true;

    const synapseOk = (config.synapse.baseUrl && config.synapse.asToken)
      ? await checkSynapseHealth().catch(() => false)
      : true;

    if (dbOk && synapseOk) {
      return { 
        status: "ok", 
        service: "control-plane"
      };
    }

    return { 
      status: "degraded", 
      service: "control-plane",
      checks: {
        database: dbOk ? "up" : "down",
        synapse: synapseOk ? "up" : "down"
      }
    };
  });

  app.get("/metrics", async (request, reply) => {
    const { token, allowedIps } = config.metrics;
    const forwardedFor = request.headers["x-forwarded-for"];
    const clientIp = (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : request.ip) || "";
    
    let authorized = false;
    
    // Check Token
    if (token) {
      const authHeader = request.headers["authorization"];
      const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : request.headers["x-metrics-token"];
      if (providedToken === token) authorized = true;
    }
    
    // Check IP
    if (!authorized && allowedIps.length > 0) {
      if (allowedIps.includes(clientIp)) authorized = true;
    }
    
    // If neither is configured, we allow it (warning is logged on startup)
    if (!token && allowedIps.length === 0) authorized = true;

    if (!authorized) {
      logEvent("warn", "metrics_access_denied", { clientIp, requestId: request.id });
      reply.code(403).send({ error: "Forbidden", message: "Metrics access denied." });
      return;
    }

    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return getMetrics();
  });

  app.get("/bootstrap/default-server", async () => {
    return DEFAULT_SERVER_BLUEPRINT;
  });

  app.get("/v1/bootstrap/context", initializedAuthHandlers, async () => {
    const status = await getBootstrapStatus();
    return {
      hubId: status.bootstrapHubId,
      defaultServerId: status.defaultServerId,
      defaultChannelId: status.defaultChannelId
    };
  });

  app.post("/v1/system/test-reset", async (request, reply) => {
    if (config.baseDomain !== "localhost" && !config.devAuthBypass) {
      reply.code(403).send({ error: "Forbidden", message: "Test reset only allowed in development." });
      return;
    }

    console.log('[system-routes] Starting test-reset...');

    await withDb(async (db) => {
      await db.query("begin");
      try {
        // 1. Truncate all identity, hub, server, and chat state
        // cascaded to handle foreign key dependencies
        await db.query(`
          truncate 
            chat_messages, 
            message_reactions, 
            mention_markers, 
            channel_read_states, 
            user_blocks, 
            hub_members, 
            server_members, 
            role_bindings,
            categories, 
            channels, 
            servers, 
            hubs, 
            identity_mappings 
          cascade
        `);

        // 2. Reset the bootstrap markers in platform_settings
        await db.query(`
          update platform_settings
          set bootstrap_completed_at = null,
              bootstrap_admin_user_id = null,
              bootstrap_hub_id = null,
              default_server_id = null,
              default_channel_id = null
          where id = 'global'
        `);
        
        await db.query("commit");

        // 3. Provision Minio Bucket for testing if configured
        if (config.s3.endpoint && config.s3.bucket && config.devAuthBypass) {
          try {
            const s3 = new S3Client({
              region: config.s3.region,
              endpoint: config.s3.endpoint,
              credentials: {
                accessKeyId: config.s3.accessKeyId || "minioadmin",
                secretAccessKey: config.s3.secretAccessKey || "minioadmin",
              },
              forcePathStyle: true,
            });
            await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket })).catch((err) => {
              if (err.name !== "BucketAlreadyOwnedByYou" && err.name !== "BucketAlreadyExists") {
                throw err;
              }
            });
            console.log(`[system-routes] Ensured test bucket exists: ${config.s3.bucket}`);
          } catch (err) {
            console.error("[system-routes] Failed to provision test bucket:", err);
          }
        }
      } catch (err) {
        await db.query("rollback");
        throw err;
      }
    });

    return { success: true, message: "Workspace reset to clean state (pre-onboarding)." };
  });
}
