import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageHub,
  canManageServer,
  fetchServerScope
} from "../services/policy-service.js";
import {
  createServerWorkflow
} from "../services/provisioning-service.js";
import {
  listServers,
  deleteServer,
  renameServer,
  listServerMembers
} from "../services/chat/server-service.js";
import {
  joinServer,
  leaveServer
} from "../services/membership-service.js";
import {
  createBadge,
  assignBadgeToUser,
  revokeBadgeFromUser,
  listBadgeAssignments,
  listServerBadgeAssignments,
  listBadges,
  setServerBadgeRule
} from "../services/badge-service.js";
import {
  getServerSettings,
  updateServerSettings
} from "../services/settings-service.js";
import {
  assignSpaceOwner,
  expireSpaceOwnerAssignments,
  listSpaceOwnerAssignments,
  hasActiveSpaceOwnerAssignment,
  transferSpaceOwnership,
  revokeSpaceOwnerAssignment
} from "../services/delegation-service.js";
import { withDb } from "../db/client.js";

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.post("/v1/servers", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        hubId: z.string().min(1),
        name: z.string().min(2).max(80)
      })
      .parse(request.body);

    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: payload.hubId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    const idempotencyKey = request.headers["idempotency-key"];
    const server = await createServerWorkflow({
      ...payload,
      productUserId: request.auth!.productUserId,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined
    });

    reply.code(201);
    return server;
  });

  app.get("/v1/servers", initializedAuthHandlers, async (request) => {
    return { items: await listServers(request.auth!.productUserId, undefined, request.auth) };
  });

  app.get("/v1/hubs/:hubId/servers", initializedAuthHandlers, async (request) => {
    const { hubId } = request.params as { hubId: string };
    return { items: await listServers(request.auth!.productUserId, hubId, request.auth) };
  });

  app.patch("/v1/servers/:serverId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ name: z.string().min(2).max(80) }).parse(request.body);

    const canManage = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });

    if (!canManage) {
      reply.code(404).send({ message: "Server not found or access denied." });
      return;
    }

    return renameServer({
      serverId: params.serverId,
      name: payload.name
    });
  });

  app.delete("/v1/servers/:serverId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);

    const serverRows = await listServers();
    const server = serverRows.find((item) => item.id === params.serverId);
    if (!server) {
      reply.code(404).send({ message: "Server not found." });
      return;
    }

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await deleteServer(params.serverId);
    reply.code(204).send();
  });
  
  app.post("/v1/servers/:serverId/join", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    await joinServer(params.serverId, request.auth!.productUserId);
    reply.code(204).send();
  });

  app.delete("/v1/servers/:serverId/leave", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    await leaveServer(params.serverId, request.auth!.productUserId);
    reply.code(204).send();
  });

  app.get("/v1/servers/:serverId/badges", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listBadges(params.serverId) };
  });

  app.post("/v1/badges", initializedAuthHandlers, async (request, reply) => {
    const payload = z.object({
      hubId: z.string().min(1),
      serverId: z.string().min(1),
      name: z.string().min(1),
      rank: z.number().optional(),
      description: z.string().optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    const badge = await createBadge(payload);
    reply.code(201);
    return badge;
  });

  app.post("/v1/badges/:badgeId/assign", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ badgeId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ 
      productUserId: z.string().min(1).optional(),
      userId: z.string().min(1).optional()
    }).parse(request.body);

    const targetUserId = payload.productUserId ?? payload.userId;
    if (!targetUserId) {
      reply.code(400).send({ message: "productUserId or userId is required" });
      return;
    }

    await assignBadgeToUser(targetUserId, params.badgeId);
    reply.code(204).send();
  });

  app.delete("/v1/badges/:badgeId/assign/:userId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ 
      badgeId: z.string().min(1),
      userId: z.string().min(1)
    }).parse(request.params);

    await revokeBadgeFromUser(params.userId, params.badgeId);
    reply.code(204).send();
  });

  app.get("/v1/badges/:badgeId/assignments", initializedAuthHandlers, async (request, reply) => {
    const { badgeId } = z.object({ badgeId: z.string().min(1) }).parse(request.params);
    return { items: await listBadgeAssignments(badgeId) };
  });

  app.get("/v1/servers/:serverId/badge-assignments", initializedAuthHandlers, async (request, reply) => {
    const { serverId } = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listServerBadgeAssignments(serverId) };
  });

  app.put("/v1/servers/:serverId/badge-rules", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      badgeId: z.string().min(1),
      accessLevel: z.string().nullable()
    }).parse(request.body);

    await setServerBadgeRule({
      serverId: params.serverId,
      badgeId: payload.badgeId,
      accessLevel: payload.accessLevel
    });
    reply.code(204).send();
  });

  app.get("/v1/servers/:serverId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    return getServerSettings(params.serverId);
  });

  app.patch("/v1/servers/:serverId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      startingChannelId: z.string().min(1).nullable().optional(),
      iconUrl: z.string().url().nullable().optional(),
      visibility: z.string().optional(),
      visitorPrivacy: z.string().optional(),
      joinPolicy: z.enum(["open", "approval", "invite"]).optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await updateServerSettings(params.serverId, payload);
    reply.code(204).send();
  });

  app.post("/v1/servers/:serverId/delegation/space-owners", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        productUserId: z.string().min(1),
        expiresAt: z.string().datetime().optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({
        message: "Forbidden: delegation assignment is outside assigned scope.",
        code: "forbidden_scope"
      });
      return;
    }

    const assignment = await assignSpaceOwner({
      actorUserId: request.auth!.productUserId,
      assignedUserId: payload.productUserId,
      serverId: params.serverId,
      expiresAt: payload.expiresAt
    });

    reply.code(201);
    return assignment;
  });

  app.get("/v1/servers/:serverId/delegation/space-owners", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    await expireSpaceOwnerAssignments({ serverId: params.serverId });
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({
        message: "Forbidden: delegation read is outside assigned scope.",
        code: "forbidden_scope"
      });
      return;
    }
    return {
      items: await listSpaceOwnerAssignments(params.serverId)
    };
  });

  app.post("/v1/servers/:serverId/delegation/ownership/transfer", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        newOwnerUserId: z.string().min(1)
      })
      .parse(request.body);

    const canManage = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });

    if (!canManage) {
      reply.code(404).send({ message: "Server not found or access denied." });
      return;
    }

    const transfer = await transferSpaceOwnership({
      actorUserId: request.auth!.productUserId,
      serverId: params.serverId,
      newOwnerUserId: payload.newOwnerUserId
    });

    if (!(await hasActiveSpaceOwnerAssignment({ productUserId: payload.newOwnerUserId, serverId: params.serverId }))) {
      await assignSpaceOwner({
        actorUserId: request.auth!.productUserId,
        assignedUserId: payload.newOwnerUserId,
        serverId: params.serverId
      });
    }

    return transfer;
  });

  app.get("/v1/servers/:serverId/members", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    return { items: await listServerMembers(params.serverId) };
  });
  
  app.delete("/v1/delegation/space-owners/:assignmentId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ assignmentId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1).optional() }).parse(request.query);
    
    // We prioritize the provided serverId for scoping, but we could also resolve it from the assignment itself
    let serverId = query.serverId;
    if (!serverId) {
       // Fetch assignment to find the server
       const items = await withDb(async (db) => {
          const row = await db.query<{ server_id: string }>("select server_id from space_admin_assignments where id = $1", [params.assignmentId]);
          return row.rows[0]?.server_id;
       });
       serverId = items;
    }
    
    if (!serverId) {
       reply.code(404).send({ message: "Assignment or server not found." });
       return;
    }

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await revokeSpaceOwnerAssignment({
      actorUserId: request.auth!.productUserId,
      assignmentId: params.assignmentId
    });
    reply.code(204).send();
  });
}
