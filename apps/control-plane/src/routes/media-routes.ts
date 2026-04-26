import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  canManageServer
} from "../services/policy-service.js";
import {
  getIdentityByProductUserId
} from "../services/identity-service.js";
import { uploadMedia } from "../services/media-service.js";
import { logEvent } from "../services/observability-service.js";
import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";

const STICKER_CACHE_PRIMARY = process.env.STICKER_CACHE_DIR || "/app/cache/stickers";
const STICKER_CACHE_FALLBACK = path.join(os.tmpdir(), "escapehatch-stickers");

async function resolveCacheDir(): Promise<string | null> {
  for (const dir of [STICKER_CACHE_PRIMARY, STICKER_CACHE_FALLBACK]) {
    try {
      await fs.mkdir(dir, { recursive: true });
      // Probe write access — mkdir can succeed on a read-only mount.
      await fs.access(dir, fs.constants.W_OK);
      return dir;
    } catch (err) {
      logEvent("warn", "sticker_cache_dir_unavailable", { dir, error: (err as Error).message });
    }
  }
  return null;
}

async function atomicWrite(targetPath: string, buffer: Buffer): Promise<void> {
  const tmpPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, targetPath);
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };
  const stickerCacheDir = await resolveCacheDir();

  if (stickerCacheDir) {
    logEvent("info", "sticker_cache_ready", { dir: stickerCacheDir });
  } else {
    logEvent("warn", "sticker_cache_disabled", {
      message: "No writable cache directory; stickers will render uncached."
    });
  }

  app.post("/v1/media/upload", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        contentType: z.string().min(1),
        base64Data: z.string().min(1)
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

  app.get("/v1/media/sticker.webp", async (request, reply) => handleStickerRequest(request, reply));
  app.get("/v1/media/sticker", async (request, reply) => handleStickerRequest(request, reply));

  async function handleStickerRequest(request: FastifyRequest, reply: FastifyReply) {
    const rawUrl = (request.query as { url?: string } | undefined)?.url;

    try {
      const { url } = z.object({ url: z.string().url() }).parse(request.query);

      const lottieResponse = await fetch(url);
      if (!lottieResponse.ok) {
        throw new Error(`Failed to fetch Lottie JSON from ${url} (${lottieResponse.status})`);
      }
      const lottieJson = await lottieResponse.text();

      const hash = crypto.createHash("md5").update(lottieJson).digest("hex");
      const cachePath = stickerCacheDir ? path.join(stickerCacheDir, `${hash}.webp`) : null;

      if (cachePath) {
        const stats = await fs.stat(cachePath).catch(() => null);
        if (stats && stats.size > 0) {
          const buffer = await fs.readFile(cachePath);
          reply.header("Content-Type", "image/webp");
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
          return reply.send(buffer);
        }
      }

      const rendererUrl = `http://sticker-renderer:3000/render`;
      const response = await fetch(rendererUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, data: lottieJson })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error body");
        throw new Error(`Renderer failed (${response.status}): ${errorText}`);
      }

      const buffer = await response.arrayBuffer();
      const finalBuffer = Buffer.from(buffer);

      if (cachePath) {
        // Atomic write so concurrent requests can't observe a partial file via stat().
        await atomicWrite(cachePath, finalBuffer).catch((err: Error) => {
          logEvent("error", "sticker_cache_write_failed", { cachePath, error: err.message });
        });
      }

      reply.header("Content-Type", "image/webp");
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.send(finalBuffer);
    } catch (err) {
      logEvent("error", "sticker_request_failed", { url: rawUrl, error: (err as Error).message });
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Invalid URL parameter", details: err.errors });
      }
      return reply.code(500).send({
        error: "Failed to render sticker",
        message: (err as Error).message || "Unknown rendering error",
        url: rawUrl
      });
    }
  }

  app.get("/v1/media/proxy", async (request, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.query);

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
          "Referer": "https://discord.com/"
        }
      });

      if (!response.ok) {
        return reply.code(response.status).send({ error: `Failed to fetch media: ${response.statusText}` });
      }

      const contentType = response.headers.get("content-type");
      if (contentType) reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "public, max-age=86400");

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (err) {
      logEvent("error", "media_proxy_failed", { url, error: (err as Error).message });
      return reply.code(500).send({ error: "Internal error fetching media" });
    }
  });

  app.get("/v1/media/health", async () => {
    return { status: "ok", cacheDir: stickerCacheDir, cacheEnabled: Boolean(stickerCacheDir) };
  });
}
