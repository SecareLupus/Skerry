import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAuthorizationRedirect, exchangeAuthorizationCode } from "../auth/oidc.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import {
  findUniqueProductUserIdByEmail,
  getIdentityByProductUserId,
  getIdentityByProviderSubject,
  isOnboardingComplete,
  isPreferredUsernameTaken,
  listIdentitiesByProductUserId,
  setPreferredUsernameForProductUser,
  upsertIdentityMapping,
  updateUserTheme,
  updateUserProfile,
  blockUser,
  unblockUser,
  listBlocks
} from "../services/identity-service.js";
import { requireAuth } from "../auth/middleware.js";
import type { AccountLinkingRequirement, IdentityProvider } from "@skerry/shared";
import { config } from "../config.js";
import { bootstrapAdmin, getBootstrapStatus } from "../services/bootstrap-service.js";
import {
  completeDiscordOauthAndListGuilds,
  consumeDiscordOauthState
} from "../services/discord-bridge-service.js";
import { withDb } from "../db/client.js";
import { canManageHub, listRoleBindings } from "../services/policy-service.js";
import { listHubsForUser } from "../services/hub-service.js";
import { createMasqueradeToken, createSessionToken, type SessionPayload } from "../auth/session.js";
import { MasqueradeParamsSchema } from "@skerry/shared";

const providerSchema = z.enum(["discord", "keycloak", "google", "github", "twitch", "dev"]);

