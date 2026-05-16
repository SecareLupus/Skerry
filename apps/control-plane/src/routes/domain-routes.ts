import type { FastifyInstance } from "fastify";
import { registerSystemRoutes } from "./system-routes.js";
import { registerUserRoutes } from "./user-routes.js";
import { registerHubRoutes } from "./hub-routes.js";
import { registerServerRoutes } from "./server-routes.js";
import { registerEmojiRoutes } from "./emoji-routes.js";
import { registerChannelRoutes } from "./channel-routes.js";
import { registerChannelInitRoutes } from "./channel-init-routes.js";
import { registerMessageRoutes } from "./message-routes.js";
import { registerModerationRoutes } from "./moderation-routes.js";
import { registerAuditRoutes } from "./audit-routes.js";
import { registerVoiceRoutes } from "./voice-routes.js";
import { registerDiscordRoutes } from "./discord-routes.js";
import { registerMediaRoutes } from "./media-routes.js";
import { registerAnnouncementRoutes } from "./announcement-routes.js";
import { registerFederationRoutes } from "./federation-routes.js";
import { registerInviteRoutes } from "./invite-routes.js";
import { registerStickerRoutes } from "./sticker-routes.js";
import { registerWebhookRoutes } from "./webhook-routes.js";
import { registerPushRoutes } from "./push-routes.js";

/**
 * Registers all domain-specific routes for the Skerry platform.
 * Routes are logically partitioned into domain modules to maintain code quality and scalability.
 */
export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  // Ordered roughly by dependency and hierarchy
  await registerSystemRoutes(app);
  await registerUserRoutes(app);
  await registerHubRoutes(app);
  await registerServerRoutes(app);
  await registerEmojiRoutes(app);
  await registerChannelRoutes(app);
  await registerChannelInitRoutes(app);
  await registerMessageRoutes(app);
  await registerModerationRoutes(app);
  await registerAuditRoutes(app);
  await registerVoiceRoutes(app);
  await registerDiscordRoutes(app);
  await registerMediaRoutes(app);
  await registerAnnouncementRoutes(app);
  await registerFederationRoutes(app);
  await registerInviteRoutes(app);
  await registerStickerRoutes(app);
  await registerWebhookRoutes(app);
  await registerPushRoutes(app);
}
