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

  app.get("/v1/media/proxy", async (request, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.query);
    
    // Only allow proxying specific domains to avoid SSRF
    const allowedDomains = ["discordapp.net", "discordapp.com", "tenor.com", "giphy.com", "twimg.com"];
    const parsedUrl = new URL(url);
    if (!allowedDomains.some(d => parsedUrl.hostname.endsWith(d))) {
      return reply.code(403).send({ error: "Forbidden: Domain not allowed for proxy" });
    }

    try {
      const response = await fetch(url, {
          headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              "Accept": "*/*"
          }
      });

      if (!response.ok) {
          return reply.code(response.status).send({ error: `Failed to fetch media: ${response.statusText}` });
      }

      const contentType = response.headers.get("content-type");
      if (contentType) reply.header("Content-Type", contentType);
      
      // Cache for 1 day
      reply.header("Cache-Control", "public, max-age=86400");

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (err) {
      console.error(`Media proxy error for ${url}:`, err);
      return reply.code(500).send({ error: "Internal error fetching media" });
    }
  });
}
