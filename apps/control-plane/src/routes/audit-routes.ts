import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AUDIT_ACTION_TYPES } from "@skerry/shared";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { listAuditEntries } from "../services/audit-service.js";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
    const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

    app.get("/v1/servers/:serverId/audit-log", initializedAuthHandlers, async (request) => {
        const params = z.object({ serverId: z.string().min(1) }).parse(request.params);

        const querySchema = z.object({
            actorUserId: z.string().optional(),
            targetId: z.string().optional(),
            actionType: z.enum(AUDIT_ACTION_TYPES).optional(),
            before: z.string().optional(),
            after: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
            offset: z.coerce.number().int().min(0).default(0),
        });

        const query = querySchema.parse(request.query);
        const { entries, total } = await listAuditEntries({ serverId: params.serverId, ...query });
        return { entries, total };
    });
}
