import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageHub,
} from "../services/policy-service.js";
import {
  transferHubOwnership,
  listDelegationAuditEvents
} from "../services/delegation-service.js";
import {
  listHubsForUser
} from "../services/hub-service.js";
import {
  getHubFederationPolicy,
  listFederationPolicyStatuses,
  listFederationPolicyEvents,
  upsertHubFederationPolicy,
  reconcileHubFederationPolicy
} from "../services/federation-service.js";
import {
  getHubSettings,
  updateHubSettings
} from "../services/settings-service.js";
import { withDb } from "../db/client.js";
import { subscribeToHubEvents } from "../services/chat-realtime.js";

export async function registerHubRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/hubs", initializedAuthHandlers, async (request) => {
    return { items: await listHubsForUser(request.auth!.productUserId, request.auth) };
  });

  app.get("/v1/hubs/:hubId/federation-policy", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    const [policy, statuses, events] = await Promise.all([
      getHubFederationPolicy(params.hubId),
      listFederationPolicyStatuses(params.hubId),
      listFederationPolicyEvents(params.hubId, 20)
    ]);
    return {
      policy,
      status: {
        totalRooms: statuses.length,
        appliedRooms: statuses.filter((item) => item.status === "applied").length,
        errorRooms: statuses.filter((item) => item.status === "error").length,
        skippedRooms: statuses.filter((item) => item.status === "skipped").length
      },
      rooms: statuses,
      recentChanges: events
    };
  });

  app.post("/v1/hubs/:hubId/suspend", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      durationSeconds: z.number().int().positive().optional(),
      unlockCodeHash: z.string().optional()
    }).parse(request.body);

    const isOwner = await withDb(async (db) => {
      const hub = await db.query("select owner_user_id from hubs where id = $1", [params.hubId]);
      return hub.rows[0]?.owner_user_id === request.auth!.productUserId;
    });

    if (!isOwner) {
      reply.code(403).send({ message: "Only the Hub Owner can voluntarily suspend their account." });
      return;
    }

    const expiresAt = payload.durationSeconds 
      ? new Date(Date.now() + payload.durationSeconds * 1000).toISOString()
      : null;

    await updateHubSettings(params.hubId, {
      suspension: {
        isSuspended: true,
        suspendedAt: new Date().toISOString(),
        expiresAt,
        unlockCodeHash: payload.unlockCodeHash
      }
    });

    return { status: "suspended", expiresAt };
  });

  app.post("/v1/hubs/:hubId/unsuspend", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      unlockCode: z.string().optional()
    }).parse(request.body);

    const hub = await getHubSettings(params.hubId);
    if (!hub.suspension?.isSuspended) {
      return { status: "not_suspended" };
    }

    // Check if user is owner (manual unlock with code)
    const isOwner = await withDb(async (db) => {
      const row = await db.query("select owner_user_id from hubs where id = $1", [params.hubId]);
      return row.rows[0]?.owner_user_id === request.auth!.productUserId;
    });

    if (isOwner && payload.unlockCode && hub.suspension.unlockCodeHash) {
      if (payload.unlockCode === hub.suspension.unlockCodeHash) {
        await updateHubSettings(params.hubId, {
          suspension: { isSuspended: false, suspendedAt: null, expiresAt: null, unlockCodeHash: null }
        });
        return { status: "active" };
      }
    }

    // Auto-unsuspend if expired
    if (hub.suspension.expiresAt && new Date(hub.suspension.expiresAt) < new Date()) {
      await updateHubSettings(params.hubId, {
        suspension: { isSuspended: false, suspendedAt: null, expiresAt: null, unlockCodeHash: null }
      });
      return { status: "active" };
    }

    reply.code(403).send({ message: "Suspension still in effect. Use unlock code or wait for expiration." });
  });

  app.put("/v1/hubs/:hubId/federation-policy", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        allowlist: z.array(z.string().min(1)).max(100).default([])
      })
      .parse(request.body ?? {});
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    const policy = await upsertHubFederationPolicy({
      hubId: params.hubId,
      allowlist: payload.allowlist,
      actorUserId: request.auth!.productUserId
    });
    reply.code(200);
    return policy;
  });

  app.post("/v1/hubs/:hubId/federation-policy/reconcile", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    const result = await reconcileHubFederationPolicy({
      hubId: params.hubId,
      actorUserId: request.auth!.productUserId
    });
    return result;
  });

  app.get("/v1/hubs/:hubId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }
    return getHubSettings(params.hubId);
  });

  app.patch("/v1/hubs/:hubId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      theme: z.any().optional(),
      spaceCustomizationLimits: z.any().optional(),
      oidcConfig: z.any().optional(),
      allowSpaceDiscordBridge: z.boolean().optional()
    }).parse(request.body);

    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    await updateHubSettings(params.hubId, payload);
    reply.code(204).send();
  });

  app.get("/v1/hubs/:hubId/stream", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);

    // Verify hub access
    const hubs = await listHubsForUser(request.auth!.productUserId);
    if (!hubs.some(h => h.id === params.hubId)) {
      reply.code(403).send({ message: "Forbidden: hub access denied." });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const writeEvent = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent("ready", {
      hubId: params.hubId,
      connectedAt: new Date().toISOString()
    });

    const unsubscribe = subscribeToHubEvents(params.hubId, (event, payload) => {
      writeEvent(event, payload);
    });

    const keepAliveTimer = setInterval(() => {
      writeEvent("ping", { at: Date.now() });
    }, 25000);

    request.raw.on("close", () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
      reply.raw.end();
    });
  });

  app.post("/v1/hubs/:hubId/ownership/transfer", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ newOwnerUserId: z.string().min(1) }).parse(request.body);

    const hubRows = await withDb(db => db.query("select owner_user_id from hubs where id = $1", [params.hubId]));
    const hub = hubRows.rows[0];
    if (!hub) {
      reply.code(404).send({ message: "Hub not found." });
      return;
    }

    const isOwner = hub.owner_user_id === request.auth!.productUserId;
    if (!isOwner) {
      reply.code(403).send({ message: "Forbidden: only the hub owner can transfer ownership." });
      return;
    }

    return await transferHubOwnership({
      actorUserId: request.auth!.productUserId,
      hubId: params.hubId,
      newOwnerUserId: payload.newOwnerUserId
    });
  });

  app.get("/v1/hubs/:hubId/members", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }
    const { listHubMembers } = await import("../services/identity-service.js");
    return { items: await listHubMembers(params.hubId) };
  });
  
  app.get("/v1/hubs/:hubId/delegation/audit-events", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }
    return {
      items: await listDelegationAuditEvents({ hubId: params.hubId })
    };
  });
}
