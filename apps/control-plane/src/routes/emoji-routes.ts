import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { canEditServerSettings } from "../services/policy-service.js";
import {
  createServerEmoji,
  listServerEmojis,
  deleteServerEmoji,
  listDiscordGuildEmojis,
  pullAllDiscordEmojis
} from "../services/extension-service.js";
import { getDiscordBridgeConnection } from "../services/discord-bridge-service.js";

export async function registerEmojiRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  // ── Server Emoji CRUD ──

  app.get("/v1/servers/:serverId/emojis", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const items = await listServerEmojis(params.serverId);
    return { items };
  });

  app.post("/v1/servers/:serverId/emojis", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Emoji name must be alphanumeric with underscores/hyphens"),
      url: z.string().url()
    }).parse(request.body);

    const allowed = await canEditServerSettings({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient space management scope." });
      return;
    }

    const emoji = await createServerEmoji({
      serverId: params.serverId,
      name: payload.name,
      url: payload.url
    });
    reply.code(201);
    return emoji;
  });

  app.delete("/v1/servers/:serverId/emojis/:emojiId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      serverId: z.string().min(1),
      emojiId: z.string().min(1)
    }).parse(request.params);

    const allowed = await canEditServerSettings({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient space management scope." });
      return;
    }

    await deleteServerEmoji(params.serverId, params.emojiId);
    reply.code(204).send();
  });

  // ── Discord Bridge Emoji ──

  app.get("/v1/servers/:serverId/discord-emojis", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);

    const allowed = await canEditServerSettings({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient space management scope." });
      return;
    }

    const connection = await getDiscordBridgeConnection(params.serverId);
    if (!connection || !connection.guildId) {
      return { items: [], message: "No Discord bridge connection for this space." };
    }

    try {
      const items = await listDiscordGuildEmojis(params.serverId, connection.guildId);
      return { items };
    } catch (error) {
      reply.code(503).send({
        message: error instanceof Error ? error.message : "Failed to fetch Discord emojis."
      });
    }
  });

  app.post("/v1/servers/:serverId/discord-emojis/pull-all", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);

    const allowed = await canEditServerSettings({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient space management scope." });
      return;
    }

    const connection = await getDiscordBridgeConnection(params.serverId);
    if (!connection || !connection.guildId) {
      reply.code(400).send({ message: "No Discord bridge connection for this space." });
      return;
    }

    try {
      const result = await pullAllDiscordEmojis(params.serverId, connection.guildId);
      return result;
    } catch (error) {
      reply.code(503).send({
        message: error instanceof Error ? error.message : "Failed to pull Discord emojis."
      });
    }
  });
}
