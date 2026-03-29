import crypto from "node:crypto";
import type { FederationPolicyEvent, FederationPolicyStatus, HubFederationPolicy, TrustedHub, FederatedUser } from "@skerry/shared";
import { config } from "../config.js";
import { setRoomServerAcl } from "../matrix/synapse-adapter.js";
import { withDb } from "../db/client.js";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

export function isFederationHostAllowed(allowlist: string[], host: string): boolean {
  const normalizedAllowlist = allowlist.map(normalizeHost).filter(Boolean);
  const target = normalizeHost(host);
  return normalizedAllowlist.includes(target);
}

function defaultAllowlist(): string[] {
  const configured = process.env.FEDERATION_DEFAULT_ALLOWLIST ?? "";
  const items = configured
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  if (config.synapse.baseUrl) {
    try {
      items.push(new URL(config.synapse.baseUrl).hostname.toLowerCase());
    } catch {
      // ignore malformed base URL
    }
  }
  return [...new Set(items)];
}

function mapPolicyRow(row: {
  hub_id: string;
  allowlist: string[];
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
}): HubFederationPolicy {
  return {
    hubId: row.hub_id,
    allowlist: row.allowlist ?? [],
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapStatusRow(row: {
  room_id: string;
  hub_id: string;
  server_id: string | null;
  channel_id: string | null;
  room_kind: string;
  allowlist: string[];
  status: string;
  last_error: string | null;
  applied_at: string | null;
  checked_at: string;
  updated_at: string;
}): FederationPolicyStatus {
  return {
    roomId: row.room_id,
    hubId: row.hub_id,
    serverId: row.server_id,
    channelId: row.channel_id,
    roomKind: row.room_kind === "space" ? "space" : "room",
    allowlist: row.allowlist ?? [],
    status: row.status === "applied" || row.status === "error" ? row.status : "skipped",
    lastError: row.last_error,
    appliedAt: row.applied_at,
    checkedAt: row.checked_at,
    updatedAt: row.updated_at
  };
}

function mapEventRow(row: {
  id: string;
  hub_id: string;
  actor_user_id: string;
  action_type: string;
  policy_json: { allowlist?: string[] } | null;
  created_at: string;
}): FederationPolicyEvent {
  return {
    id: row.id,
    hubId: row.hub_id,
    actorUserId: row.actor_user_id,
    actionType: row.action_type === "policy_reconciled" ? "policy_reconciled" : "policy_updated",
    policy: {
      allowlist: row.policy_json?.allowlist ?? []
    },
    createdAt: row.created_at
  };
}

export async function getHubFederationPolicy(hubId: string): Promise<HubFederationPolicy | null> {
  return withDb(async (db) => {
    const row = await db.query<{
      hub_id: string;
      allowlist: string[];
      updated_by_user_id: string;
      created_at: string;
      updated_at: string;
    }>("select hub_id, allowlist, updated_by_user_id, created_at, updated_at from hub_federation_policies where hub_id = $1", [
      hubId
    ]);
    const policy = row.rows[0];
    return policy ? mapPolicyRow(policy) : null;
  });
}

export async function upsertHubFederationPolicy(input: {
  hubId: string;
  allowlist: string[];
  actorUserId: string;
}): Promise<HubFederationPolicy> {
  const normalizedAllowlist = [...new Set(input.allowlist.map(normalizeHost).filter(Boolean))];
  return withDb(async (db) => {
    const row = await db.query<{
      hub_id: string;
      allowlist: string[];
      updated_by_user_id: string;
      created_at: string;
      updated_at: string;
    }>(
      `insert into hub_federation_policies
       (hub_id, allowlist, created_by_user_id, updated_by_user_id)
       values ($1, $2, $3, $3)
       on conflict (hub_id)
       do update set
         allowlist = excluded.allowlist,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = now()
       returning hub_id, allowlist, updated_by_user_id, created_at, updated_at`,
      [input.hubId, normalizedAllowlist, input.actorUserId]
    );
    const saved = row.rows[0];
    if (!saved) {
      throw new Error("Federation policy upsert failed.");
    }

    await db.query(
      `insert into federation_policy_events (id, hub_id, actor_user_id, action_type, policy_json)
       values ($1, $2, $3, 'policy_updated', $4::jsonb)`,
      [randomId("fpev"), input.hubId, input.actorUserId, JSON.stringify({ allowlist: normalizedAllowlist })]
    );

    return mapPolicyRow(saved);
  });
}

export async function listFederationPolicyEvents(hubId: string, limit = 20): Promise<FederationPolicyEvent[]> {
  return withDb(async (db) => {
    const row = await db.query<{
      id: string;
      hub_id: string;
      actor_user_id: string;
      action_type: string;
      policy_json: { allowlist?: string[] } | null;
      created_at: string;
    }>(
      `select id, hub_id, actor_user_id, action_type, policy_json, created_at
       from federation_policy_events
       where hub_id = $1
       order by created_at desc
       limit $2`,
      [hubId, limit]
    );
    return row.rows.map(mapEventRow);
  });
}

export async function listFederationPolicyStatuses(hubId: string): Promise<FederationPolicyStatus[]> {
  return withDb(async (db) => {
    const row = await db.query<{
      room_id: string;
      hub_id: string;
      server_id: string | null;
      channel_id: string | null;
      room_kind: string;
      allowlist: string[];
      status: string;
      last_error: string | null;
      applied_at: string | null;
      checked_at: string;
      updated_at: string;
    }>(
      `select room_id, hub_id, server_id, channel_id, room_kind, allowlist, status, last_error, applied_at, checked_at, updated_at
       from room_acl_status
       where hub_id = $1
       order by checked_at desc`,
      [hubId]
    );
    return row.rows.map(mapStatusRow);
  });
}

export async function applyFederationPolicyToRoom(input: {
  hubId: string;
  roomId: string | null;
  roomKind: "space" | "room";
  serverId: string | null;
  channelId: string | null;
}): Promise<"applied" | "skipped" | "error"> {
  if (!input.roomId) {
    return "skipped";
  }

  const policy = (await getHubFederationPolicy(input.hubId)) ?? {
    hubId: input.hubId,
    allowlist: defaultAllowlist(),
    updatedByUserId: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const status = await setRoomServerAcl(input.roomId, policy.allowlist);
  await withDb(async (db) => {
    await db.query(
      `insert into room_acl_status
       (room_id, hub_id, server_id, channel_id, room_kind, allowlist, status, last_error, applied_at, checked_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       on conflict (room_id)
       do update set
         allowlist = excluded.allowlist,
         status = excluded.status,
         last_error = excluded.last_error,
         applied_at = excluded.applied_at,
         checked_at = now(),
         updated_at = now()`,
      [
        input.roomId,
        input.hubId,
        input.serverId,
        input.channelId,
        input.roomKind,
        policy.allowlist,
        status.ok ? (status.applied ? "applied" : "skipped") : "error",
        status.error ?? null,
        status.applied ? new Date().toISOString() : null
      ]
    );
  });
  return status.ok ? (status.applied ? "applied" : "skipped") : "error";
}

export async function reconcileHubFederationPolicy(input: {
  hubId: string;
  actorUserId: string;
}): Promise<{ checkedRooms: number; appliedRooms: number; failedRooms: number }> {
  return withDb(async (db) => {
    const servers = await db.query<{ id: string; matrix_space_id: string | null }>(
      "select id, matrix_space_id from servers where hub_id = $1",
      [input.hubId]
    );
    const channels = await db.query<{ id: string; server_id: string; matrix_room_id: string | null }>(
      `select ch.id, ch.server_id, ch.matrix_room_id
       from channels ch
       join servers s on s.id = ch.server_id
       where s.hub_id = $1`,
      [input.hubId]
    );

    let checkedRooms = 0;
    let appliedRooms = 0;
    let failedRooms = 0;

    for (const server of servers.rows) {
      if (!server.matrix_space_id) {
        continue;
      }
      checkedRooms += 1;
      const roomStatus = await applyFederationPolicyToRoom({
        hubId: input.hubId,
        roomId: server.matrix_space_id,
        roomKind: "space",
        serverId: server.id,
        channelId: null
      });
      if (roomStatus === "applied") {
        appliedRooms += 1;
      }
      if (roomStatus === "error") {
        failedRooms += 1;
      }
    }

    for (const channel of channels.rows) {
      if (!channel.matrix_room_id) {
        continue;
      }
      checkedRooms += 1;
      const roomStatus = await applyFederationPolicyToRoom({
        hubId: input.hubId,
        roomId: channel.matrix_room_id,
        roomKind: "room",
        serverId: channel.server_id,
        channelId: channel.id
      });
      if (roomStatus === "applied") {
        appliedRooms += 1;
      }
      if (roomStatus === "error") {
        failedRooms += 1;
      }
    }

    await db.query(
      `insert into federation_policy_events (id, hub_id, actor_user_id, action_type, policy_json)
       values ($1, $2, $3, 'policy_reconciled', $4::jsonb)`,
      [
        randomId("fpev"),
        input.hubId,
        input.actorUserId,
        JSON.stringify({ checkedRooms, appliedRooms, failedRooms })
      ]
    );

    return { checkedRooms, appliedRooms, failedRooms };
  });
}

// --- Web of Trust: Trusted Hubs ---
export async function addTrustedHub(input: {
  hubUrl: string;
  sharedSecret: string;
  trustLevel?: "guest" | "member" | "partner";
  metadata?: Record<string, any>;
}): Promise<TrustedHub> {
  const normalizedUrl = input.hubUrl.trim().toLowerCase().replace(/\/+$/, "");
  return withDb(async (db) => {
    const row = await db.query(
      `insert into trusted_hubs (hub_url, shared_secret, trust_level, metadata, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (hub_url) do update set
         shared_secret = excluded.shared_secret,
         trust_level = excluded.trust_level,
         metadata = excluded.metadata,
         updated_at = now()
       returning *`,
      [normalizedUrl, input.sharedSecret, input.trustLevel ?? "guest", JSON.stringify(input.metadata ?? {})]
    );

    const saved = row.rows[0];
    return {
      hubUrl: saved.hub_url,
      sharedSecret: saved.shared_secret,
      trustLevel: saved.trust_level as any,
      metadata: saved.metadata,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at
    };
  });
}

export async function listTrustedHubs(): Promise<TrustedHub[]> {
  return withDb(async (db) => {
    const rows = await db.query("select * from trusted_hubs order by hub_url asc");
    return rows.rows.map(r => ({
      hubUrl: r.hub_url,
      sharedSecret: r.shared_secret,
      trustLevel: r.trust_level as any,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  });
}

export async function getTrustedHub(hubUrl: string): Promise<TrustedHub | null> {
  const normalizedUrl = hubUrl.trim().toLowerCase().replace(/\/+$/, "");
  return withDb(async (db) => {
    const row = await db.query("select * from trusted_hubs where hub_url = $1", [normalizedUrl]);
    const r = row.rows[0];
    if (!r) return null;
    return {
      hubUrl: r.hub_url,
      sharedSecret: r.shared_secret,
      trustLevel: r.trust_level as any,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  });
}

export async function removeTrustedHub(hubUrl: string): Promise<void> {
  const normalizedUrl = hubUrl.trim().toLowerCase().replace(/\/+$/, "");
  await withDb(async (db) => {
    await db.query("delete from trusted_hubs where hub_url = $1", [normalizedUrl]);
  });
}

// --- Federated Identity Resolution ---
export async function verifyFederatedToken(token: string, hubUrl: string): Promise<{ federatedId: string; displayName?: string; avatarUrl?: string } | null> {
  const hub = await getTrustedHub(hubUrl);
  if (!hub) return null;

  try {
    const [headerB64, payloadB64, signature] = token.split(".");
    if (!headerB64 || !payloadB64 || !signature) return null;

    const data = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac("sha256", hub.sharedSecret)
      .update(data)
      .digest("base64url");

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (!payload.sub || !payload.sub.includes(":")) return null;

    return {
      federatedId: payload.sub,
      displayName: payload.name,
      avatarUrl: payload.picture
    };
  } catch (err) {
    console.error(`Federated token verification failed for hub ${hubUrl}:`, err);
    return null;
  }
}

export async function resolveFederatedUser(info: { federatedId: string; hubUrl: string; displayName?: string; avatarUrl?: string }): Promise<FederatedUser> {
  return withDb(async (db) => {
    const existing = await db.query("select * from federated_user_cache where federated_id = $1", [info.federatedId]);
    if (existing.rows[0]) {
      const r = existing.rows[0];
      await db.query(
        "update federated_user_cache set last_seen_at = now(), display_name = $1, avatar_url = $2 where federated_id = $3",
        [info.displayName ?? r.display_name, info.avatarUrl ?? r.avatar_url, info.federatedId]
      );
      return {
        federatedId: r.federated_id,
        localProxyUserId: r.local_proxy_user_id,
        hubUrl: r.hub_url,
        displayName: info.displayName ?? r.display_name,
        avatarUrl: info.avatarUrl ?? r.avatar_url,
        lastSeenAt: new Date().toISOString(),
        createdAt: r.created_at
      };
    }

    const localProxyUserId = `fed_${crypto.randomUUID().replaceAll("-", "")}`;
    const row = await db.query(
      `insert into federated_user_cache (federated_id, local_proxy_user_id, hub_url, display_name, avatar_url)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [info.federatedId, localProxyUserId, info.hubUrl, info.displayName, info.avatarUrl]
    );

    const saved = row.rows[0];
    return {
      federatedId: saved.federated_id,
      localProxyUserId: saved.local_proxy_user_id,
      hubUrl: saved.hub_url,
      displayName: saved.display_name,
      avatarUrl: saved.avatar_url,
      lastSeenAt: saved.last_seen_at,
      createdAt: saved.created_at
    };
  });
}
