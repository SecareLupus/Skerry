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

  const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
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
  const cookieOptions = `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${
    config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
  }`;

  console.log(`[AUTH DEBUG] setSessionCookie: id=${reply.request.id} for ${payload.oidcSubject}`);
  
  // Set the current session cookie and clear the legacy one
  reply.header("Set-Cookie", [
    `skerry_session=${token}${cookieOptions}`,
    `escapehatch_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
    }`
  ]);
}

export function clearSessionCookie(reply: FastifyReply): void {
  const cookieOptions = `; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    config.baseDomain && config.baseDomain !== "127.0.0.1" ? `; Domain=${config.baseDomain}` : ""
  }`;
  
  // Clear both current and legacy cookies
  reply.header("Set-Cookie", [
    `skerry_session=${cookieOptions}`,
    `escapehatch_session=${cookieOptions}`
  ]);
}

export function getSession(request: FastifyRequest): SessionPayload | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    console.log(`[AUTH DEBUG] No cookie header for ${request.method} ${request.url} id=${request.id}`);
    return null;
  }

  const parts = cookieHeader.split(";").map((p) => p.trim());
  const skerryRaw = parts.find((p) => p.startsWith("skerry_session="));
  const legacyRaw = parts.find((p) => p.startsWith("escapehatch_session="));

  const raw = skerryRaw || legacyRaw;
  if (!raw) {
    console.log(`[AUTH DEBUG] session missing in header for ${request.method} ${request.url} id=${request.id}`);
    return null;
  }

  const token = raw.replace("skerry_session=", "").replace("escapehatch_session=", "");
  const payload = verify(token);
  if (!payload) {
    console.log(`[AUTH DEBUG] Session token verification failed for ${request.method} ${request.url} id=${request.id}`);
  }
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
