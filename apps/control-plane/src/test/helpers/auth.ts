import { createSessionToken } from "../../auth/session.js";

export interface AuthCookieInput {
  productUserId: string;
  provider?: string;
  oidcSubject?: string;
}

export function createAuthCookie(input: AuthCookieInput | string): string {
  const normalized: AuthCookieInput =
    typeof input === "string" ? { productUserId: input } : input;
  const provider = normalized.provider ?? "dev";
  const oidcSubject =
    normalized.oidcSubject ?? `sub_${normalized.productUserId.replaceAll("-", "")}`;

  const token = createSessionToken({
    productUserId: normalized.productUserId,
    provider,
    oidcSubject,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return `skerry_session=${token}`;
}
