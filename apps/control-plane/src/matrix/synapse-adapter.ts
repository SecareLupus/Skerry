import { config } from "../config.js";
import type { ChannelType } from "@skerry/shared";

interface CreateSpaceInput {
  name: string;
}

interface CreateRoomInput {
  name: string;
  type: ChannelType;
}

interface ModerationInput {
  roomId: string;
  userId: string;
  reason?: string;
}

async function synapseRequest<T>(
  path: string, 
  body: Record<string, unknown>, 
  options: { userId?: string; method?: string } = {}
): Promise<T | null> {
  if (!config.synapse.baseUrl || !config.synapse.asToken) {
    return null;
  }

  const url = new URL(`${config.synapse.baseUrl}${path}`);
  url.searchParams.set("access_token", config.synapse.asToken);
  if (options.userId) {
    url.searchParams.set("user_id", options.userId);
  }

  const method = options.method ?? "POST";
  const isBodyAllowed = !["GET", "HEAD"].includes(method.toUpperCase());

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: (isBodyAllowed && body && Object.keys(body).length > 0) ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const message = `Synapse request network failure: ${error instanceof Error ? error.message : "unknown error"
      }`;
    if (config.synapse.strictProvisioning) {
      throw new Error(message);
    }
    console.warn(`${message}; continuing without Synapse provisioning.`);
    return null;
  }

  if (!response.ok) {
    const message = `Synapse request failed: ${response.status} ${await response.text()}`;
    if (config.synapse.strictProvisioning) {
      throw new Error(message);
    }
    console.warn(`${message}; continuing without Synapse provisioning.`);
    return null;
  }

  return (await response.json()) as T;
}

export async function createSpace(input: CreateSpaceInput): Promise<string | null> {
  const response = await synapseRequest<{ room_id: string }>("/_matrix/client/v3/createRoom", {
    name: input.name,
    creation_content: { type: "m.space" },
    preset: "private_chat",
    power_level_content_override: { users_default: 0 },
    initial_state: [
      {
        type: "m.room.history_visibility",
        state_key: "",
        content: { history_visibility: "joined" }
      },
      {
        type: "m.room.join_rules",
        state_key: "",
        content: { join_rule: "invite" }
      }
    ]
  });

  return response?.room_id ?? null;
}

export async function createChannelRoom(input: CreateRoomInput): Promise<string | null> {
  const response = await synapseRequest<{ room_id: string }>("/_matrix/client/v3/createRoom", {
    name: input.name,
    topic: `${input.type} channel provisioned by control-plane`,
    preset: "private_chat",
    initial_state: [
      {
        type: "m.room.history_visibility",
        state_key: "",
        content: { history_visibility: "joined" }
      },
      {
        type: "m.room.join_rules",
        state_key: "",
        content: { join_rule: "invite" }
      }
    ]
  });

  return response?.room_id ?? null;
}

export async function attachChildRoom(spaceId: string, childRoomId: string): Promise<void> {
  await synapseRequest(
    `/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(childRoomId)}`,
    { via: [new URL(config.synapse.baseUrl).hostname] },
    { method: "PUT" }
  );
}

export async function setRoomServerAcl(
  roomId: string,
  allowlist: string[]
): Promise<{ ok: boolean; applied: boolean; error?: string }> {
  const response = await synapseRequest(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.server_acl/`,
    {
      allow: [...new Set(allowlist.filter(Boolean))],
      deny: ["*"],
      allow_ip_literals: false
    },
    { method: "PUT" }
  );

  if (!response) {
    return { ok: false, applied: false, error: "Synapse request failed" };
  }

  return { ok: true, applied: true };
}

export async function kickUser(input: ModerationInput): Promise<void> {
  await synapseRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/kick`, {
    user_id: input.userId,
    reason: input.reason
  });
}

export async function banUser(input: ModerationInput): Promise<void> {
  await synapseRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/ban`, {
    user_id: input.userId,
    reason: input.reason
  });
}

export async function unbanUser(input: ModerationInput): Promise<void> {
  await synapseRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/unban`, {
    user_id: input.userId
  });
}

export async function redactEvent(input: {
  roomId: string;
  eventId: string;
  reason?: string;
}): Promise<void> {
  const txnId = crypto.randomUUID().replaceAll("-", "");
  await synapseRequest(
    `/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/redact/${encodeURIComponent(
      input.eventId
    )}/${txnId}`,
    { reason: input.reason }
  );
}

export async function inviteUser(input: { roomId: string; userId: string }): Promise<void> {
  await synapseRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/invite`, {
    user_id: input.userId
  });
}

export async function registerUser(input: { userId: string; displayName?: string }): Promise<void> {
  // Matrix Appservice can register users without passwords
  const localpart = (input.userId.split(":")[0] || "").replace("@", "");
  await synapseRequest("/_matrix/client/v3/register", {
    type: "m.login.application_service",
    username: localpart,
    displayname: input.displayName
  });
}

export async function setUserDisplayName(userId: string, displayName: string): Promise<void> {
  await synapseRequest(
    `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
    { displayname: displayName },
    { method: "PUT", userId }
  );
}

export async function setUserAvatar(userId: string, avatarUrl: string): Promise<void> {
  await synapseRequest(
    `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`,
    { avatar_url: avatarUrl },
    { method: "PUT", userId }
  );
}

export async function setUserMuted(roomId: string, userId: string, muted: boolean): Promise<void> {
  if (!config.synapse.baseUrl || !config.synapse.asToken) {
    return;
  }
  const url = new URL(`${config.synapse.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`);
  url.searchParams.set("access_token", config.synapse.asToken);
  
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.warn(`Failed to fetch power levels for ${roomId}:`, err);
    return;
  }

  if (!response.ok) {
    console.warn(`Failed to fetch power levels for ${roomId}: ${response.status}`);
    return;
  }

  const currentLevels = (await response.json()) as any;
  const users = currentLevels.users || {};

  if (muted) {
    users[userId] = -1; // -1 prevents sending messages if default is 0
  } else {
    delete users[userId];
  }

  await synapseRequest(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
    { ...currentLevels, users },
    { method: "PUT" }
  );
}

export async function checkSynapseHealth(): Promise<boolean> {
  const response = await synapseRequest<any>("/_matrix/client/versions", {}, { method: "GET" });
  return !!response;
}
