import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_SERVER_BLUEPRINT } from "@skerry/shared";
import { config } from "../config.js";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { createChannelWorkflow, createServerWorkflow } from "../services/provisioning-service.js";
import {
  createReport,
  listReports,
  listAuditLogs,
  performModerationAction,
  setChannelControls,
  transitionReportStatus
} from "../services/moderation-service.js";
import { withDb } from "../db/client.js";
import { issueVoiceToken } from "../services/voice-service.js";
import {
  canManageHub,
  canManageServer,
  fetchServerScope,
  grantRole,
  isActionAllowed,
  listAllowedActions,
  listRoleBindings
} from "../services/policy-service.js";
import {
  createCategory,
  createMessage,
  deleteChannel,
  deleteCategory,
  deleteServer,
  getOrCreateDMChannel,
  listCategories,
  listChannels,
  listMessages,
  listMentionMarkers,
  listChannelReadStates,
  listServers,
  moveChannelToCategory,
  renameCategory,
  renameChannel,
  renameServer,
  updateCategory,
  updateChannel,
  updateChannelVideoControls,
  upsertChannelReadState,
  getUnreadSummary,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  listChannelMembers,
  inviteToChannel
} from "../services/chat-service.js";
import { getBootstrapStatus } from "../services/bootstrap-service.js";
import { publishChannelMessage, subscribeToChannelMessages } from "../services/chat-realtime.js";
import { listHubsForUser } from "../services/hub-service.js";
import {
  joinVoicePresence,
  leaveVoicePresence,
  listVoicePresence,
  updateVoicePresenceState
} from "../services/voice-presence-service.js";
import {
  findUniqueProductUserIdByEmail,
  getIdentityByProductUserId,
  getIdentityByProviderSubject,
  isOnboardingComplete,
  isPreferredUsernameTaken,
  listIdentitiesByProductUserId,
  searchIdentities,
  setPreferredUsernameForProductUser,
  upsertIdentityMapping
} from "../services/identity-service.js";
import {
  getHubFederationPolicy,
  listFederationPolicyEvents,
  listFederationPolicyStatuses,
  reconcileHubFederationPolicy,
  upsertHubFederationPolicy
} from "../services/federation-service.js";
import {
  createDiscordConnectUrl,
  deleteDiscordChannelMapping,
  getDiscordBridgeConnection,
  getPendingDiscordGuildSelection,
  listDiscordChannelMappings,
  listDiscordGuildChannels,
  relayDiscordMessageToMappedChannel,
  retryDiscordBridgeSync,
  selectDiscordGuild,
  upsertDiscordChannelMapping
} from "../services/discord-bridge-service.js";
import {
  assignSpaceOwner,
  expireSpaceOwnerAssignments,
  hasActiveSpaceOwnerAssignment,
  listDelegationAuditEvents,
  listSpaceOwnerAssignments,
  revokeSpaceOwnerAssignment,
  transferSpaceOwnership
} from "../services/delegation-service.js";
import {
  getChannelSettings,
  getHubSettings,
  getServerSettings,
  getUserSettings,
  updateChannelSettings,
  updateHubSettings,
  updateServerSettings,
  updateUserSettings
} from "../services/settings-service.js";
import { uploadMedia } from "../services/media-service.js";
import { updateUserPresence } from "../services/presence-service.js";

