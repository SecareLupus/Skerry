import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export interface SessionPayload {
  productUserId: string;
  provider: string;
  oidcSubject: string;
  expiresAt: number;
  realProductUserId?: string; // Original actor if masquerading
  masqueradeRole?: string;
  masqueradeServerId?: string;
  masqueradeBadgeIds?: string[];
}

export function createSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verify(token: string): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(encoded)
    .digest("base64url");

  if (expected !== signature) {
    return null;
  }

  let decoded: SessionPayload;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (Date.now() > decoded.expiresAt) {
    return null;
  }

  return decoded;
}

export function setSessionCookie(
  reply: FastifyReply,
  payload: Omit<SessionPayload, "expiresAt"> & { expiresAt?: number }
): void {
  const ttlSeconds = Math.max(60, config.sessionTtlSeconds);
  const expiresAt = payload.expiresAt ?? (Date.now() + ttlSeconds * 1000);
  const token = createSessionToken({ ...payload, expiresAt });
  const cookieOptions = `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secureFlag(reply)}${
    config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
  }`;

  // Set the current session cookie and clear the legacy one
  reply.header("Set-Cookie", [
    `skerry_session=${token}${cookieOptions}`,
    `escapehatch_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(reply)}${
      config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
    }`
  ]);
}

export function clearSessionCookie(reply: FastifyReply): void {
  const cookieOptions = `; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(reply)}${
    config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
  }`;

  // Clear both current and legacy cookies
  reply.header("Set-Cookie", [
    `skerry_session=${cookieOptions}`,
    `escapehatch_session=${cookieOptions}`
  ]);
}

/** Append Secure flag when the request arrived over HTTPS (or behind a TLS-terminating proxy). */
function secureFlag(reply: FastifyReply): string {
  const proto =
    reply.request.headers["x-forwarded-proto"] ??
    (reply.request.protocol as string | undefined);
  return proto === "https" ? "; Secure" : "";
}

export function getSession(request: FastifyRequest): SessionPayload | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((p) => p.trim());
  const skerryRaw = parts.find((p) => p.startsWith("skerry_session="));
  const legacyRaw = parts.find((p) => p.startsWith("escapehatch_session="));

  const raw = skerryRaw || legacyRaw;
  if (!raw) {
    return null;
  }

  const token = raw.replace("skerry_session=", "").replace("escapehatch_session=", "");
  const payload = verify(token);
  return payload;
}

export function createMasqueradeToken(
  payload: Omit<SessionPayload, "expiresAt"> & { expiresAt?: number }
): string {
  return createSessionToken({
    ...payload,
    expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes for masquerade tokens
  });
}

export function verifyMasqueradeToken(token: string): SessionPayload | null {
  return verify(token);
}

// --- Pending identity token (OIDC split-detection interstitial) ---

export interface PendingIdentityPayload {
  provider: string;
  oidcSubject: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  expiresAt: number;
}

export function createPendingIdentityToken(payload: Omit<PendingIdentityPayload, "expiresAt">): string {
  return createSessionToken({
    productUserId: "__pending__",
    provider: payload.provider,
    oidcSubject: payload.oidcSubject,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5-minute TTL
  } as SessionPayload);
}

const PENDING_IDENTITY_KEY_PREFIX = "pending_identity:";

export function setPendingIdentityCookie(reply: FastifyReply, payload: Omit<PendingIdentityPayload, "expiresAt">): string {
  const fullPayload: PendingIdentityPayload = {
    ...payload,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  const token = createPendingIdentityToken(fullPayload);
  // Store the full payload in a separate cookie that the interstitial page reads
  reply.header("Set-Cookie",
    `pending_identity=${Buffer.from(JSON.stringify(fullPayload)).toString("base64url")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300${secureFlag(reply)}`
  );
  return token;
}

export function getPendingIdentityCookie(request: FastifyRequest): PendingIdentityPayload | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map(p => p.trim());
  const raw = parts.find(p => p.startsWith("pending_identity="));
  if (!raw) return null;
  try {
    const encoded = raw.replace("pending_identity=", "");
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PendingIdentityPayload;
  } catch {
    return null;
  }
}

export function clearPendingIdentityCookie(reply: FastifyReply): void {
  reply.header("Set-Cookie",
    `pending_identity=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(reply)}`
  );
}
