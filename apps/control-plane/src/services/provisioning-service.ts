import crypto from "node:crypto";
import type { Channel, ChannelType, Server } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { attachChildRoom, createChannelRoom, createSpace } from "../matrix/synapse-adapter.js";
import { withRetry } from "./retry.js";
import { applyFederationPolicyToRoom } from "./federation-service.js";
import { validateChannelStyle, type ChannelRow } from "./chat-service.js";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function hashRequest(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function checkIdempotency<T>(
  idempotencyKey: string | undefined,
  payload: unknown
): Promise<T | null> {
  if (!idempotencyKey) {
    return null;
  }

  return withDb(async (db) => {
    const requestHash = hashRequest(payload);
    const row = await db.query<{ request_hash: string; response_json: T }>(
      "select request_hash, response_json from idempotency_keys where idempotency_key = $1 limit 1",
      [idempotencyKey]
    );

    const existing = row.rows[0];
    if (!existing) {
      return null;
    }

    if (existing.request_hash !== requestHash) {
      throw new Error("Idempotency key reuse with different payload is not allowed.");
    }

    return existing.response_json;
  });
}

async function storeIdempotency<T>(idempotencyKey: string | undefined, payload: unknown, response: T): Promise<void> {
  if (!idempotencyKey) {
    return;
  }

  await withDb(async (db) => {
    await db.query(
      "insert into idempotency_keys (idempotency_key, request_hash, response_json) values ($1, $2, $3) on conflict (idempotency_key) do nothing",
      [idempotencyKey, hashRequest(payload), JSON.stringify(response)]
    );
  });
}

export async function createServerWorkflow(input: {
  hubId: string;
  name: string;
  productUserId: string;
  idempotencyKey?: string;
}): Promise<Server> {
  const cached = await checkIdempotency<Server>(input.idempotencyKey, input);
  if (cached) {
    return cached;
  }

  const matrixSpaceId = await withRetry(() => createSpace({ name: input.name }));

  const server = await withDb(async (db) => {
    const id = randomId("srv");
    const row = await db.query<{
      id: string;
      hub_id: string;
      name: string;
      matrix_space_id: string | null;
      type: "default" | "dm";
      hub_admin_access: string;
      space_member_access: string;
      hub_member_access: string;
      visitor_access: string;
      auto_join_hub_members: boolean;
      created_by_user_id: string;
      owner_user_id: string;
      created_at: string;
      join_policy: string;
      icon_url: string | null;
    }>(
      `insert into servers (id, hub_id, name, type, matrix_space_id, created_by_user_id, owner_user_id, auto_join_hub_members, hub_admin_access, space_member_access, hub_member_access, visitor_access, join_policy)
       values ($1, $2, $3, 'default', $4, $5, $6, true, 'chat', 'chat', 'chat', 'hidden', 'open')
       returning *`,
      [id, input.hubId, input.name, matrixSpaceId, input.productUserId, input.productUserId]
    );

    const value = row.rows[0];
    if (!value) {
      throw new Error("Server creation failed.");
    }

    return {
      id: value.id,
      hubId: value.hub_id,
      name: value.name,
      type: value.type,
      matrixSpaceId: value.matrix_space_id,
      iconUrl: value.icon_url,
      hubAdminAccess: value.hub_admin_access as any,
      spaceMemberAccess: value.space_member_access as any,
      hubMemberAccess: value.hub_member_access as any,
      visitorAccess: value.visitor_access as any,
      autoJoinHubMembers: value.auto_join_hub_members,
      createdByUserId: value.created_by_user_id,
      ownerUserId: value.owner_user_id,
      createdAt: value.created_at,
      joinPolicy: value.join_policy as any
    };
  });

  await applyFederationPolicyToRoom({
    hubId: input.hubId,
    roomId: server.matrixSpaceId,
    roomKind: "space",
    serverId: server.id,
    channelId: null
  });

  await storeIdempotency(input.idempotencyKey, input, server);
  return server;
}

export async function createChannelWorkflow(input: {
  serverId: string;
  categoryId?: string;
  name: string;
  type: ChannelType;
  topic?: string;
  iconUrl?: string;
  styleContent?: string;
  idempotencyKey?: string;
}): Promise<Channel> {
  const cached = await checkIdempotency<Channel>(input.idempotencyKey, input);
  if (cached) {
    return cached;
  }

  validateChannelStyle(input.styleContent);

  const matrixRoomId = await withRetry(() => createChannelRoom({ name: input.name, type: input.type }));

  let hubId = "";
  const channel = await withDb(async (db) => {
    const row = await db.query<{ matrix_space_id: string | null; hub_id: string }>(
      "select matrix_space_id, hub_id from servers where id = $1 limit 1",
      [input.serverId]
    );

    const server = row.rows[0];
    if (!server) {
      throw new Error("Server not found.");
    }
    hubId = server.hub_id;

    const id = randomId("chn");
    const voiceRoomId = input.type === "voice" ? `sfu_${id}` : null;

    const posRow = await db.query<{ max_pos: number }>(
      "select max(position) as max_pos from channels where server_id = $1",
      [input.serverId]
    );
    const position = (posRow.rows[0]?.max_pos ?? -1) + 1;

    const defaultVisitorAccess = input.type === "landing" ? "read" : "hidden";

    const created = await db.query<ChannelRow>(
      `insert into channels
       (id, server_id, category_id, name, type, matrix_room_id, position, topic, icon_url, style_content, voice_sfu_room_id, voice_max_participants, video_enabled, video_max_participants, hub_admin_access, space_member_access, hub_member_access, visitor_access)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'chat', 'chat', 'chat', $15)
       returning *`,
      [
        id,
        input.serverId,
        input.categoryId ?? null,
        input.name,
        input.type,
        matrixRoomId,
        position,
        input.topic ?? null,
        input.iconUrl ?? null,
        input.styleContent ?? null,
        voiceRoomId,
        input.type === "voice" ? 25 : null,
        false,
        input.type === "voice" ? 4 : null,
        defaultVisitorAccess
      ]
    );

    const value = created.rows[0];
    if (!value) {
      throw new Error("Channel creation failed.");
    }

    const matrixSpaceId = server.matrix_space_id;
    if (matrixSpaceId && matrixRoomId) {
      await withRetry(() => attachChildRoom(matrixSpaceId, matrixRoomId));
    }

    return {
      id: value.id,
      serverId: value.server_id,
      categoryId: value.category_id,
      name: value.name,
      type: value.type,
      matrixRoomId: value.matrix_room_id,
      position: value.position,
      isLocked: value.is_locked,
      slowModeSeconds: value.slow_mode_seconds,
      postingRestrictedToRoles: (value.posting_restricted_to_roles ?? []) as Channel["postingRestrictedToRoles"],
      hubAdminAccess: value.hub_admin_access as any,
      spaceMemberAccess: value.space_member_access as any,
      hubMemberAccess: value.hub_member_access as any,
      visitorAccess: value.visitor_access as any,
      voiceMetadata:
        value.voice_sfu_room_id && value.voice_max_participants
          ? {
            sfuRoomId: value.voice_sfu_room_id,
            maxParticipants: value.voice_max_participants,
            videoEnabled: value.video_enabled,
            maxVideoParticipants: value.video_max_participants
          }
          : null,
      topic: value.topic,
      styleContent: value.style_content,
      createdAt: value.created_at
    };
  });
  await applyFederationPolicyToRoom({
    hubId,
    roomId: channel.matrixRoomId,
    roomKind: "room",
    serverId: input.serverId,
    channelId: channel.id
  });

  await storeIdempotency(input.idempotencyKey, input, channel);
  return channel;
}
