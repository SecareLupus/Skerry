import crypto from "node:crypto";
import type { IdentityMapping } from "@skerry/shared";
import { withDb } from "../db/client.js";
import { isTokenExpired, refreshAccessToken } from "../auth/oidc.js";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export interface IdentityRow {
  id: string;
  provider: IdentityMapping["provider"];
  oidc_subject: string;
  email: string | null;
  preferred_username: string | null;
  avatar_url: string | null;
  display_name: string | null;
  bio: string | null;
  custom_status: string | null;
  matrix_user_id: string | null;
  product_user_id: string;
  banner_url: string | null;
  theme: "light" | "dark" | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapRow(result: IdentityRow): IdentityMapping {
  return {
    id: result.id,
    provider: result.provider,
    oidcSubject: result.oidc_subject,
    email: result.email,
    preferredUsername: result.preferred_username,
    avatarUrl: result.avatar_url,
    displayName: result.display_name,
    bio: result.bio,
    customStatus: result.custom_status,
    matrixUserId: result.matrix_user_id,
    productUserId: result.product_user_id,
    bannerUrl: result.banner_url,
    theme: result.theme as "light" | "dark" | null,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    tokenExpiresAt: result.token_expires_at,
    createdAt: result.created_at,
    updatedAt: result.updated_at
  };
}

import { registerUser, setUserDisplayName } from "../matrix/synapse-adapter.js";
import { config } from "../config.js";

export async function syncMatrixUser(identity: IdentityMapping): Promise<void> {
  if (!identity.matrixUserId) return;

  try {
    await registerUser({
      userId: identity.matrixUserId,
      displayName: identity.preferredUsername || identity.displayName || undefined
    });

    if (identity.preferredUsername || identity.displayName) {
      await setUserDisplayName(
        identity.matrixUserId,
        identity.preferredUsername || identity.displayName || ""
      );
    }
  } catch (error) {
    console.error(`Failed to sync Matrix user ${identity.matrixUserId}:`, error);
  }
}

export async function upsertIdentityMapping(input: {
  provider: IdentityMapping["provider"];
  oidcSubject: string;
  email: string | null;
  preferredUsername: string | null;
  displayName?: string | null;
  avatarUrl: string | null;
  productUserId?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
}): Promise<IdentityMapping> {
  const productUserId = input.productUserId ?? randomId("usr");
  const matrixUserId = `@${productUserId}:${config.synapse.serverName}`;

  const identity = await withDb(async (db) => {
    let finalPreferredUsername = input.preferredUsername;
    let displayName: string | null = input.displayName ?? null;
    let bio = null;
    let customStatus = null;
    let theme = "dark"; // Default to dark if not found

    if (input.productUserId) {
      const existing = await db.query<IdentityRow>(
        `select preferred_username, display_name, bio, custom_status, theme
         from identity_mappings
         where product_user_id = $1
         order by (preferred_username is not null) desc, updated_at desc
         limit 1`,
        [input.productUserId]
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        // Inherit existing values if they are more "complete" than what the new provider gives
        finalPreferredUsername = row.preferred_username || input.preferredUsername;
        displayName = row.display_name ?? displayName;
        bio = row.bio;
        customStatus = row.custom_status;
        theme = row.theme || "dark";
      }
    }

    const row = await db.query<IdentityRow>(
      `insert into identity_mappings
       (id, provider, oidc_subject, email, preferred_username, avatar_url, matrix_user_id, product_user_id, access_token, refresh_token, token_expires_at, display_name, bio, custom_status, theme)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (provider, oidc_subject)
       do update set
         email = excluded.email,
         preferred_username = coalesce(identity_mappings.preferred_username, excluded.preferred_username),
         avatar_url = excluded.avatar_url,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_expires_at = excluded.token_expires_at,
         display_name = coalesce(identity_mappings.display_name, excluded.display_name),
         bio = coalesce(identity_mappings.bio, excluded.bio),
         custom_status = coalesce(identity_mappings.custom_status, excluded.custom_status),
         theme = coalesce(identity_mappings.theme, excluded.theme),
         updated_at = now()
       returning *`,
      [
        randomId("idm"),
        input.provider,
        input.oidcSubject,
        input.email,
        finalPreferredUsername,
        input.avatarUrl,
        matrixUserId,
        productUserId,
        input.accessToken ?? null,
        input.refreshToken ?? null,
        input.tokenExpiresAt ?? null,
        displayName,
        bio,
        customStatus,
        theme
      ]
    );

    const result = row.rows[0];
    if (!result) {
      throw new Error("Identity mapping upsert failed.");
    }

    return mapRow(result);
  });

  await syncMatrixUser(identity);
  return identity;
}

export async function getIdentityByProductUserId(productUserId: string): Promise<IdentityMapping | null> {
  return withDb(async (db) => {
    const row = await db.query<IdentityRow>(
      `select *
       from identity_mappings
       where product_user_id = $1
       order by (preferred_username is not null) desc, updated_at desc, created_at asc
       limit 1`,
      [productUserId]
    );

    const result = row.rows[0];
    return result ? mapRow(result) : null;
  });
}

export async function getIdentityByProviderSubject(input: {
  provider: IdentityMapping["provider"];
  oidcSubject: string;
}): Promise<IdentityMapping | null> {
  return withDb(async (db) => {
    const row = await db.query<IdentityRow>(
      "select * from identity_mappings where provider = $1 and oidc_subject = $2 limit 1",
      [input.provider, input.oidcSubject]
    );
    const result = row.rows[0];
    return result ? mapRow(result) : null;
  });
}

export async function listIdentitiesByProductUserId(productUserId: string): Promise<IdentityMapping[]> {
  return withDb(async (db) => {
    const row = await db.query<IdentityRow>(
      `select *
       from identity_mappings
       where product_user_id = $1
       order by created_at asc`,
      [productUserId]
    );
    return row.rows.map(mapRow);
  });
}

export async function setPreferredUsernameForProductUser(input: {
  productUserId: string;
  preferredUsername: string;
}): Promise<void> {
  await withDb(async (db) => {
    const result = await db.query(
      `update identity_mappings
       set preferred_username = $2, updated_at = now()
       where product_user_id = $1`,
      [input.productUserId, input.preferredUsername]
    );
    if ((result.rowCount ?? 0) < 1) {
      throw new Error("No identities found for user.");
    }
  });
}

export async function isOnboardingComplete(productUserId: string): Promise<boolean> {
  return withDb(async (db) => {
    const row = await db.query<{ complete: boolean }>(
      `select exists(
         select 1
         from identity_mappings
         where product_user_id = $1
           and preferred_username is not null
           and length(trim(preferred_username)) > 0
       ) as complete`,
      [productUserId]
    );
    return Boolean(row.rows[0]?.complete);
  });
}

export async function findUniqueProductUserIdByEmail(email: string): Promise<string | null> {
  return withDb(async (db) => {
    const row = await db.query<{ product_user_id: string }>(
      `select product_user_id
       from identity_mappings
       where email is not null
         and lower(email) = lower($1)
       group by product_user_id
       order by min(created_at) asc
       limit 2`,
      [email]
    );
    if (row.rows.length !== 1) {
      return null;
    }
    return row.rows[0]?.product_user_id ?? null;
  });
}

export async function isPreferredUsernameTaken(input: {
  preferredUsername: string;
  excludingProductUserId?: string;
}): Promise<boolean> {
  return withDb(async (db) => {
    const row = await db.query<{ taken: boolean }>(
      `select exists(
         select 1
         from identity_mappings
         where preferred_username is not null
           and lower(preferred_username) = lower($1)
           and ($2::text is null or product_user_id <> $2)
       ) as taken`,
      [input.preferredUsername, input.excludingProductUserId ?? null]
    );
    return Boolean(row.rows[0]?.taken);
  });
}

export async function searchIdentities(
  query: string,
  options: { excludingProductUserId?: string } = {}
): Promise<IdentityMapping[]> {
  const normalizedQuery = `%${query.trim().toLowerCase()}%`;
  return withDb(async (db) => {
    const rows = await db.query<IdentityRow>(
      `select distinct on (product_user_id) *
       from identity_mappings
       where (lower(preferred_username) like $1 or lower(email) like $1)
         and ($2::text is null or product_user_id <> $2)
       order by product_user_id, (preferred_username is not null) desc, updated_at desc
       limit 10`,
      [normalizedQuery, options.excludingProductUserId ?? null]
    );
    return rows.rows.map(mapRow);
  });
}

export async function updateUserTheme(productUserId: string, theme: string): Promise<void> {
  await withDb(async (db) => {
    const result = await db.query(
      `update identity_mappings
       set theme = $2, updated_at = now()
       where product_user_id = $1`,
      [productUserId, theme]
    );
    if ((result.rowCount ?? 0) < 1) {
      throw new Error("No identities found for user.");
    }
  });
}

// Single-flight guard: when multiple callers concurrently ask to validate the
// same identity's token, only one OAuth refresh runs. Without this, providers
// that single-use refresh tokens (Discord) reject the second call.
const inFlightTokenRefreshes = new Map<string, Promise<void>>();

export async function ensureIdentityTokenValid(productUserId: string): Promise<void> {
  const existing = inFlightTokenRefreshes.get(productUserId);
  if (existing) return existing;

  const promise = doEnsureIdentityTokenValid(productUserId);
  inFlightTokenRefreshes.set(productUserId, promise);
  try {
    await promise;
  } finally {
    inFlightTokenRefreshes.delete(productUserId);
  }
}

async function doEnsureIdentityTokenValid(productUserId: string): Promise<void> {
  const identity = await getIdentityByProductUserId(productUserId);
  if (!identity || !identity.refreshToken || !identity.accessToken) {
    return;
  }

  if (isTokenExpired(identity.tokenExpiresAt)) {
    try {
      // IdentityMapping provider type might be broader than SupportedOidcProvider, but in practice they align for OIDC
      const refreshed = await refreshAccessToken(
        identity.provider as any,
        identity.refreshToken
      );

      await upsertIdentityMapping({
        provider: identity.provider,
        oidcSubject: identity.oidcSubject,
        email: identity.email,
        preferredUsername: identity.preferredUsername,
        avatarUrl: identity.avatarUrl,
        productUserId: identity.productUserId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? identity.refreshToken,
        tokenExpiresAt: refreshed.tokenExpiresAt
      });
    } catch (error) {
      console.error(`Failed to refresh identity token for user ${productUserId}:`, error);
    }
  }
}

export async function updateUserProfile(productUserId: string, input: {
  displayName?: string | null;
  bio?: string | null;
  customStatus?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `update identity_mappings
       set 
         display_name = case when $2::text is not null or $6::boolean then $2::text else display_name end,
         bio = case when $3::text is not null or $7::boolean then $3::text else bio end,
         custom_status = case when $4::text is not null or $8::boolean then $4::text else custom_status end,
         avatar_url = case when $5::text is not null or $9::boolean then $5::text else avatar_url end,
         banner_url = case when $10::text is not null or $11::boolean then $10::text else banner_url end,
         updated_at = now()
       where product_user_id = $1`,
      [
        productUserId,
        input.displayName === undefined ? null : input.displayName,
        input.bio === undefined ? null : input.bio,
        input.customStatus === undefined ? null : input.customStatus,
        input.avatarUrl === undefined ? null : input.avatarUrl,
        input.displayName === null,
        input.bio === null,
        input.customStatus === null,
        input.avatarUrl === null,
        input.bannerUrl === undefined ? null : input.bannerUrl,
        input.bannerUrl === null
      ]
    );
  });

  const identity = await getIdentityByProductUserId(productUserId);
  if (identity) {
    await syncMatrixUser(identity);
  }
}
export async function blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `insert into user_blocks (blocker_user_id, blocked_user_id)
       values ($1, $2)
       on conflict (blocker_user_id, blocked_user_id) do nothing`,
      [blockerUserId, blockedUserId]
    );
  });
}

