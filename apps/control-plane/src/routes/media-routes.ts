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
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };
  const STICKER_CACHE_DIR = "/tmp/skerry-sticker-cache";

  // Ensure cache dir exists
  try {
    await fs.mkdir(STICKER_CACHE_DIR, { recursive: true });
    console.log(`[Media] Sticker cache initialized at ${STICKER_CACHE_DIR}`);
  } catch (err) {
    console.error(`[Media] WARNING: Could not create sticker cache directory: ${STICKER_CACHE_DIR}. Caching will be disabled for this session.`, err);
  }

  app.post("/v1/media/upload", initializedAuthHandlers, async (request, reply) => {
    // ... existing upload code
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

    const hasAnyIdentity = !!(await getIdentityByProductUserId(request.auth!.productUserId));

    if (!allowed && !hasAnyIdentity) {
      reply.code(403).send({ message: "Forbidden: Not part of any hubs or servers or missing identity." });
      return;
    }

    const result = await uploadMedia(payload);
    reply.code(201);
    return { url: result.url, contentType: payload.contentType };
  });

  app.get("/v1/media/sticker.webp", async (request, reply) => {
    console.log(`[Media] GET /v1/media/sticker.webp - URL: ${request.query && (request.query as any).url}`);
    const { url } = z.object({ url: z.string().url() }).parse(request.query);
    
    // Hash the URL to use as a filename
    const hash = crypto.createHash("md5").update(url).digest("hex");
    const cachePath = path.join(STICKER_CACHE_DIR, `${hash}.webp`);

    try {
        // 1. Check Cache
        const stats = await fs.stat(cachePath).catch(() => null);
        if (stats) {
            console.log(`[Sticker Cache] HIT for ${url}`);
            const buffer = await fs.readFile(cachePath);
            reply.header("Content-Type", "image/webp");
            reply.header("Cache-Control", "public, max-age=31536000, immutable");
            return reply.send(buffer);
        }

        // 2. Cache MISS -> Call Renderer
        console.log(`[Sticker Cache] MISS for ${url}, calling renderer...`);
        const rendererUrl = `http://sticker-renderer:3000/render?url=${encodeURIComponent(url)}`;
        const response = await fetch(rendererUrl);

        if (!response.ok) {
            const errorText = await response.text().catch(() => "No error body");
            throw new Error(`Renderer failed (${response.status}): ${errorText}`);
        }

        const buffer = await response.arrayBuffer();
        const finalBuffer = Buffer.from(buffer);

        // 3. Save to Cache (Background)
        fs.writeFile(cachePath, finalBuffer).catch(err => {
            console.error(`[Sticker Cache] Failed to save ${cachePath}:`, err);
        });

        reply.header("Content-Type", "image/webp");
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return reply.send(finalBuffer);
    } catch (err) {
        console.error(`[Sticker Cache] Error processing ${url}:`, err);
        return reply.code(500).send({ error: "Failed to render sticker" });
    }
  });

  app.get("/v1/media/proxy", async (request, reply) => {
    console.log(`[Media] GET /v1/media/proxy - URL: ${request.query && (request.query as any).url}`);
    const { url } = z.object({ url: z.string().url() }).parse(request.query);
    
    // Only allow proxying specific domains to avoid SSRF
    const allowedDomains = ["discordapp.net", "discordapp.com", "tenor.com", "giphy.com", "twimg.com", "media.giphy.com", "media.tenor.com"];
    const parsedUrl = new URL(url);
    if (!allowedDomains.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith("." + d))) {
      return reply.code(403).send({ error: "Forbidden: Domain not allowed for proxy" });
    }

    try {
      const response = await fetch(url, {
          headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
              "Accept": "image/*,video/*,application/json,*/*",
              "Referer": "https://discord.com/" // Often required for Discord assets
          }
      });

      if (!response.ok) {
          return reply.code(response.status).send({ error: `Failed to fetch media: ${response.statusText}` });
      }

      const contentType = response.headers.get("content-type");
      console.log(`[Media Proxy] Fetching ${url} -> Status: ${response.status}, Content-Type: ${contentType}`);
      
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

  app.get("/v1/media/health", async () => {
    console.log("[Media] Health check requested");
    return { status: "ok", cacheDir: STICKER_CACHE_DIR };
  });

  console.log("[Media] Media routes registration complete");
}
