import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import { listAllowedActions } from "../services/policy-service.js";
import { listChannelMembers, listChannels } from "../services/chat/channel-service.js";
import { listMessages } from "../services/chat/message-service.js";
import { getChannelReadState } from "../services/chat/read-state-service.js";
import { withDb } from "../db/client.js";
import type { ChannelInitResponse } from "@skerry/shared";

export async function registerChannelInitRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/channels/:channelId/init", initializedAuthHandlers, async (request, reply): Promise<ChannelInitResponse> => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const productUserId = request.auth!.productUserId;

    // 1. Get channel & server context
    const context = await withDb(async (db) => {
      const row = await db.query<{ server_id: string; hub_id: string }>(
        `select ch.server_id, s.hub_id 
         from channels ch 
         join servers s on s.id = ch.server_id 
         where ch.id = $1 limit 1`,
        [params.channelId]
      );
      return row.rows[0];
    });

    if (!context) {
      reply.code(404).send({ message: "Channel not found." });
      throw new Error("Channel not found"); // Fastify will handle this due to reply.code
    }

    const { server_id: serverId, hub_id: hubId } = context;

    // 2. Fetch everything in parallel for maximum efficiency
    const [channelList, messages, members, readState, permissions] = await Promise.all([
      listChannels(serverId, productUserId),
      listMessages({ channelId: params.channelId, viewerUserId: productUserId, limit: 50, parentId: null }),
      listChannelMembers(params.channelId, productUserId),
      getChannelReadState(params.channelId, productUserId),
      listAllowedActions({ 
        productUserId, 
        scope: { hubId, serverId, channelId: params.channelId }, 
        authContext: request.auth! 
      })
    ]);

    const channel = channelList.find(c => c.id === params.channelId);
    if (!channel) {
      reply.code(404).send({ message: "Channel not accessible or found." });
       throw new Error("Channel not found");
    }

    return {
      channel,
      messages: messages as any,
      members: members as any,
      readState,
      permissions
    };
  });
}