export async function unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      "delete from user_blocks where blocker_user_id = $1 and blocked_user_id = $2",
      [blockerUserId, blockedUserId]
    );
  });
}

export async function listBlocks(blockerUserId: string): Promise<string[]> {
  return withDb(async (db) => {
    const rows = await db.query<{ blocked_user_id: string }>(
      "select blocked_user_id from user_blocks where blocker_user_id = $1",
      [blockerUserId]
    );
    return rows.rows.map((r) => r.blocked_user_id);
  });
}

export async function isBlocked(blockerUserId: string, blockedUserId: string): Promise<boolean> {
  return withDb(async (db) => {
    const row = await db.query<{ exists: boolean }>(
      "select exists(select 1 from user_blocks where blocker_user_id = $1 and blocked_user_id = $2)",
      [blockerUserId, blockedUserId]
    );
    return Boolean(row.rows[0]?.exists);
  });
}
export async function listHubMembers(hubId: string): Promise<IdentityMapping[]> {
  return withDb(async (db) => {
    const rows = await db.query<IdentityRow>(
      `select distinct on (im.product_user_id) im.*
       from identity_mappings im
       left join hub_members hm on hm.product_user_id = im.product_user_id and hm.hub_id = $1
       left join server_members sm on sm.product_user_id = im.product_user_id
       left join servers s on s.id = sm.server_id and s.hub_id = $1
       left join role_bindings rb on rb.product_user_id = im.product_user_id and rb.hub_id = $1
       left join hubs h on h.id = $1 and h.owner_user_id = im.product_user_id
       where (hm.hub_id is not null or s.id is not null or rb.hub_id is not null or h.id is not null or im.provider != 'discordbridge')
         and (im.matrix_user_id is null or im.matrix_user_id not like '@discord_%')
       order by im.product_user_id, im.preferred_username is not null desc, im.updated_at desc`,
      [hubId]
    );
    return rows.rows.map(mapRow);
  });
}
