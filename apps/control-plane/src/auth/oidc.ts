import crypto from "node:crypto";
import { config } from "../config.js";
import type { IdentityProvider } from "@skerry/shared";

type SupportedOidcProvider = "discord" | "google" | "twitch";
type OidcIntent = "login" | "link";

interface OidcStateEntry {
  provider: SupportedOidcProvider;
  verifier: string;
  intent: OidcIntent;
  productUserId?: string;
}

interface OidcProfile {
  provider: SupportedOidcProvider;
  oidcSubject: string;
  email: string | null;
  username?: string;
  preferredUsername: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const inMemoryState = new Map<string, OidcStateEntry>();

function isSupportedProvider(provider: IdentityProvider): provider is SupportedOidcProvider {
  return provider === "discord" || provider === "google" || provider === "twitch";
}

function ensureProviderEnabled(provider: SupportedOidcProvider): void {
  if (provider === "discord" && !config.oidc.discordClientId) {
    throw new Error("OIDC_DISCORD_CLIENT_ID is not set.");
  }
  if (provider === "google" && !config.oidc.googleClientId) {
    throw new Error("OIDC_GOOGLE_CLIENT_ID is not set.");
  }
  if (provider === "twitch" && !config.oidc.twitchClientId) {
    throw new Error("OIDC_TWITCH_CLIENT_ID is not set.");
  }
}

function createPkce(): { state: string; verifier: string; challenge: string } {
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

function callbackUrl(provider: SupportedOidcProvider): string {
  return `${config.appBaseUrl}/auth/callback/${provider}`;
}

export function createAuthorizationRedirect(input: {
  provider: IdentityProvider;
  intent: OidcIntent;
  productUserId?: string;
}): string {
  if (!isSupportedProvider(input.provider)) {
    throw new Error("Provider does not support direct OIDC in current milestone.");
  }

  const provider = input.provider;
  ensureProviderEnabled(provider);

  const { state, verifier, challenge } = createPkce();
  inMemoryState.set(state, {
    provider,
    verifier,
    intent: input.intent,
    productUserId: input.productUserId
  });

  const redirectUri = callbackUrl(provider);
  if (provider === "discord") {
    const query = new URLSearchParams({
      client_id: config.oidc.discordClientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return `${config.oidc.discordAuthorizeUrl}?${query.toString()}`;
  }

  if (provider === "google") {
    const query = new URLSearchParams({
      client_id: config.oidc.googleClientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline"
    });
    return `${config.oidc.googleAuthorizeUrl}?${query.toString()}`;
  }

  const query = new URLSearchParams({
    client_id: config.oidc.twitchClientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user:read:email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return `${config.oidc.twitchAuthorizeUrl}?${query.toString()}`;
}

interface ExchangeTokenInput {
  code: string;
  state: string;
}

interface OidcExchangeResult {
  profile: OidcProfile;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  intent: OidcIntent;
  productUserId?: string;
}

export async function exchangeAuthorizationCode(input: ExchangeTokenInput): Promise<OidcExchangeResult> {
  const stateEntry = inMemoryState.get(input.state);
  if (!stateEntry) {
    throw new Error("Invalid OIDC state.");
  }
  inMemoryState.delete(input.state);

  if (stateEntry.provider === "discord") {
    const exchangeResult = await exchangeDiscordCode(input.code, stateEntry.verifier);
    return {
      ...exchangeResult,
      intent: stateEntry.intent,
      productUserId: stateEntry.productUserId
    };
  }

  if (stateEntry.provider === "google") {
    const exchangeResult = await exchangeGoogleCode(input.code, stateEntry.verifier);
    return {
      ...exchangeResult,
      intent: stateEntry.intent,
      productUserId: stateEntry.productUserId
    };
  }

  const exchangeResult = await exchangeTwitchCode(input.code, stateEntry.verifier);
  return {
    ...exchangeResult,
    intent: stateEntry.intent,
    productUserId: stateEntry.productUserId
  };
}

export async function refreshAccessToken(
  provider: SupportedOidcProvider,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (provider === "discord") {
    return refreshDiscordToken(refreshToken);
  }
  if (provider === "google") {
    return refreshGoogleToken(refreshToken);
  }
  return refreshTwitchToken(refreshToken);
}

/**
 * Returns true if the token is expired or will expire within the given buffer seconds.
 */
export function isTokenExpired(expiresAt: string | null | undefined, bufferSeconds = 300): boolean {
  if (!expiresAt) {
    return false; // If no expiry is set, we assume it's long-lived or handled elsewhere
  }
  const expiry = new Date(expiresAt).getTime();
  return Date.now() + bufferSeconds * 1000 > expiry;
}

async function exchangeDiscordCode(
  code: string,
  verifier: string
): Promise<{ profile: OidcProfile; accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.discordClientId || !config.oidc.discordClientSecret) {
    throw new Error("Discord OIDC client credentials are missing.");
  }

  const tokenResponse = await fetch(config.oidc.discordTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.discordClientId,
      client_secret: config.oidc.discordClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl("discord"),
      code_verifier: verifier
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed (${tokenResponse.status}).`);
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const userResponse = await fetch(config.oidc.discordUserInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  if (!userResponse.ok) {
    throw new Error(`Unable to load Discord profile (${userResponse.status}).`);
  }

  const profile = (await userResponse.json()) as {
    id: string;
    email?: string;
    username?: string;
    global_name?: string;
    avatar?: string;
  };

  return {
    profile: {
      provider: "discord",
      oidcSubject: profile.id,
      email: profile.email ?? null,
      username: profile.username,
      preferredUsername: null,
      displayName: profile.global_name ?? profile.username ?? null,
      avatarUrl: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null
    },
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    tokenExpiresAt: tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : undefined
  };
}

async function exchangeGoogleCode(
  code: string,
  verifier: string
): Promise<{ profile: OidcProfile; accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.googleClientId || !config.oidc.googleClientSecret) {
    throw new Error("Google OIDC client credentials are missing.");
  }

  const tokenResponse = await fetch(config.oidc.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.googleClientId,
      client_secret: config.oidc.googleClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl("google"),
      code_verifier: verifier
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed (${tokenResponse.status}).`);
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const userResponse = await fetch(config.oidc.googleUserInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  if (!userResponse.ok) {
    throw new Error(`Unable to load Google profile (${userResponse.status}).`);
  }

  const profile = (await userResponse.json()) as {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  return {
    profile: {
      provider: "google",
      oidcSubject: profile.sub,
      email: profile.email ?? null,
      preferredUsername: null,
      displayName: profile.name ?? null,
      avatarUrl: profile.picture ?? null
    },
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    tokenExpiresAt: tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : undefined
  };
}

async function exchangeTwitchCode(
  code: string,
  verifier: string
): Promise<{ profile: OidcProfile; accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.twitchClientId || !config.oidc.twitchClientSecret) {
    throw new Error("Twitch OIDC client credentials are missing.");
  }

  const tokenResponse = await fetch(config.oidc.twitchTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.twitchClientId,
      client_secret: config.oidc.twitchClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl("twitch"),
      code_verifier: verifier
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Twitch token exchange failed (${tokenResponse.status}).`);
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const userResponse = await fetch(config.oidc.twitchUserInfoUrl, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Client-Id": config.oidc.twitchClientId
    }
  });
  if (!userResponse.ok) {
    throw new Error(`Unable to load Twitch profile (${userResponse.status}).`);
  }

  const profileJson = (await userResponse.json()) as {
    data?: Array<{
      id: string;
      login: string;
      display_name: string;
      email?: string;
      profile_image_url?: string;
    }>;
  };
  const profile = profileJson.data?.[0];
  if (!profile) {
    throw new Error("Twitch profile payload was empty.");
  }

  return {
    profile: {
      provider: "twitch",
      oidcSubject: profile.id,
      email: profile.email ?? null,
      username: profile.login || profile.display_name,
      preferredUsername: null,
      displayName: profile.display_name || profile.login || null,
      avatarUrl: profile.profile_image_url ?? null
    },
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    tokenExpiresAt: tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : undefined
  };
}

async function refreshDiscordToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.discordClientId || !config.oidc.discordClientSecret) {
    throw new Error("Discord OIDC client credentials are missing.");
  }

  const response = await fetch(config.oidc.discordTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.discordClientId,
      client_secret: config.oidc.discordClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Discord token refresh failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : undefined
  };
}

async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.googleClientId || !config.oidc.googleClientSecret) {
    throw new Error("Google OIDC client credentials are missing.");
  }

  const response = await fetch(config.oidc.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.googleClientId,
      client_secret: config.oidc.googleClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : undefined
  };
}

async function refreshTwitchToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; tokenExpiresAt?: string }> {
  if (!config.oidc.twitchClientId || !config.oidc.twitchClientSecret) {
    throw new Error("Twitch OIDC client credentials are missing.");
  }

  const response = await fetch(config.oidc.twitchTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oidc.twitchClientId,
      client_secret: config.oidc.twitchClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : undefined
  };
}
