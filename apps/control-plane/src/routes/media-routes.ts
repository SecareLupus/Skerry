import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageServer
} from "../services/policy-service.js";
import {
  getIdentityByProductUserId
} from "../services/identity-service.js";
import { uploadMedia } from "../services/media-service.js";

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

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
      serverId: payload.serverId,
      authContext: request.auth
    });

    // We allow media upload if the user can manage the server OR if they are simply a registered user on the platform.
    // This allows regular users to upload images even if they don't have management roles yet (e.g. for profile sync).
    const hasAnyIdentity = !!(await getIdentityByProductUserId(request.auth!.productUserId));

    if (!allowed && !hasAnyIdentity) {
      reply.code(403).send({ message: "Forbidden: Not part of any hubs or servers or missing identity." });
      return;
    }

    const result = await uploadMedia(payload);
    reply.code(201);
    // Return contentType alongside URL so the client can pass it back
    // when creating the message, which is critical for extension-less
    // Synapse media URLs that can't be type-inferred from the path.
    return { url: result.url, contentType: payload.contentType };
  });
}
