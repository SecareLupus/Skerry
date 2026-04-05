import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession, verifyMasqueradeToken } from "./session.js";
import { hasInitializedPlatform } from "../services/bootstrap-service.js";
import { ensureIdentityTokenValid } from "../services/identity-service.js";
import { verifyFederatedToken, resolveFederatedUser } from "../services/federation-service.js";

export interface ScopedAuthContext {
  productUserId: string;
  provider: string;
  oidcSubject: string;
  realProductUserId?: string;
  isMasquerading: boolean;
  readOnly: boolean;
  masqueradeRole?: string;
  masqueradeServerId?: string;
  masqueradeBadgeIds?: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: ScopedAuthContext;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = getSession(request);
  
  // Federated trust check
  const federatedToken = request.headers["x-skerry-federated-token"];
  const federatedHub = request.headers["x-skerry-federated-hub"];

  if (typeof federatedToken === "string" && typeof federatedHub === "string") {
    try {
      const fedInfo = await verifyFederatedToken(federatedToken, federatedHub);
      if (fedInfo) {
        const fedUser = await resolveFederatedUser({ ...fedInfo, hubUrl: federatedHub });
        request.auth = {
          productUserId: fedUser.localProxyUserId,
          provider: "federated",
          oidcSubject: fedUser.federatedId,
          isMasquerading: false,
          readOnly: true, // Guest users from other hubs are read-only for now
        };
        return;
      }
    } catch (err) {
      console.warn(`[AUTH] Federated auth check failed for hub ${federatedHub}:`, err);
      // Fall through to standard session auth
    }
  }

  if (!session) {
    reply.code(401).send({
      statusCode: 401,
      error: "Unauthorized",
      code: "unauthorized",
      message: "Unauthorized",
      requestId: request.id
    });
    return;
  }

  const masqueradeToken = request.headers["x-masquerade-token"];
  let activePayload = session;

  if (typeof masqueradeToken === "string") {
    const masqueradePayload = verifyMasqueradeToken(masqueradeToken);
    if (masqueradePayload) {
      // Security check: Ensure the masquerade token belongs to the same real user
      const realUserId = session.realProductUserId || session.productUserId;
      const tokenRealUserId = masqueradePayload.realProductUserId || masqueradePayload.productUserId;

      if (realUserId === tokenRealUserId) {
        activePayload = masqueradePayload;
      } else {
        console.warn(`[AUTH] Masquerade token user mismatch. Actor=${realUserId}, TokenRel=${tokenRealUserId}`);
      }
    }
  }

  const isMasquerading = Boolean(activePayload.realProductUserId);

  request.auth = {
    productUserId: activePayload.productUserId,
    provider: activePayload.provider,
    oidcSubject: activePayload.oidcSubject,
    realProductUserId: activePayload.realProductUserId,
    isMasquerading,
    readOnly: isMasquerading,
    masqueradeRole: activePayload.masqueradeRole,
    masqueradeServerId: activePayload.masqueradeServerId,
    masqueradeBadgeIds: activePayload.masqueradeBadgeIds,
  };

  // Block mutations if masquerading (except for unmasquerade itself)
  if (isMasquerading && request.method !== "GET" && request.method !== "HEAD" && request.url !== "/auth/unmasquerade") {
    reply.code(403).send({
      statusCode: 403,
      error: "Forbidden",
      message: "Permissions denied in masquerade mode. Mutations are blocked.",
      code: "masquerade_read_only"
    });
    return;
  }

  // Background token rotation/refresh
  if (session.provider !== "federated") {
    void ensureIdentityTokenValid(session.productUserId).catch((err: unknown) => {
      console.warn(`[AUTH] Background identity token refresh failed for ${session.productUserId}:`, err);
    });
  }
}

export async function requireInitialized(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const initialized = await hasInitializedPlatform();
    if (!initialized) {
      reply
        .code(503)
        .send({
          statusCode: 503,
          error: "Service Unavailable",
          message: "Platform not initialized. Complete bootstrap first.",
          code: "not_initialized",
          requestId: request.id
        });
    }
  } catch (error) {
    reply.code(503).send({
      statusCode: 503,
      error: "Service Unavailable",
      message: error instanceof Error ? error.message : "Platform initialization check failed.",
      code: "initialization_check_failed",
      requestId: request.id
    });
  }
}
