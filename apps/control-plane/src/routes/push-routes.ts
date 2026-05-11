import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { subscribeUser, unsubscribeEndpoint } from "../services/push-service.js";
import { config } from "../config.js";

export async function registerPushRoutes(app: FastifyInstance): Promise<void> {
    const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

    // Public — no auth needed so the client can read the key before subscribing
    app.get("/v1/push/vapid-public-key", async (_request, reply) => {
        if (!config.vapidPublicKey) {
            reply.code(404).send({ error: "Push notifications not configured" });
            return;
        }
        return { publicKey: config.vapidPublicKey };
    });

    app.post("/v1/push/subscribe", initializedAuthHandlers, async (request, reply) => {
        const body = z.object({
            endpoint: z.string().url(),
            keys: z.object({
                p256dh: z.string().min(1),
                auth: z.string().min(1),
            }),
            serverId: z.string().optional().nullable(),
        }).parse(request.body);

        await subscribeUser({
            productUserId: request.auth!.productUserId,
            endpoint: body.endpoint,
            p256dhKey: body.keys.p256dh,
            authKey: body.keys.auth,
            serverId: body.serverId,
        });

        reply.code(204).send();
    });

    app.delete("/v1/push/unsubscribe", initializedAuthHandlers, async (request, reply) => {
        const body = z.object({
            endpoint: z.string().url(),
        }).parse(request.body);

        await unsubscribeEndpoint(body.endpoint);
        reply.code(204).send();
    });
}