function providerEnabled(provider: IdentityProvider): boolean {
  if (provider === "discord") {
    return Boolean(config.oidc.discordClientId);
  }
  if (provider === "google") {
    return Boolean(config.oidc.googleClientId);
  }
  if (provider === "twitch") {
    return Boolean(config.oidc.twitchClientId);
  }
  if (provider === "dev") {
    return config.devAuthBypass;
  }
  return false;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/bootstrap-status", async (_, reply) => {
    try {
      return await getBootstrapStatus();
    } catch (error) {
      reply.code(503).send({
        initialized: false,
        code: "bootstrap_status_unavailable",
        message: error instanceof Error ? error.message : "Bootstrap status unavailable."
      });
    }
  });

  app.get("/auth/providers", async () => {
    const providers: AccountLinkingRequirement[] = [
      {
        provider: "discord",
        displayName: "Discord",
        isEnabled: providerEnabled("discord"),
        requiresReauthentication: false
      },
      {
        provider: "google",
        displayName: "Google",
        isEnabled: providerEnabled("google"),
        requiresReauthentication: false
      },
      {
        provider: "twitch",
        displayName: "Twitch",
        isEnabled: providerEnabled("twitch"),
        requiresReauthentication: false
      },
      {
        provider: "github",
        displayName: "GitHub",
        isEnabled: false,
        requiresReauthentication: true
      },
      {
        provider: "dev",
        displayName: "Developer Login",
        isEnabled: providerEnabled("dev"),
        requiresReauthentication: false
      }
    ];
    const primaryProvider =
      providers.find((provider) => provider.provider === "dev" && provider.isEnabled)?.provider ??
      providers.find((provider) => provider.provider === "discord" && provider.isEnabled)?.provider ??
      providers.find((provider) => provider.provider === "google" && provider.isEnabled)?.provider ??
      providers.find((provider) => provider.provider === "twitch" && provider.isEnabled)?.provider ??
      "discord";

    return { primaryProvider, providers };
  });

  app.post("/auth/dev-login", async (request, reply) => {
    if (!config.devAuthBypass) {
      reply.code(404).send({ message: "Developer auth is disabled." });
      return;
    }

    const payload = z
      .object({
        username: z.string().min(3).max(40).default("local-admin"),
        email: z.string().email().optional()
      })
      .parse(request.body ?? {});

    const normalizedSubject = payload.username.trim().toLowerCase().replaceAll(/\s+/g, "-");
    const identity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: normalizedSubject,
      email: payload.email ?? `${normalizedSubject}@dev.local`,
      preferredUsername: null,
      avatarUrl: null
    });

    setSessionCookie(reply, {
      productUserId: identity.productUserId,
      provider: identity.provider,
      oidcSubject: identity.oidcSubject
    });

    return {
      productUserId: identity.productUserId,
      provider: identity.provider,
      preferredUsername: identity.preferredUsername
    };
  });

  app.get("/auth/dev-login", async (request, reply) => {
    if (!config.devAuthBypass) {
      reply.code(404).send({ message: "Developer auth is disabled." });
      return;
    }

    const query = z
      .object({
        username: z.string().min(3).max(40).default("local-admin"),
        email: z.string().email().optional(),
        redirectTo: z.string().url().optional()
      })
      .parse(request.query);

    const normalizedSubject = query.username.trim().toLowerCase().replaceAll(/\s+/g, "-");
    const identity = await upsertIdentityMapping({
      provider: "dev",
      oidcSubject: normalizedSubject,
      email: query.email ?? `${normalizedSubject}@dev.local`,
      preferredUsername: null,
      avatarUrl: null
    });

    setSessionCookie(reply, {
      productUserId: identity.productUserId,
      provider: identity.provider,
      oidcSubject: identity.oidcSubject
    });

    reply.redirect(query.redirectTo ?? config.webBaseUrl, 302);
  });

  app.get("/auth/login/:provider", async (request, reply) => {
    const { provider } = z.object({ provider: providerSchema }).parse(request.params);
    if (provider === "dev") {
      reply.code(404).send({ message: "Use POST /auth/dev-login for developer login." });
      return;
    }
    if (!providerEnabled(provider)) {
      reply.code(404).send({ message: `Provider ${provider} is not enabled.` });
      return;
    }
    const redirect = createAuthorizationRedirect({ provider, intent: "login" });
    reply.redirect(redirect, 302);
  });

  app.get("/auth/link/:provider", { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = z.object({ provider: providerSchema }).parse(request.params);
    if (provider === "dev") {
      reply.code(404).send({ message: "Developer auth does not support account linking." });
      return;
    }
    if (!providerEnabled(provider)) {
      reply.code(404).send({ message: `Provider ${provider} is not enabled.` });
      return;
    }
    const redirect = createAuthorizationRedirect({
      provider,
      intent: "link",
      productUserId: request.auth!.productUserId
    });
    reply.redirect(redirect, 302);
  });
  app.get("/auth/callback/:provider", async (request, reply) => {
    const { provider } = z.object({ provider: providerSchema }).parse(request.params);
    if (provider === "dev") {
      reply.code(400).send({ message: "Developer auth does not use callback endpoints." });
      return;
    }

    const query = z.object({
      code: z.string(),
      state: z.string(),
      guild_id: z.string().optional()
    }).parse(request.query);

    // Dispatch to Discord Bridge if state matches our bridge prefix
    if (provider === "discord" && query.state.startsWith("dboauth_")) {
      const state = consumeDiscordOauthState(query.state);
      if (!state) {
        reply.code(400).send({ message: "Invalid Discord bridge OAuth state." });
        return;
      }

      // Bridge setup requires authentication
      await requireAuth(request, reply);
      if (reply.sent) return;

      if (state.productUserId !== request.auth!.productUserId) {
        reply.code(403).send({ message: "Discord bridge OAuth state mismatch." });
        return;
      }

      const completed = await completeDiscordOauthAndListGuilds({
        serverId: state.serverId,
        productUserId: request.auth!.productUserId,
        code: query.code,
        guildId: query.guild_id
      });

      const redirect = new URL(state.returnTo || "/", config.webBaseUrl);
      redirect.searchParams.set("discordPendingSelection", completed.pendingSelectionId);
      if (completed.selectedGuildId) {
        redirect.searchParams.set("discordGuildId", completed.selectedGuildId);
      }
      reply.redirect(redirect.toString(), 302);
      return;
    }

    const exchanged = await exchangeAuthorizationCode(query);
    const profile = exchanged.profile;

    if (provider !== profile.provider) {
      reply.code(400).send({ message: "OIDC callback provider mismatch." });
      return;
    }

    const linkedIdentity = await getIdentityByProviderSubject({
      provider: profile.provider,
      oidcSubject: profile.oidcSubject
    });

    let identity = linkedIdentity;
    if (exchanged.intent === "link") {
      if (!exchanged.productUserId) {
        reply.code(400).send({ message: "Missing account-linking session context." });
        return;
      }
      if (linkedIdentity && linkedIdentity.productUserId !== exchanged.productUserId) {
        reply.code(409).send({
          message: "This provider account is already linked to another user.",
          code: "identity_already_linked"
        });
        return;
      }
      if (!linkedIdentity) {
        identity = await upsertIdentityMapping({
          provider: profile.provider,
          oidcSubject: profile.oidcSubject,
          email: profile.email,
          preferredUsername: null,
          avatarUrl: profile.avatarUrl,
          productUserId: exchanged.productUserId,
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          tokenExpiresAt: exchanged.tokenExpiresAt
        });
      }
    } else if (!linkedIdentity) {
      const existingUserIdFromEmail =
        profile.email ? await findUniqueProductUserIdByEmail(profile.email) : null;
      identity = await upsertIdentityMapping({
        provider: profile.provider,
        oidcSubject: profile.oidcSubject,
        email: profile.email,
        preferredUsername: null,
        avatarUrl: profile.avatarUrl,
        productUserId: existingUserIdFromEmail ?? undefined,
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        tokenExpiresAt: exchanged.tokenExpiresAt
      });
    }

    if (!identity) {
      throw new Error("Identity mapping could not be resolved.");
    }

    setSessionCookie(reply, {
      productUserId: identity.productUserId,
      provider: identity.provider,
      oidcSubject: identity.oidcSubject
    });

    const destinationUrl = new URL(config.webBaseUrl);
    if (exchanged.intent === "link") {
      destinationUrl.searchParams.set("linked", profile.provider);
    } else if (profile.username) {
      destinationUrl.searchParams.set("suggestedUsername", profile.username);
    }
    const destination = destinationUrl.toString();
    reply.redirect(destination, 302);
  });

  app.get("/auth/session/me", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) {
      throw new Error("Auth context missing");
    }

    const [activeIdentity, identities, onboardingComplete] = await Promise.all([
      getIdentityByProviderSubject({
        provider: auth.provider as any,
        oidcSubject: auth.oidcSubject
      }),
      listIdentitiesByProductUserId(auth.productUserId),
      isOnboardingComplete(auth.productUserId)
    ]);

    const fallbackIdentity = await getIdentityByProductUserId(auth.productUserId);
    const resolvedIdentity = activeIdentity ?? fallbackIdentity;

    if (!resolvedIdentity) {
      // If we have a session but NO identity exists in the DB, the DB was likely reset.
      // We should clear the session and return 401 to force the user to re-login.
      clearSessionCookie(reply);
      reply.code(401).send({
        statusCode: 401,
        message: "Identity not found. Re-authorization required.",
        code: "identity_not_found"
      });
      return;
    }

    return {
      productUserId: auth.productUserId,
      identity: {
        provider: resolvedIdentity.provider,
        oidcSubject: resolvedIdentity.oidcSubject,
        email: resolvedIdentity.email,
        preferredUsername: resolvedIdentity.preferredUsername,
        avatarUrl: resolvedIdentity.avatarUrl,
        displayName: resolvedIdentity.displayName,
        bio: resolvedIdentity.bio,
        customStatus: resolvedIdentity.customStatus,
        matrixUserId: resolvedIdentity.matrixUserId,
        theme: resolvedIdentity.theme
      },
      linkedIdentities: identities.map((identity) => ({
        provider: identity.provider,
        oidcSubject: identity.oidcSubject,
        email: identity.email,
        preferredUsername: identity.preferredUsername,
        avatarUrl: identity.avatarUrl,
        displayName: identity.displayName,
        bio: identity.bio,
        customStatus: identity.customStatus,
        theme: identity.theme
      })),
      needsOnboarding: !onboardingComplete,
      isMasquerading: auth.isMasquerading,
      realProductUserId: auth.realProductUserId,
      masqueradeRole: auth.masqueradeRole,
      masqueradeServerId: auth.masqueradeServerId,
      masqueradeBadgeIds: auth.masqueradeBadgeIds
    };
  });

  app.patch("/auth/session/me/theme", { preHandler: requireAuth }, async (request, reply) => {
    const { theme } = z.object({ theme: z.enum(["light", "dark"]) }).parse(request.body);
    await updateUserTheme(request.auth!.productUserId, theme);
    reply.code(204).send();
  });

  app.patch("/auth/session/me/profile", { preHandler: requireAuth }, async (request, reply) => {
    const payload = z.object({
      displayName: z.string().max(80).nullable().optional(),
      bio: z.string().max(256).nullable().optional(),
      customStatus: z.string().max(128).nullable().optional(),
      avatarUrl: z.string().url().nullable().optional(),
    }).parse(request.body);

    await updateUserProfile(request.auth!.productUserId, payload);
    reply.code(204).send();
  });

  app.get("/auth/blocks", { preHandler: requireAuth }, async (request) => {
    const blockedUserIds = await listBlocks(request.auth!.productUserId);
    return { items: blockedUserIds };
  });

  app.post("/auth/blocks", { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(request.body);
    await blockUser(request.auth!.productUserId, userId);
    reply.code(204).send();
  });

  app.delete("/auth/blocks/:userId", { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(request.params);
    await unblockUser(request.auth!.productUserId, userId);
    reply.code(204).send();
  });

  app.post("/auth/onboarding/username", { preHandler: requireAuth }, async (request, reply) => {
    const payload = z
      .object({
        username: z
          .string()
          .min(3)
          .max(40)
          .regex(/^[a-zA-Z0-9._-]+$/)
      })
      .parse(request.body);

    const normalizedUsername = payload.username.trim();
    const taken = await isPreferredUsernameTaken({
      preferredUsername: normalizedUsername,
      excludingProductUserId: request.auth!.productUserId
    });
    if (taken) {
      reply.code(409).send({
        message: "Username is already taken.",
        code: "username_taken"
      });
      return;
    }

    await setPreferredUsernameForProductUser({
      productUserId: request.auth!.productUserId,
      preferredUsername: normalizedUsername
    });
    reply.code(204).send();
  });

  app.post("/auth/masquerade-token", { preHandler: requireAuth }, async (request, reply) => {
    const actor = request.auth!;
    if (actor.isMasquerading) {
      reply.code(400).send({ message: "Already masquerading." });
      return;
    }

    const { role, serverId, badgeIds } = z.object({
      role: z.enum(["hub_owner", "hub_admin", "space_owner", "space_admin", "space_moderator", "user", "visitor"]),
      serverId: z.string().optional(),
      badgeIds: z.array(z.string()).optional()
    }).parse(request.body);

    // 1. Authorization checks
    const actorRoles = await listRoleBindings({ productUserId: actor.productUserId });
    const isHubAdmin = actorRoles.some(rb => rb.role === "hub_owner" || rb.role === "hub_admin");
    const isSpaceAdmin = actorRoles.some(rb => (rb.role === "space_owner" || rb.role === "space_admin") && rb.serverId === serverId);

    // Hub Admin+ can masquerade as anything
    // Space Admin+ can masquerade as anything within their space
    if (!isHubAdmin && (!serverId || !isSpaceAdmin)) {
      reply.code(403).send({ message: "You do not have permission to masquerade with these parameters." });
      return;
    }

    // 2. Prepare payload
    const payload: SessionPayload = {
      productUserId: actor.productUserId,
      provider: actor.provider,
      oidcSubject: actor.oidcSubject,
      realProductUserId: actor.productUserId,
      masqueradeRole: role,
      masqueradeServerId: serverId,
      masqueradeBadgeIds: badgeIds
    };

    const token = createMasqueradeToken(payload);

    return { token };
  });

  app.post("/auth/unmasquerade", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    if (!auth.isMasquerading || !auth.realProductUserId) {
      reply.code(400).send({ message: "Not currently masquerading." });
      return;
    }

    // Restore original session
    const originalIdentities = await listIdentitiesByProductUserId(auth.realProductUserId);
    const originalIdentity = originalIdentities[0];

    if (!originalIdentity) {
      reply.code(500).send({ message: "Could not restore original identity." });
      return;
    }

    const payload: SessionPayload = {
      productUserId: auth.realProductUserId,
      provider: originalIdentity.provider,
      oidcSubject: originalIdentity.oidcSubject,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours in MS
    };

    setSessionCookie(reply, payload);

    return { success: true, restoredProductUserId: auth.realProductUserId };
  });

  app.route({
    method: ["GET", "POST"],
    url: "/auth/logout",
    handler: async (request, reply) => {
      clearSessionCookie(reply);
      if (request.method === "GET") {
        reply.redirect(config.webBaseUrl, 302);
      } else {
        reply.code(204).send();
      }
    }
  });

  app.post("/auth/bootstrap-admin", { preHandler: requireAuth }, async (request, reply) => {
    if (!config.setupBootstrapEnabled) {
      reply.code(403).send({ message: "Bootstrap endpoint is disabled." });
      return;
    }

    const payload = z
      .object({
        setupToken: z.string().min(1),
        hubName: z.string().min(2).max(80)
      })
      .parse(request.body);

    try {
      const result = await bootstrapAdmin({
        productUserId: request.auth!.productUserId,
        setupToken: payload.setupToken,
        expectedSetupToken: config.setupBootstrapToken,
        hubName: payload.hubName
      });

      reply.code(201);
      return {
        initialized: true,
        hubId: result.hubId,
        defaultServerId: result.defaultServerId,
        defaultChannelId: result.defaultChannelId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bootstrap failed.";

      if (message === "Platform bootstrap already completed.") {
        reply.code(409).send({ message, code: "bootstrap_already_completed" });
        return;
      }

      if (message === "Invalid bootstrap token.") {
        reply.code(403).send({ message, code: "invalid_bootstrap_token" });
        return;
      }

      if (message === "Bootstrap token is not configured.") {
        reply.code(500).send({ message, code: "bootstrap_token_missing" });
        return;
      }

      throw error;
    }
  });
}
