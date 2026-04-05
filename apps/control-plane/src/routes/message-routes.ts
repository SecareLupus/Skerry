import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireInitialized } from "../auth/middleware.js";
import {
  isActionAllowed
} from "../services/policy-service.js";
import {
  listMessages,
  searchMessages,
  listMessagesAround,
  createMessage,
  updateMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
  listPins,
  fetchMessage
} from "../services/chat/message-service.js";
import {
  addReaction,
  removeReaction
} from "../services/chat/reaction-service.js";
import {
  getFirstUnreadMessageId,
  listMentionMarkers
} from "../services/chat/read-state-service.js";
import {
  getOrCreateDMChannel
} from "../services/chat/channel-service.js";
import {
  isUserTimedOut
} from "../services/moderation-service.js";
import {
  getIdentityByProductUserId
} from "../services/identity-service.js";
import { publishChannelMessage } from "../services/chat-realtime.js";
import { withDb } from "../db/client.js";

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  const initializedAuthHandlers = { preHandler: [requireAuth, requireInitialized] };

  app.get("/v1/channels/:channelId/messages", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        before: z.string().optional(),
        after: z.string().optional()
      })
      .parse(request.query);

    return {
      items: await listMessages({
        channelId: params.channelId,
        viewerUserId: request.auth!.productUserId,
        ...query
      })
    };
  });

  app.get("/v1/channels/:channelId/messages/search", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const query = z.object({ q: z.string().min(1) }).parse(request.query);

    return {
      items: await searchMessages({
        channelId: params.channelId,
        viewerUserId: request.auth!.productUserId,
        query: query.q,
        limit: 50 // Added missing limit to satisfy searchMessages signature
      })
    };
  });

  app.get("/v1/servers/:serverId/messages/search", initializedAuthHandlers, async (request) => {
    const params = z.object({ serverId: z.string().min(1) }).parse(request.params);
    const query = z.object({ q: z.string().min(1) }).parse(request.query);

    return {
      items: await searchMessages({
        serverId: params.serverId,
        viewerUserId: request.auth!.productUserId,
        query: query.q,
        limit: 50 // Added missing limit
      })
    };
  });

  app.get("/v1/channels/:channelId/messages/:messageId/around", initializedAuthHandlers, async (request) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);

    return {
      items: await listMessagesAround(
        params.messageId,
        params.channelId,
        query.limit,
        request.auth!.productUserId
      )
    };
  });

  app.get("/v1/channels/:channelId/unread-message", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    return getFirstUnreadMessageId(params.channelId, request.auth!.productUserId);
  });

  app.get("/v1/channels/:channelId/mentions", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    return { 
      items: await listMentionMarkers({ 
        channelId: params.channelId, 
        productUserId: request.auth!.productUserId 
      }) 
    };
  });

  app.post("/v1/channels/:channelId/messages", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z
      .object({
        content: z.string().trim().min(1).max(2000),
        externalTransactionId: z.string().optional(),
        mediaUrls: z.array(z.string().url()).max(8).optional()
      })
      .parse(request.body);

    const timedOut = await isUserTimedOut(request.auth!.productUserId, { channelId: params.channelId });
    if (timedOut) {
      reply.code(400).send({ message: "You are temporarily restricted from sending messages." });
      return;
    }

    const message = await createMessage({
      channelId: params.channelId,
      actorUserId: request.auth!.productUserId,
      content: payload.content,
      attachments: payload.mediaUrls?.map(url => {
        // Infer content type from the URL's file extension
        const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
        const contentTypeMap: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
          mp4: "video/mp4",
          webm: "video/webm"
        };
        return {
          id: "att_" + Math.random().toString(36).slice(2),
          url,
          contentType: contentTypeMap[ext] ?? "application/octet-stream",
          filename: url.split("/").pop()?.split("?")[0] ?? "attachment"
        };
      })
    });

    publishChannelMessage(message);

    reply.code(201);
    return message;
  });

  app.patch("/v1/channels/:channelId/messages/:messageId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);
    const payload = z.object({
      content: z.string().trim().min(1).max(2000)
    }).parse(request.body);

    try {
      const message = await updateMessage({
        messageId: params.messageId,
        actorUserId: request.auth!.productUserId,
        content: payload.content
      });

      publishChannelMessage(message, "message.updated");
      return message;
    } catch (error) {
      if (error instanceof Error && error.message === "Message not found or not authored by user.") {
        reply.code(403).send({ message: "Forbidden: message not found or access denied." });
        return;
      }
      throw error;
    }
  });

  app.delete("/v1/channels/:channelId/messages/:messageId", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);

    const allowed = await isActionAllowed({
      productUserId: request.auth!.productUserId,
      action: "moderation.redact",
      scope: {
        serverId: (await withDb(async (db) => {
          const row = await db.query<{ server_id: string }>("select server_id from channels where id = $1", [params.channelId]);
          return row.rows[0]?.server_id;
        })) ?? ""
      }
    });

    await deleteMessage({
      messageId: params.messageId,
      actorUserId: request.auth!.productUserId,
      isModerator: allowed
    });

    publishChannelMessage({ id: params.messageId, channelId: params.channelId } as any, "message.deleted");
    reply.code(204).send();
  });

  app.get("/v1/channels/:channelId/pins", initializedAuthHandlers, async (request) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    return { items: await listPins(params.channelId) };
  });

  app.post("/v1/channels/:channelId/messages/:messageId/pin", initializedAuthHandlers, async (request) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);

    const message = await pinMessage({
      messageId: params.messageId,
      actorUserId: request.auth!.productUserId
    });

    publishChannelMessage(message, "message.updated");
    return message;
  });

  app.delete("/v1/channels/:channelId/messages/:messageId/pin", initializedAuthHandlers, async (request) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);

    const message = await unpinMessage({
      messageId: params.messageId,
      actorUserId: request.auth!.productUserId
    });

    publishChannelMessage(message, "message.updated");
    return message;
  });

  app.post("/v1/channels/:channelId/messages/:messageId/reactions", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1)
    }).parse(request.params);
    const payload = z.object({
      emoji: z.string().min(1).max(32)
    }).parse(request.body);

    const timedOut = await isUserTimedOut(request.auth!.productUserId, { channelId: params.channelId });
    if (timedOut) {
      reply.code(400).send({ message: "You are temporarily restricted from performing this action." });
      return;
    }

    await addReaction({
      messageId: params.messageId,
      userId: request.auth!.productUserId,
      emoji: payload.emoji
    });

    const message = await fetchMessage(params.channelId, params.messageId, request.auth!.productUserId);
    if (message) {
      publishChannelMessage(message, "message.updated");
    }

    reply.code(204).send();
  });

  app.delete("/v1/channels/:channelId/messages/:messageId/reactions/:emoji", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1),
      emoji: z.string().min(1).max(32)
    }).parse(request.params);

    await removeReaction({
      messageId: params.messageId,
      userId: request.auth!.productUserId,
      emoji: params.emoji
    });

    const message = await fetchMessage(params.channelId, params.messageId, request.auth!.productUserId);
    if (message) {
      publishChannelMessage(message, "message.updated");
    }

    reply.code(204).send();
  });

  app.post("/v1/channels/:channelId/typing", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ channelId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      isTyping: z.boolean()
    }).parse(request.body);

    const identity = await getIdentityByProductUserId(request.auth!.productUserId);
    if (!identity) return;

    publishChannelMessage({
      id: "typing-" + request.auth!.productUserId,
      channelId: params.channelId,
      authorUserId: request.auth!.productUserId,
      authorDisplayName: identity.displayName,
      content: "",
      createdAt: new Date().toISOString()
    } as any, payload.isTyping ? "typing.start" : "typing.stop");

    reply.code(204).send();
  });

  app.post("/v1/hubs/:hubId/dms", initializedAuthHandlers, async (request, reply) => {
    const params = z.object({ hubId: z.string().min(1) }).parse(request.params);
    const payload = z.object({
      userIds: z.array(z.string().min(1)).min(1).max(10)
    }).parse(request.body);

    const userIds = [...new Set([request.auth!.productUserId, ...payload.userIds])];
    const channel = await getOrCreateDMChannel(params.hubId, userIds);
    reply.code(201);
    return channel;
  });
}
