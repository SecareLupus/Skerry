import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  getIdentityByProductUserId,
  searchIdentities
} from "../services/identity-service.js";
import { fetchDiscordUserProfile } from "../services/discord-bot-client.js";
import { getUnreadSummary } from "../services/chat/read-state-service.js";
import { updateUserPresence } from "../services/presence-service.js";
import {
  listAllowedActions,
  listRoleBindings,
  canManageServer
} from "../services/policy-service.js";
import {
  getUserSettings,
  updateUserSettings
} from "../services/settings-service.js";
import { logEvent } from "../services/observability-service.js";

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/users/search", initializedAuthHandlers, async (request) => {
    const query = z.object({ q: z.string().min(1) }).parse(request.query);
    return { items: await searchIdentities(query.q) };
  });

  app.get("/v1/users/:userId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);

    // Check if it's a bridged Discord user
    if (params.userId.startsWith("discord_")) {
      const discordUserId = params.userId.replace("discord_", "");
      try {
        const discordProfile = await fetchDiscordUserProfile(discordUserId);
        if (discordProfile) {
          return {
            id: params.userId,
            productUserId: params.userId,
            provider: "discord",
            displayName: discordProfile.displayName,
            preferredUsername: discordProfile.username,
            avatarUrl: discordProfile.avatarUrl,
            isBridged: true
          };
        }
      } catch (err) {
        logEvent("error", "discord_bridge_user_fetch_failed", { discordUserId, error: String(err) });
      }
    }

    const user = await getIdentityByProductUserId(params.userId);
    if (!user) {
      reply.code(404).send({ message: "User not found." });
      return;
    }
    return user;
  });

  app.get("/v1/me/notifications", initializedAuthHandlers, async (request) => {
    const summary = await getUnreadSummary(request.auth!.productUserId);
    return { summary };
  });

  app.post("/v1/me/presence", initializedAuthHandlers, async (request, reply) => {
    await updateUserPresence(request.auth!.productUserId);
    reply.code(204).send();
  });

  app.get("/v1/me/roles", initializedAuthHandlers, async (request) => {
    return {
      items: await listRoleBindings({
        productUserId: request.auth!.productUserId,
        authContext: request.auth
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
        serverId: query.serverId,
        authContext: request.auth
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
        },
        authContext: request.auth
      })
    };
  });
}
