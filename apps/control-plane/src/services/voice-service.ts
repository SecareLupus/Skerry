import { AccessToken } from "livekit-server-sdk";
import type { VoiceTokenGrant } from "@escapehatch/shared";
import { withDb } from "../db/client.js";
import { executePrivilegedAction } from "./privileged-gateway.js";
import { config } from "../config.js";
import { getIdentityByProductUserId } from "./identity-service.js";

export async function issueVoiceToken(input: {
  actorUserId: string;
  serverId: string;
  channelId: string;
  videoQuality?: "low" | "medium" | "high";
}): Promise<VoiceTokenGrant> {
  return executePrivilegedAction({
    actorUserId: input.actorUserId,
    action: "voice.token.issue",
    scope: { serverId: input.serverId, channelId: input.channelId },
    reason: "voice_session_join",
    run: async () => {
      const channel = await withDb(async (db) => {
        const row = await db.query<{
          server_id: string;
          voice_sfu_room_id: string | null;
          type: string;
        }>(
          "select server_id, voice_sfu_room_id, type from channels where id = $1 and server_id = $2 limit 1",
          [input.channelId, input.serverId]
        );

        return row.rows[0];
      });

      if (!channel || channel.type !== "voice" || !channel.voice_sfu_room_id) {
        throw new Error("Channel is not configured as a voice channel.");
      }

      const ttlSeconds = Math.max(60, config.voice.tokenTtlSeconds);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const identity = await getIdentityByProductUserId(input.actorUserId);
      const displayName = identity?.displayName || identity?.preferredUsername || input.actorUserId;
      const metadata = JSON.stringify({
        avatarUrl: identity?.avatarUrl ?? null,
      });

      const at = new AccessToken(config.voice.apiKey, config.voice.apiSecret, {
        identity: input.actorUserId,
        name: displayName,
        metadata,
        ttl: ttlSeconds,
      });

      at.addGrant({
        roomJoin: true,
        room: channel.voice_sfu_room_id,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();

      return {
        channelId: input.channelId,
        serverId: input.serverId,
        sfuUrl: config.voice.publicUrl,
        sfuRoomId: channel.voice_sfu_room_id,
        participantUserId: input.actorUserId,
        token,
        expiresAt: expiresAt.toISOString()
      };
    }
  });
}
