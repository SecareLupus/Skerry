const baseDomain = process.env.BASE_DOMAIN || process.env.NEXT_PUBLIC_BASE_DOMAIN || "localhost";
const isLocal = !baseDomain || baseDomain.includes("localhost") || baseDomain.includes("127.0.0.1");
const protocol = (baseDomain && baseDomain !== "localhost" && baseDomain !== "127.0.0.1") ? "https" : "http";

const webBaseUrl = (process.env.WEB_BASE_URL || `${protocol}://${baseDomain}`).replace(/\/+$/, "");
const appBaseUrl = (process.env.APP_BASE_URL || webBaseUrl).replace(/\/+$/, "");

export const config = {
  port: Number(process.env.PORT ?? "4000"),
  baseDomain,
  appBaseUrl,
  webBaseUrl,
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@postgres:5432/escapehatch",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-session-secret",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? "604800"), // 7 days
  devAuthBypass: process.env.DEV_AUTH_BYPASS === "true",
  setupBootstrapEnabled: process.env.SETUP_BOOTSTRAP_ENABLED !== "false",
  setupBootstrapToken: process.env.SETUP_BOOTSTRAP_TOKEN ?? "",
  logFilePath: process.env.LOG_FILE_PATH ?? "",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? "240"),
  oidc: {
    keycloakIssuer: process.env.OIDC_KEYCLOAK_ISSUER ?? (baseDomain ? `https://keycloak.${baseDomain}/realms/escapehatch` : "http://keycloak:8080/realms/escapehatch"),
    keycloakClientId: process.env.OIDC_KEYCLOAK_CLIENT_ID,
    keycloakClientSecret: process.env.OIDC_KEYCLOAK_CLIENT_SECRET,
    discordClientId: process.env.OIDC_DISCORD_CLIENT_ID,
    discordClientSecret: process.env.OIDC_DISCORD_CLIENT_SECRET,
    discordAuthorizeUrl: "https://discord.com/api/oauth2/authorize",
    discordTokenUrl: "https://discord.com/api/oauth2/token",
    discordUserInfoUrl: "https://discord.com/api/users/@me",
    googleClientId: process.env.OIDC_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.OIDC_GOOGLE_CLIENT_SECRET,
    googleAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    googleTokenUrl: "https://oauth2.googleapis.com/token",
    googleUserInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    twitchClientId: process.env.OIDC_TWITCH_CLIENT_ID,
    twitchClientSecret: process.env.OIDC_TWITCH_CLIENT_SECRET,
    twitchAuthorizeUrl: "https://id.twitch.tv/oauth2/authorize",
    twitchTokenUrl: "https://id.twitch.tv/oauth2/token",
    twitchUserInfoUrl: "https://api.twitch.tv/helix/users",
  },
  discordBridge: {
    mockMode: process.env.DISCORD_BRIDGE_MOCK === "true",
    clientId: process.env.DISCORD_BRIDGE_CLIENT_ID,
    clientSecret: process.env.DISCORD_BRIDGE_CLIENT_SECRET,
    callbackUrl:
      process.env.DISCORD_BRIDGE_CALLBACK_URL ??
      `${appBaseUrl}/v1/discord/oauth/callback`,
    authorizeUrl:
      process.env.DISCORD_BRIDGE_AUTHORIZE_URL ??
      "https://discord.com/api/oauth2/authorize",
    tokenUrl:
      process.env.DISCORD_BRIDGE_TOKEN_URL ??
      "https://discord.com/api/oauth2/token",
    userInfoUrl:
      process.env.DISCORD_BRIDGE_USERINFO_URL ??
      "https://discord.com/api/users/@me",
    userGuildsUrl:
      process.env.DISCORD_BRIDGE_USER_GUILDS_URL ??
      "https://discord.com/api/users/@me/guilds",
  },
  discordBotToken: (process.env.DISCORD_BRIDGE_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN)?.trim(),
  voice: {
    tokenTtlSeconds: Number(process.env.SFU_TOKEN_TTL_SECONDS ?? "300"),
    url: process.env.LIVEKIT_URL ?? "ws://livekit:7880",
    publicUrl: process.env.LIVEKIT_PUBLIC_URL || (baseDomain ? `${protocol === "https" ? "wss" : "ws"}://${baseDomain}` : "ws://localhost:7880"),
    apiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
    apiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
  },
  synapse: {
    baseUrl: (process.env.SYNAPSE_BASE_URL ?? "http://synapse:8008").trim(),
    publicBaseUrl: (process.env.SYNAPSE_PUBLIC_URL || (baseDomain ? `${protocol}://${baseDomain}` : "http://localhost:8008"))?.trim(),
    accessToken: process.env.SYNAPSE_ACCESS_TOKEN?.trim(),
    strictProvisioning: process.env.SYNAPSE_STRICT_PROVISIONING === "true",
  },
  s3: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicUrlPrefix: process.env.S3_PUBLIC_URL_PREFIX,
  },
};

// Config verification logging
console.log("--- Configuration Loaded ---");
console.log(`Port: ${config.port}`);
console.log(`Dev Auth Bypass: ${config.devAuthBypass}`);
console.log(`Discord OIDC Enabled: ${Boolean(config.oidc.discordClientId)}`);
console.log(`Google OIDC Enabled: ${Boolean(config.oidc.googleClientId)}`);
console.log(`Twitch OIDC Enabled: ${Boolean(config.oidc.twitchClientId)}`);
console.log(
  `Discord Bridge Credentials: ${Boolean(config.discordBridge.clientId && config.discordBridge.clientSecret)}`,
);
console.log(`Discord Bot Token Present: ${Boolean(config.discordBotToken)}`);
console.log(`Discord Bridge Callback: ${config.discordBridge.callbackUrl}`);
console.log("----------------------------");
