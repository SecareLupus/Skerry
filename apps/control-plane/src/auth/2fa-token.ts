import crypto from "node:crypto";

interface TwoFactorToken {
  productUserId: string;
  hubId: string;
  issuedAt: number;
  expiresAt: number;
}

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const tokens = new Map<string, TwoFactorToken>();

export function issue2faToken(productUserId: string, hubId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    productUserId,
    hubId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

export function verify2faToken(token: string, productUserId: string, hubId: string): boolean {
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return false;
  }
  if (entry.productUserId !== productUserId || entry.hubId !== hubId) {
    return false;
  }
  return true;
}

export function consume2faToken(token: string): TwoFactorToken | null {
  const entry = tokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  tokens.delete(token);
  return entry;
}
