import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { canManageServer } from "../services/policy-service.js";
import {
  listWebhooks,
  createWebhook,
  deleteWebhook,
  getWebhookByToken
} from "../services/extension-service.js";
import { createMessage } from "../services/chat/message-service.js";
import { publishChannelMessage } from "../services/chat-realtime.js";
import { withDb } from "../db/client.js";

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/servers/:serverId/webhooks", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      throw new Error("Forbidden");
    }
    return { items: await listWebhooks(params.serverId) };
  });

  app.post("/v1/channels/:channelId/webhooks", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1).max(80),
      avatarUrl: z.string().url().optional()
    }).parse(request.body);

    // Get serverId for permissions
    const channelRow = await withDb(async (db) => {
      const row = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [params.channelId]);
      return row.rows[0];
    });
    if (!channelRow) {
      reply.code(404).send({ message: "Channel not found" });
      return;
    }

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: channelRow.server_id,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    const webhook = await createWebhook({ ...payload, channelId: params.channelId, serverId: channelRow.server_id });
    reply.code(201);
    return webhook;
  });

  app.delete("/v1/servers/:serverId/webhooks/:webhookId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1), webhookId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    await deleteWebhook(params.serverId, params.webhookId);
    reply.code(204).send();
  });

  // Unauthenticated trigger endpoint
  app.post("/v1/webhooks/:id/:token", async (request, reply) => {
    const params = z.object({ id: z.string().min(1), token: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      content: z.string().min(1).max(2000),
      username: z.string().optional(),
      avatar_url: z.string().url().optional()
    }).parse(request.body);

    const webhook = await getWebhookByToken(params.id, params.token);
    if (!webhook) {
      reply.code(404).send({ message: "Webhook not found" });
      return;
    }

    const message = await createMessage({
      channelId: webhook.channelId,
      actorUserId: "system_webhook", // Special actor
      content: payload.content,
      isRelay: true,
      externalProvider: "webhook",
      externalAuthorName: payload.username ?? webhook.name,
      externalAuthorAvatarUrl: payload.avatar_url ?? webhook.avatarUrl ?? undefined
    });

    await publishChannelMessage(message);

    reply.code(204).send();
  });
}
