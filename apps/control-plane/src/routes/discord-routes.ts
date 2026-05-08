import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageDiscordBridge
} from "../services/policy-service.js";
import {
  createDiscordConnectUrl,
  getPendingDiscordGuildSelection,
  selectDiscordGuild,
  getDiscordBridgeConnection,
  listDiscordChannelMappings,
  listDiscordGuildChannels,
  retryDiscordBridgeSync,
  upsertDiscordChannelMapping,
  deleteDiscordChannelMapping,
  relayDiscordMessageToMappedChannel
} from "../services/discord-bridge-service.js";

export async function registerDiscordRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

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
}
