import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { canManageServer } from "../services/policy-service.js";
import {
  listServerStickers,
  createServerSticker,
  deleteServerSticker
} from "../services/extension-service.js";

export async function registerStickerRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/servers/:serverId/stickers", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    return { items: await listServerStickers(params.serverId) };
  });

  app.post("/v1/servers/:serverId/stickers", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      url: z.string().url()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    const sticker = await createServerSticker({ ...payload, serverId: params.serverId });
    reply.code(201);
    return sticker;
  });

  app.delete("/v1/servers/:serverId/stickers/:stickerId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1), stickerId: z.string().min(1) }).parse(request.params);
    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    await deleteServerSticker(params.serverId, params.stickerId);
    reply.code(204).send();
  });
}
