import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { canManageHub, canManageServer } from "../services/policy-service.js";
import {
  createHubInvite,
  getHubInvite,
  useHubInvite
} from "../services/chat/server-service.js";
import { withDb } from "../db/client.js";
import { INVITE_BAKEABLE_ROLES, type InviteBakeableRole } from "@skerry/shared";

const inviteRoleSchema = z.enum(
  [...INVITE_BAKEABLE_ROLES] as [InviteBakeableRole, ...InviteBakeableRole[]]
);

export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.post("/v1/hubs/:hubId/invites", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      expiresAt: z.string().datetime().optional(),
      maxUses: z.number().int().min(1).optional(),
      defaultRole: inviteRoleSchema.optional(),
      defaultServerId: z.string().min(1).optional()
    }).parse(request.body ?? {});

    const productUserId = request.auth!.productUserId;
    const isHubManager = await canManageHub({ productUserId, hubId: params.hubId });
    if (!isHubManager) {
      reply.code(403).send({ message: "Forbidden: insufficient hub management scope." });
      return;
    }

    if (payload.defaultServerId) {
      const serverRow = await withDb((db) =>
        db.query<{ hub_id: string }>("select hub_id from servers where id = $1", [
          payload.defaultServerId
        ])
      );
      const owningHubId = serverRow.rows[0]?.hub_id;
      if (!owningHubId) {
        reply.code(400).send({
          message: "defaultServerId does not exist.",
          code: "invite_invalid_default_server"
        });
        return;
      }
      if (owningHubId !== params.hubId) {
        reply.code(400).send({
          message: "defaultServerId belongs to a different hub.",
          code: "invite_invalid_default_server"
        });
        return;
      }
    }

    const role = payload.defaultRole;
    if (role && role.startsWith("space_") && !payload.defaultServerId) {
      reply.code(400).send({
        message: "Space-scoped roles require a defaultServerId.",
        code: "invite_role_requires_server"
      });
      return;
    }

    if (role && (role === "space_admin" || role === "space_moderator")) {
      // Hub managers may always grant space roles within their hub.
      // Otherwise the caller must be a manager of the named server.
      if (!isHubManager) {
        const canManageNamedServer = payload.defaultServerId
          ? await canManageServer({
              productUserId,
              serverId: payload.defaultServerId
            })
          : false;
        if (!canManageNamedServer) {
          reply.code(403).send({
            message: "Forbidden: insufficient scope to bake this role into an invite.",
            code: "invite_role_forbidden"
          });
          return;
        }
      }
    }

    const invite = await createHubInvite({
      hubId: params.hubId,
      createdByUserId: productUserId,
      expiresAt: payload.expiresAt,
      maxUses: payload.maxUses,
      defaultRole: payload.defaultRole ?? null,
      defaultServerId: payload.defaultServerId ?? null
    });

    reply.code(201);
    return invite;
  });

  app.get("/v1/invites/:inviteId", async (request, reply) => {
    const params = z.object({ inviteId: z.string().min(1) }).parse(request.params);
    const invite = await getHubInvite(params.inviteId);
    if (!invite) {
      reply.code(404).send({ message: "Invite not found." });
      return;
    }
    return invite;
  });

  app.post("/v1/invites/:inviteId/join", initializedAuthHandlers, async (request) => {
    const params = z.object({ inviteId: z.string().min(1) }).parse(request.params);
    return useHubInvite({
      inviteId: params.inviteId,
      productUserId: request.auth!.productUserId
    });
  });
}
