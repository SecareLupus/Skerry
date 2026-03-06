export type IdentityProvider = "discord" | "keycloak" | "google" | "github" | "twitch" | "dev";

export interface IdentityMapping {
  id: string;
  provider: IdentityProvider;
  oidcSubject: string;
  email: string | null;
  preferredUsername: string | null;
  avatarUrl: string | null;
  matrixUserId: string | null;
  displayName: string | null;
  bio: string | null;
  customStatus: string | null;
  productUserId: string;
  theme?: "light" | "dark" | null;
  settings?: Record<string, any>;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
  isBridged?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  provider: IdentityProvider;
}

export interface AuthenticatedViewer {
  productUserId: string;
  identity: Pick<
    IdentityMapping,
    "provider" | "oidcSubject" | "email" | "preferredUsername" | "avatarUrl" | "matrixUserId" | "displayName" | "bio" | "customStatus" | "isBridged"
  >;
}

export interface AccountLinkingRequirement {
  provider: IdentityProvider;
  displayName: string;
  isEnabled: boolean;
  requiresReauthentication: boolean;
}