export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  async function canManageDiscordBridge(input: {
    productUserId: string;
    serverId: string;
  }): Promise<boolean> {
    const allowed = await canManageServer({
      productUserId: input.productUserId,
      serverId: input.serverId
    });
    if (!allowed) {
      return false;
    }

    const isHubAdmin = await withDb(async (db) => {
      const server = await fetchServerScope(db, input.serverId);
      if (!server) return false;
      return canManageHub({
        productUserId: input.productUserId,
        hubId: server.hubId
      });
    });

    if (isHubAdmin) {
      return true;
    }

    const hubSettings = await withDb(async (db) => {
      const server = await fetchServerScope(db, input.serverId);
      if (!server) return null;
      return getHubSettings(server.hubId);
    });

    return hubSettings?.allowSpaceDiscordBridge !== false;
  }

  app.get("/health", async () => {
    return { status: "ok", service: "control-plane" };
  });

  app.get("/bootstrap/default-server", async () => {
    return DEFAULT_SERVER_BLUEPRINT;
  });

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

  app.get("/v1/bootstrap/context", initializedAuthHandlers, async () => {
    const status = await getBootstrapStatus();
    return {
      hubId: status.bootstrapHubId,
      defaultServerId: status.defaultServerId,
      defaultChannelId: status.defaultChannelId
    };
  });

  app.get("/v1/users/search", initializedAuthHandlers, async (request) => {
    const query = z.object({ q: z.string().min(1) }).parse(request.query);
    return { items: await searchIdentities(query.q) };
  });

  app.get("/v1/users/:userId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const user = await getIdentityByProductUserId(params.userId);
    if (!user) {
      reply.code(404).send({ message: "User not found." });
      return;
    }
    return user;
  });

  app.get("/v1/servers", initializedAuthHandlers, async () => {
    return { items: await listServers() };
  });

  app.get("/v1/hubs", initializedAuthHandlers, async (request) => {
    return { items: await listHubsForUser(request.auth!.productUserId) };
  });

  app.get("/v1/me/notifications", initializedAuthHandlers, async (request) => {
    const summary = await getUnreadSummary(request.auth!.productUserId);
    return { summary };
  });

  app.post("/v1/me/presence", initializedAuthHandlers, async (request, reply) => {
    await updateUserPresence(request.auth!.productUserId);
    reply.code(204).send();
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

  app.put("/v1/hubs/:hubId/federation-policy", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        allowlist: z.array(z.string().min(1)).max(100).default([])
      })
      .parse(request.body ?? {});
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId
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
      hubId: params.hubId
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
      hubId: params.hubId
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
      hubId: params.hubId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    await updateHubSettings(params.hubId, payload);
    reply.code(204).send();
  });

  app.post("/v1/channels", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        categoryId: z.string().optional(),
        name: z.string().min(2).max(80),
        type: z.enum(["text", "voice", "announcement"])
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId
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
    return { items: await listChannels(params.serverId, request.auth!.productUserId) };
  });

  app.get("/v1/servers/:serverId/categories", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listCategories(params.serverId) };
  });

  app.patch("/v1/servers/:serverId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ name: z.string().min(2).max(80) }).parse(request.body);

    const serverRows = await listServers();
    const server = serverRows.find((item) => item.id === params.serverId);
    if (!server) {
      reply.code(404).send({ message: "Server not found." });
      return;
    }

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
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
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await deleteServer(params.serverId);
    reply.code(204).send();
  });

  app.get("/v1/servers/:serverId/settings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
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
      visibility: z.string().optional(),
      visitorPrivacy: z.string().optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    await updateServerSettings(params.serverId, payload);
    reply.code(204).send();
  });

  app.get("/v1/channels/:channelId/messages", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      })
      .parse(request.query);

    return {
      items: await listMessages({
        channelId: params.channelId,
        before: query.before,
        limit: query.limit,
        viewerUserId: request.auth!.productUserId
      })
    };
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
        at: z.string().datetime().optional()
      })
      .parse(request.body ?? {});

    return upsertChannelReadState({
      productUserId: request.auth!.productUserId,
      channelId: params.channelId,
      at: payload.at
    });
  });

  app.get("/v1/channels/:channelId/mentions", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(300).optional() }).parse(request.query);
    return {
      items: await listMentionMarkers({
        productUserId: request.auth!.productUserId,
        channelId: params.channelId,
        limit: query.limit
      })
    };
  });

  app.post("/v1/channels/:channelId/messages", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        content: z.string().trim().min(0).max(2000),
        attachments: z.array(z.object({
          id: z.string(),
          url: z.string().url(),
          contentType: z.string(),
          filename: z.string()
        })).optional()
      })
      .parse(request.body);

    const message = await createMessage({
      channelId: params.channelId,
      actorUserId: request.auth!.productUserId,
      content: payload.content,
      attachments: payload.attachments
    });
    publishChannelMessage(message);

    reply.code(201);
    return message;
  });

  app.patch("/v1/channels/:channelId/messages/:messageId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);
    const payload = z.object({
      content: z.string().trim().max(2000)
    }).parse(request.body);

    const message = await updateMessage({
      messageId: params.messageId,
      actorUserId: request.auth!.productUserId,
      content: payload.content
    });

    publishChannelMessage(message, "message.updated");
    return message;
  });

  app.delete("/v1/channels/:channelId/messages/:messageId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);

    // Permission check for moderator redact vs author delete
    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "moderation.redact",
      scope: {
        serverId: (await withDb(async (db) => {
          const row = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [params.channelId]);
          return row.rows[0]?.server_id;
        })) ?? ""
      }
    });

    await deleteMessage({
      messageId: params.messageId,
      actorUserId: request.auth!.productUserId,
      isModerator: allowed
    });

    publishChannelMessage({ id: params.messageId, channelId: params.channelId } as any, "message.deleted");
    reply.code(204).send();
  });

  app.post("/v1/channels/:channelId/messages/:messageId/reactions", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);
    const payload = z.object({
      emoji: z.string().min(1).max(32)
    }).parse(request.body);

    await addReaction({
      messageId: params.messageId,
      userId: request.auth!.productUserId,
      emoji: payload.emoji
    });

    // For reactions, we could publish a message update to refresh counts
    // In a more optimized version, we'd have a specific reaction event
    const messages = await listMessages({ channelId: params.channelId, limit: 1, before: undefined, viewerUserId: undefined });
    const message = messages.find(m => m.id === params.messageId);
    if (message) {
      publishChannelMessage(message, "message.updated");
    }

    reply.code(204).send();
  });

  app.delete("/v1/channels/:channelId/messages/:messageId/reactions/:emoji", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1),
      emoji: z.string().min(1).max(32)
    }).parse(request.params);

    await removeReaction({
      messageId: params.messageId,
      userId: request.auth!.productUserId,
      emoji: params.emoji
    });

    const messages = await listMessages({ channelId: params.channelId, limit: 1, before: undefined, viewerUserId: undefined });
    const message = messages.find(m => m.id === params.messageId);
    if (message) {
      publishChannelMessage(message, "message.updated");
    }

    reply.code(204).send();
  });

  app.post("/v1/hubs/:hubId/dms", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      userIds: z.array(z.string().min(1)).min(1).max(10)
    }).parse(request.body);

    const userIds = [...new Set([request.auth!.productUserId, ...payload.userIds])];
    const channel = await getOrCreateDMChannel(params.hubId, userIds);
    reply.code(201);
    return channel;
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
      serverId: payload.serverId
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
      serverId: payload.serverId
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
      serverId: query.serverId
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
        type: z.enum(["text", "voice", "announcement"]).optional(),
        categoryId: z.string().min(1).nullable().optional(),
        topic: z.string().max(255).nullable().optional(),
        position: z.number().int().min(0).optional()
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const channels = await listChannels(payload.serverId);
    const existing = channels.find((channel) => channel.id === params.channelId);
    if (!existing) {
      reply.code(404).send({ message: "Channel not found." });
      return;
    }

    return updateChannel({
      channelId: params.channelId,
      serverId: payload.serverId,
      name: payload.name,
      type: payload.type,
      categoryId: payload.categoryId,
      topic: payload.topic,
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

    // Permission check: if it's a DM, any member can invite (simpler for now)
    // If it's a server channel, maybe only staff.
    // We'll trust the current member is already in the channel for DMs.
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
      serverId: payload.serverId
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

  app.delete("/v1/channels/:channelId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const channels = await listChannels(query.serverId);
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
      serverId: query.serverId
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
      allowedRoleIds: z.array(z.string()).optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId
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

    const unsubscribe = subscribeToChannelMessages(params.channelId, (event, message) => {
      writeEvent(event, message);
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

  app.post("/v1/roles/grant", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        productUserId: z.string().min(1),
        role: z.enum(["hub_admin", "space_owner", "space_moderator", "user"]),
        hubId: z.string().optional(),
        serverId: z.string().optional(),
        channelId: z.string().optional()
      })
      .parse(request.body);

    await grantRole({
      actorUserId: request.auth!.productUserId,
      ...payload
    });
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
      serverId: params.serverId
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
      serverId: params.serverId
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

  app.delete("/v1/delegation/space-owners/:assignmentId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ assignmentId: z.string().min(1) }).parse(request.params);
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId
    });
    if (!allowed) {
      reply.code(403).send({
        message: "Forbidden: delegation revoke is outside assigned scope.",
        code: "forbidden_scope"
      });
      return;
    }

    await revokeSpaceOwnerAssignment({
      actorUserId: request.auth!.productUserId,
      assignmentId: params.assignmentId
    });
    reply.code(204).send();
  });

  app.post("/v1/servers/:serverId/delegation/ownership/transfer", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        newOwnerUserId: z.string().min(1)
      })
      .parse(request.body);

    const serverRows = await listServers();
    const server = serverRows.find((item) => item.id === params.serverId);
    if (!server) {
      reply.code(404).send({ message: "Server not found." });
      return;
    }

    const hasScopeManagement = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    const isCurrentOwner = server.ownerUserId === request.auth!.productUserId;
    if (!hasScopeManagement && !isCurrentOwner) {
      reply.code(403).send({
        message: "Forbidden: ownership transfer is outside assigned scope.",
        code: "forbidden_scope"
      });
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

  app.get("/v1/hubs/:hubId/delegation/audit-events", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query);

    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId
    });
    if (!allowed) {
      reply.code(403).send({
        message: "Forbidden: delegation audit read is outside assigned scope.",
        code: "forbidden_scope"
      });
      return;
    }

    return {
      items: await listDelegationAuditEvents({
        hubId: params.hubId,
        limit: query.limit
      })
    };
  });

  app.get("/v1/me/roles", initializedAuthHandlers, async (request) => {
    return {
      items: await listRoleBindings({
        productUserId: request.auth!.productUserId
      })
    };
  });

  app.get("/v1/me/settings", initializedAuthHandlers, async (request) => {
    return getUserSettings(request.auth!.productUserId);
  });

  app.patch("/v1/me/settings", initializedAuthHandlers, async (request) => {
    const payload = z.record(z.string(), z.any()).parse(request.body);
    await updateUserSettings(request.auth!.productUserId, payload);
    return { success: true };
  });

  app.get("/v1/permissions", initializedAuthHandlers, async (request, reply) => {
    const query = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1).optional(),
        productUserId: z.string().min(1).optional()
      })
      .parse(request.query);

    const targetUserId = query.productUserId ?? request.auth!.productUserId;

    if (query.productUserId) {
      // If previewing someone else, must have manage scope for that context
      const allowed = await canManageServer({
        productUserId: request.auth!.productUserId,
        serverId: query.serverId
      });
      if (!allowed) {
        reply.code(403).send({ message: "Forbidden: insufficient scope to preview permissions." });
        return;
      }
    }

    return {
      items: await listAllowedActions({
        productUserId: targetUserId,
        scope: {
          serverId: query.serverId,
          channelId: query.channelId
        }
      })
    };
  });

  app.post("/v1/moderation/actions", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        action: z.enum(["kick", "ban", "unban", "timeout", "redact_message"]),
        serverId: z.string().min(1),
        channelId: z.string().optional(),
        targetUserId: z.string().optional(),
        targetMessageId: z.string().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
        reason: z.string().min(3)
      })
      .parse(request.body);

    await performModerationAction({ ...payload, actorUserId: request.auth!.productUserId });
    reply.code(204).send();
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
      serverId: payload.serverId
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

  app.post("/v1/reports", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().optional(),
        targetUserId: z.string().optional(),
        targetMessageId: z.string().optional(),
        reason: z.string().min(3)
      })
      .parse(request.body);

    const report = await createReport({ ...payload, reporterUserId: request.auth!.productUserId });
    reply.code(201);
    return report;
  });

  app.patch("/v1/reports/:reportId", initializedAuthHandlers, async (request) => {
    const params = z.object({ reportId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        status: z.enum(["triaged", "resolved", "dismissed"]),
        reason: z.string().min(3)
      })
      .parse(request.body);

    return transitionReportStatus({
      actorUserId: request.auth!.productUserId,
      reportId: params.reportId,
      ...payload
    });
  });

  app.get("/v1/reports", initializedAuthHandlers, async (request, reply) => {
    const query = z
      .object({
        serverId: z.string().min(1),
        status: z.enum(["open", "triaged", "resolved", "dismissed"]).optional()
      })
      .parse(request.query);

    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "reports.triage",
      scope: { serverId: query.serverId }
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: report access is outside assigned scope.", code: "forbidden_scope" });
      return;
    }

    return {
      items: await listReports({
        serverId: query.serverId,
        status: query.status
      })
    };
  });

  app.get("/v1/audit-logs", initializedAuthHandlers, async (request, reply) => {
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);
    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "audit.read",
      scope: { serverId: query.serverId }
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: audit access is outside assigned scope.", code: "forbidden_scope" });
      return;
    }
    return { items: await listAuditLogs(query.serverId) };
  });

  app.post("/v1/voice/token", initializedAuthHandlers, async (request) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1),
        videoQuality: z.enum(["low", "medium", "high"]).optional()
      })
      .parse(request.body);

    return issueVoiceToken({
      actorUserId: request.auth!.productUserId,
      ...payload
    });
  });

  app.get("/v1/voice/presence", initializedAuthHandlers, async (request) => {
    const query = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1)
      })
      .parse(request.query);

    return {
      items: await listVoicePresence({
        serverId: query.serverId,
        channelId: query.channelId
      })
    };
  });

  app.post("/v1/voice/presence/join", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1),
        muted: z.boolean().optional(),
        deafened: z.boolean().optional(),
        videoEnabled: z.boolean().optional(),
        videoQuality: z.enum(["low", "medium", "high"]).optional()
      })
      .parse(request.body);
    await joinVoicePresence({
      productUserId: request.auth!.productUserId,
      ...payload
    });
    reply.code(204).send();
  });

  app.patch("/v1/voice/presence/state", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1),
        muted: z.boolean(),
        deafened: z.boolean(),
        videoEnabled: z.boolean().optional(),
        videoQuality: z.enum(["low", "medium", "high"]).optional()
      })
      .parse(request.body);
    await updateVoicePresenceState({
      productUserId: request.auth!.productUserId,
      ...payload
    });
    reply.code(204).send();
  });

  app.post("/v1/voice/presence/leave", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().min(1)
      })
      .parse(request.body);
    await leaveVoicePresence({
      productUserId: request.auth!.productUserId,
      ...payload
    });
    reply.code(204).send();
  });

  app.get("/v1/discord/oauth/start", initializedAuthHandlers, async (request, reply) => {
    const query = z.object({ serverId: z.string().min(1), returnTo: z.string().optional() }).parse(request.query);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: query.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const url = createDiscordConnectUrl({
      serverId: query.serverId,
      productUserId: request.auth!.productUserId,
      returnTo: query.returnTo
    });
    reply.redirect(url, 302);
  });

  app.get("/v1/discord/bridge/pending/:pendingSelectionId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ pendingSelectionId: z.string().min(1) }).parse(request.params);
    const pending = getPendingDiscordGuildSelection({
      pendingSelectionId: params.pendingSelectionId,
      productUserId: request.auth!.productUserId
    });
    if (!pending) {
      reply.code(404).send({ message: "Pending Discord bridge selection not found." });
      return;
    }
    return pending;
  });

  app.post("/v1/discord/bridge/pending/:pendingSelectionId/select", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ pendingSelectionId: z.string().min(1) }).parse(request.params);
    const payload = z.object({ guildId: z.string().min(1) }).parse(request.body);
    try {
      const connection = await selectDiscordGuild({
        pendingSelectionId: params.pendingSelectionId,
        productUserId: request.auth!.productUserId,
        guildId: payload.guildId
      });
      return connection;
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        reply.code(404).send({ message: error.message });
        return;
      }
      throw error;
    }
  });

  app.get("/v1/discord/bridge/:serverId/health", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    const connection = await getDiscordBridgeConnection(params.serverId);
    const mappings = await listDiscordChannelMappings(params.serverId);
    return {
      connection,
      mappingCount: mappings.length,
      activeMappingCount: mappings.filter((mapping) => mapping.enabled).length
    };
  });

  app.get("/v1/discord/bridge/:serverId/guild-channels", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    const connection = await getDiscordBridgeConnection(params.serverId);
    if (!connection || !connection.guildId) {
      reply.code(400).send({ message: "No Discord bridge connection found for this server." });
      return;
    }
    return { items: await listDiscordGuildChannels(connection.guildId) };
  });

  app.post("/v1/discord/bridge/:serverId/retry-sync", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    try {
      return await retryDiscordBridgeSync(params.serverId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        reply.code(404).send({ message: error.message });
        return;
      }
      throw error;
    }
  });

  app.get("/v1/discord/bridge/:serverId/mappings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    return { items: await listDiscordChannelMappings(params.serverId) };
  });

  app.put("/v1/discord/bridge/:serverId/mappings", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        guildId: z.string().min(1),
        discordChannelId: z.string().min(1),
        discordChannelName: z.string().min(1),
        matrixChannelId: z.string().min(1),
        enabled: z.boolean().default(true)
      })
      .parse(request.body);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    return upsertDiscordChannelMapping({
      serverId: params.serverId,
      ...payload
    });
  });

  app.delete("/v1/discord/bridge/:serverId/mappings/:mappingId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1), mappingId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    await deleteDiscordChannelMapping({
      serverId: params.serverId,
      mappingId: params.mappingId
    });
    reply.code(204).send();
  });

  app.post("/v1/discord/bridge/:serverId/relay", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);

    const allowed = await canManageDiscordBridge({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const payload = z
      .object({
        discordChannelId: z.string().min(1),
        authorId: z.string().min(1),
        authorName: z.string().min(1),
        content: z.string().min(1).max(2000),
        mediaUrls: z.array(z.string().url()).max(8).optional()
      })
      .parse(request.body);

    return relayDiscordMessageToMappedChannel({
      serverId: params.serverId,
      ...payload
    });
  });

  app.post("/v1/media/upload", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        contentType: z.string().min(1),
        base64Data: z.string().min(1) // Base64 chunk
      })
      .parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: payload.serverId
    });

    if (!allowed && !(await listRoleBindings({ productUserId: request.auth!.productUserId })).length) {
      // Basic fallback check: must have some role in the setup or be server manager
      reply.code(403).send({ message: "Forbidden: Not part of any hubs or servers." });
      return;
    }

    const result = await uploadMedia(payload);
    reply.code(201);
    return result;
  });

  app.get("/v1/hubs/:hubId/members", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageHub({
      productUserId: request.auth!.productUserId,
      hubId: params.hubId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }
    const { listHubMembers } = await import("../services/identity-service.js");
    return { items: await listHubMembers(params.hubId) };
  });

  app.get("/v1/servers/:serverId/members", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }
    const { listServerMembers } = await import("../services/chat-service.js");
    return { items: await listServerMembers(params.serverId) };
  });

  app.post("/v1/servers/:serverId/members/bulk-moderate", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      targetUserIds: z.array(z.string().min(1)).min(1).max(100),
      action: z.enum(["kick", "ban", "unban", "timeout"]),
      reason: z.string().min(1).max(500),
      timeoutSeconds: z.number().int().min(1).optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const { performBulkModerationAction } = await import("../services/moderation-service.js");
    const results = await performBulkModerationAction({
      actorUserId: request.auth!.productUserId,
      serverId: params.serverId,
      targetUserIds: payload.targetUserIds,
      action: payload.action,
      reason: payload.reason,
      timeoutSeconds: payload.timeoutSeconds
    });

    return results;
  });
}
