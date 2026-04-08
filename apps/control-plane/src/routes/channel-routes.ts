import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageServer
} from "../services/policy-service.js";
import {
  createChannelWorkflow
} from "../services/provisioning-service.js";
import {
  listChannels,
  listCategories,
  deleteChannel,
  updateChannelVideoControls,
  createCategory,
  updateCategory,
  deleteCategory,
  updateChannel,
  listChannelMembers,
  inviteToChannel,
  moveChannelToCategory
} from "../services/chat/channel-service.js";
import {
  listChannelReadStates,
  upsertChannelReadState
} from "../services/chat/read-state-service.js";
import {
  getChannelSettings,
  updateChannelSettings
} from "../services/settings-service.js";
import {
  setChannelControls
} from "../services/moderation-service.js";
import {
  setChannelBadgeRule
} from "../services/badge-service.js";
import { subscribeToChannelMessages } from "../services/chat-realtime.js";

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.post("/v1/channels", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        categoryId: z.string().optional(),
        name: z.string().min(2).max(80),
        type: z.enum(["text", "voice", "announcement", "forum", "landing"]),
        topic: z.string().optional(),
        iconUrl: z.string().optional(),
        styleContent: z.string().optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const idempotencyKey = request.headers["idempotency-key"];
    const channel = await createChannelWorkflow({
      ...payload,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined
    });

    reply.code(201);
    return channel;
  });

  app.get("/v1/servers/:serverId/channels", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listChannels(params.serverId, request.auth!.productUserId, request.auth) };
  });

  app.get("/v1/servers/:serverId/categories", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listCategories(params.serverId) };
  });

  app.delete("/v1/channels/:channelId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const channels = await listChannels(query.serverId, request.auth!.productUserId, request.auth);
    const existing = channels.find((channel) => channel.id === params.channelId);
    if (!existing) {
      reply.code(404).send({ message: "Channel not found." });
      return;
    }

    await deleteChannel({
      channelId: params.channelId,
      serverId: query.serverId
    });
    reply.code(204).send();
  });

  app.get("/v1/channels/:channelId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    return getChannelSettings(params.channelId);
  });

  app.patch("/v1/channels/:channelId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      serverId: z.string().min(1),
      restrictedVisibility: z.boolean().optional(),
      allowedRoleIds: z.array(z.string()).optional(),
      hubAdminAccess: z.enum(["hidden", "locked", "read", "chat"]).optional(),
      spaceMemberAccess: z.enum(["hidden", "locked", "read", "chat"]).optional(),
      hubMemberAccess: z.enum(["hidden", "locked", "read", "chat"]).optional(),
      visitorAccess: z.enum(["hidden", "locked", "read", "chat"]).optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await updateChannelSettings(params.channelId, payload);
    reply.code(204).send();
  });

  app.get("/v1/channels/:channelId/stream", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);

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
      channelId: params.channelId,
      connectedAt: new Date().toISOString()
    });

    const unsubscribe = subscribeToChannelMessages(params.channelId, (event, payload) => {
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

  app.get("/v1/servers/:serverId/read-states", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return {
      items: await listChannelReadStates({
        productUserId: request.auth!.productUserId,
        serverId: params.serverId
      })
    };
  });

  app.put("/v1/channels/:channelId/read-state", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        at: z.string().datetime().optional(),
        isMuted: z.boolean().optional(),
        notificationPreference: z.enum(["all", "mentions", "none"]).optional()
      })
      .parse(request.body ?? {});

    return upsertChannelReadState({
      productUserId: request.auth!.productUserId,
      channelId: params.channelId,
      ...payload
    });
  });

  app.patch("/v1/channels/:channelId/controls", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        lock: z.boolean().optional(),
        slowModeSeconds: z.number().int().min(0).max(600).optional(),
        postingRestrictedToRoles: z
          .array(z.enum(["hub_admin", "space_owner", "space_moderator", "user"]))
          .optional(),
        reason: z.string().min(3)
      })
      .parse(request.body);

    await setChannelControls({
      actorUserId: request.auth!.productUserId,
      channelId: params.channelId,
      ...payload
    });

    reply.code(204).send();
  });

  app.patch("/v1/channels/:channelId/video-controls", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        videoEnabled: z.boolean(),
        maxVideoParticipants: z.number().int().min(1).max(16).optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    try {
      return await updateChannelVideoControls({
        channelId: params.channelId,
        serverId: payload.serverId,
        videoEnabled: payload.videoEnabled,
        maxVideoParticipants: payload.maxVideoParticipants
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Voice channel not found.") {
        reply.code(404).send({ message: error.message });
        return;
      }
      throw error;
    }
  });

  app.patch("/v1/channels/:channelId/badge-rules", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      badgeId: z.string().min(1),
      accessLevel: z.string().nullable()
    }).parse(request.body);

    await setChannelBadgeRule({
      channelId: params.channelId,
      badgeId: payload.badgeId,
      accessLevel: payload.accessLevel
    });
    reply.code(204).send();
  });

  app.post("/v1/categories", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        name: z.string().min(2).max(80)
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const category = await createCategory(payload);
    reply.code(201);
    return category;
  });

  app.patch("/v1/categories/:categoryId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ categoryId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        name: z.string().min(2).max(80).optional(),
        position: z.number().int().min(0).optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    try {
      return await updateCategory({
        categoryId: params.categoryId,
        serverId: payload.serverId,
        name: payload.name,
        position: payload.position
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Category not found.") {
        reply.code(404).send({ message: error.message });
        return;
      }
      throw error;
    }
  });

  app.delete("/v1/categories/:categoryId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ categoryId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await deleteCategory({
      categoryId: params.categoryId,
      serverId: query.serverId
    });
    reply.code(204).send();
  });

  app.patch("/v1/channels/:channelId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        name: z.string().min(2).max(80).optional(),
        type: z.enum(["text", "voice", "announcement", "dm", "forum", "landing"]).optional(),
        categoryId: z.string().nullable().optional(),
        topic: z.string().nullable().optional(),
        iconUrl: z.string().nullable().optional(),
        styleContent: z.string().nullable().optional(),
        position: z.number().optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    return updateChannel({
      channelId: params.channelId,
      serverId: payload.serverId,
      name: payload.name,
      type: payload.type,
      categoryId: payload.categoryId,
      topic: payload.topic,
      iconUrl: payload.iconUrl,
      styleContent: payload.styleContent,
      position: payload.position
    });
  });

  app.get("/v1/channels/:channelId/members", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    return { items: await listChannelMembers(params.channelId, request.auth!.productUserId) };
  });

  app.post("/v1/channels/:channelId/members", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ productUserId: z.string().min(1) }).parse(request.body);

    await inviteToChannel(params.channelId, payload.productUserId);
    reply.code(204).send();
  });

  app.patch("/v1/channels/:channelId/category", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        categoryId: z.string().min(1).nullable()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    try {
      return await moveChannelToCategory({
        channelId: params.channelId,
        serverId: payload.serverId,
        categoryId: payload.categoryId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Category not found for server." || error.message === "Channel not found.")
      ) {
        reply.code(404).send({ message: error.message });
        return;
      }
      throw error;
    }
  });
}
