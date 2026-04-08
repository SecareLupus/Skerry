import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  isActionAllowed,
  canManageServer,
  grantRole
} from "../services/policy-service.js";
import {
  performModerationAction,
  createReport,
  transitionReportStatus,
  listReports,
  performBulkModerationAction,
  listAuditLogs
} from "../services/moderation-service.js";

export async function registerModerationRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.post("/v1/roles/grant", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        productUserId: z.string().min(1),
        role: z.enum(["hub_admin", "space_admin", "space_moderator", "user"]),
        hubId: z.string().optional(),
        serverId: z.string().optional(),
        channelId: z.string().optional()
      })
      .parse(request.body);

    await grantRole({
      actorUserId: request.auth!.productUserId,
      ...payload
    });
    reply.code(204).send();
  });

  app.post("/v1/moderation/actions", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        action: z.enum(["kick", "ban", "unban", "timeout", "warn", "strike", "redact_message"]),
        hubId: z.string().optional(),
        serverId: z.string().optional(),
        channelId: z.string().optional(),
        targetUserId: z.string().optional(),
        targetMessageId: z.string().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
        reason: z.string().min(3)
      })
      .parse(request.body);

    await performModerationAction({ ...payload, actorUserId: request.auth!.productUserId });
    reply.code(204).send();
  });

  app.post("/v1/reports", initializedAuthHandlers, async (request, reply) => {
    const payload = z
      .object({
        serverId: z.string().min(1),
        channelId: z.string().optional(),
        targetUserId: z.string().optional(),
        targetMessageId: z.string().optional(),
        reason: z.string().min(3)
      })
      .parse(request.body);

    const report = await createReport({ ...payload, reporterUserId: request.auth!.productUserId });
    reply.code(201);
    return report;
  });

  app.patch("/v1/reports/:reportId", initializedAuthHandlers, async (request) => {
    const params = z.object({ reportId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        serverId: z.string().min(1),
        status: z.enum(["triaged", "resolved", "dismissed"]),
        reason: z.string().min(3)
      })
      .parse(request.body);

    return transitionReportStatus({
      actorUserId: request.auth!.productUserId,
      reportId: params.reportId,
      ...payload
    });
  });

  app.get("/v1/reports", initializedAuthHandlers, async (request, reply) => {
    const query = z
      .object({
        serverId: z.string().min(1),
        status: z.enum(["open", "triaged", "resolved", "dismissed"]).optional()
      })
      .parse(request.query);

    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "reports.triage",
      scope: { serverId: query.serverId },
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: report access is outside assigned scope.", code: "forbidden_scope" });
      return;
    }

    return {
      items: await listReports({
        serverId: query.serverId,
        status: query.status
      })
    };
  });

  app.get("/v1/audit-logs", initializedAuthHandlers, async (request, reply) => {
    const query = z.object({ serverId: z.string().min(1) }).parse(request.query);
    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "audit.read",
      scope: { serverId: query.serverId },
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: audit access is outside assigned scope.", code: "forbidden_scope" });
      return;
    }
    return { items: await listAuditLogs(query.serverId) };
  });

  app.post("/v1/servers/:serverId/members/bulk-moderate", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      targetUserIds: z.array(z.string().min(1)).min(1).max(100),
      action: z.enum(["kick", "ban", "unban", "timeout"]),
      reason: z.string().min(1).max(500),
      timeoutSeconds: z.number().int().min(1).optional()
    }).parse(request.body);

    const allowed = await canManageServer({
      productUserId: request.auth!.productUserId,
      serverId: params.serverId,
      authContext: request.auth
    });
    if (!allowed) {
      reply.code(403).send({ message: "Forbidden: insufficient server management scope." });
      return;
    }

    const results = await performBulkModerationAction({
      actorUserId: request.auth!.productUserId,
      serverId: params.serverId,
      targetUserIds: payload.targetUserIds,
      action: payload.action,
      reason: payload.reason,
      timeoutSeconds: payload.timeoutSeconds
    });

    return results;
  });
}
