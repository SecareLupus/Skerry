![Skerry Full Width Logo](assets/Skerry_FullWidth.png)

# Skerry (`SecareLupus/Skerry`)

Skerry (or **Skerry Chat**) is the monorepo for the **Skerry Collective Hub Chat Platform**: a Matrix-based, Discord-like community product for creator collectives.

## Current Capability

Skerry provides a complete community chat experience with high-level abstractions over Matrix and Discord:

- **Single-Domain Routing**: Unified entry via Caddy reverse proxy with path-based routing (`/auth`, `/v1`, `/_matrix`, etc.).
- **Identity & Auth**: Multi-provider OIDC (Discord, Google, Twitch, Keycloak) plus developer quick-login. Account linking with split-detection interstitial.
- **Hub Architecture**: Multi-server (space) organization with categories, channels (text, voice, announcement, forum), and role-based permissions (5-tier audience model).
- **Rich Messaging**: Real-time chat via SSE with polling fallback. Markdown rendering (bold, italic, code blocks, block quotes, lists). Message editing with revision history. File uploads, stickers (PNG/GIF/Lottie), and link embeds (Open Graph + oEmbed).
- **Reactions & Threads**: Emoji reaction picker with multi-user badges. Quote-replies with Discord snowflake resolution. Threaded conversations with reply counts and thread panel.
- **Voice & Video (scaffolded)**: LiveKit token issuance, pre-join UI, device settings modal, and voice room management. End-to-end audio/video requires further integration testing.
- **Direct Messages**: DM picker, DM server creation, persistent DM channels in sidebar.
- **Discord Bridge**: Bi-directional message relay with emoji mirroring, block quote preservation, edit/pin/delete mirroring, and @mention escaping.
- **Moderation & Audit**: Kick, ban, timeout (via Synapse admin API), warn, strike escalation (3→timeout, 5→kick, 7→ban). Report triage dashboard. Full audit log with role-based snapshots.
- **PWA & Notifications**: Dynamic per-server manifest. Service worker with push notifications via VAPID auto-generated keypair. @mention push delivery.
- **Server Discovery**: Server invites with configurable role assignment and join policies (open, approval, invite-only). Search modal for messages.
- **Theming**: Light/dark theme per user, with theme-aware overlay components (drawers, popovers). SVG icon system via lucide-react.
- **Full Dockerization**: Docker Compose stack (Caddy, Synapse, LiveKit, PostgreSQL, control plane) with one-command deployment.
- **Landing Page**: Deployed at `secarelupus.github.io/Skerry/` via GitHub Actions Pages.

## Repository Layout

```text
.
├── apps/                 # Monorepo applications
│   ├── control-plane/      # Fastify policy gate, auth, and provisioning API
│   └── web/                # Next.js web client
├── packages/             # Shared logic
│   └── shared/             # Shared types, constants, and domain contracts
├── docs/                 # Documentation (reports, landing page assets)
├── scripts/              # Utility scripts (bootstrap, backup, cleanup)
├── assets/               # Static brand assets and media
├── docker/               # Service-specific configs (Caddy, Synapse)
├── docker-compose.yml    # Full stack orchestration
├── docker-compose-test.yml # Isolated E2E test environment
└── AGENTS.md             # AI collaborator instructions and project scope
```

## Internal Network Architecture

When running via Docker Compose, services communicate using service names as hostnames:

| Service           | Internal URL         | Purpose                                 |
| :---------------- | :------------------- | :-------------------------------------- |
| **Caddy**         | Port 80/443          | Public entry point & path-based routing |
| **Web UI**        | `web:3000`           | Frontend Next.js application            |
| **Control Plane** | `control-plane:4000` | Fastify API & provisioning gateway      |
| **Matrix**        | `synapse:8008`       | Matrix homeserver (Synapse)             |
| **LiveKit**       | `livekit:7880`       | Real-time voice/video signaling         |
| **Database**      | `postgres:5432`      | Persistence layer (41 migrations)       |

## Quick Start (Docker)

```bash
pnpm install
cp .env.example .env
# Edit .env with your secrets/domain
docker compose up -d
```

- **Web UI**: `http://localhost` (or your configured `BASE_DOMAIN`)
- **API Health**: `http://localhost/health`

### One-Click Bootstrap

For a production-ready deployment on a fresh Linux instance:

```bash
chmod +x scripts/bootstrap-hub.sh
./scripts/bootstrap-hub.sh
```

This generates unique secrets, pulls images, runs migrations, and starts the entire stack.

### Release Process

Docker images are published to GitHub Container Registry (GHCR) on manual release, not on push to main.

1. **Tag the release**:
   ```bash
   git tag v0.1.0-alpha
   git push --tags
   ```

2. **Publish images**: Run the **Publish Docker Images** workflow via GitHub Actions → `workflow_dispatch` with the version tag (e.g. `v0.1.0-alpha`). Publishes three images to `ghcr.io/secarelupus/`:
   - `skerry-control-plane:v0.1.0-alpha`
   - `skerry-web:v0.1.0-alpha`
   - `skerry-sticker-renderer:v0.1.0-alpha`

3. **Deploy**: Update `SKERRY_VERSION` in `.env` (or the compose file directly), then:
   ```bash
   docker compose pull
   docker compose up -d
   ```

To pin a specific version in production, set `SKERRY_VERSION=v0.1.0-alpha` in `.env`. The compose file defaults to `v0.1.0-alpha` when unset.

## Development

For local development running services individually:

1. **Start Infrastructure**: `docker compose up -d postgres synapse livekit coturn caddy`
2. **Run Apps**: `pnpm dev`

### Matrix (Synapse) Setup

1. **Generate signing key**: `bash docker/synapse/setup-synapse.sh`
2. **Admin Access Token**: Needed for `SYNAPSE_ACCESS_TOKEN` in `.env`. Create an admin user via the Synapse admin API or use an existing administrative account.

### Discord Bridge Setup

1. **Discord App**: Create a Discord application at the developer portal.
2. **OIDC**: Configure redirect URIs to `https://<domain>/auth/callback/discord`.
3. **Bot**: Add a bot to your application and provide `DISCORD_BRIDGE_BOT_TOKEN` in `.env`.

### Voice & Video Setup

Powered by **LiveKit**. The `docker-compose.yml` includes a LiveKit server and a `coturn` instance for TURN/STUN. Ensure `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are configured.

## Testing

The project maintains a rigorous testing suite across the "Golden Path" of community interactions.

- **Typecheck**: `pnpm typecheck` (all 3 packages)
- **Unit & Integration**: `pnpm test`
- **End-to-End (Playwright)**: 33 specs covering authentication, community orchestration, messaging, moderation, accessibility, voice channels, and visual regression
  ```bash
  pnpm test:env:up        # Start isolated E2E environment
  pnpm test:e2e:run       # Run full suite
  pnpm test:env:down      # Tear down
  ```

## Federation (Web-of-Trust)

Skerry Hubs can trust each other for cross-hub browsing without secondary logins.

1. **Exchange Secrets**: Hub admins exchange a 32+ character shared secret.
2. **Add Trust**: Use the Admin API or Dashboard:
   ```bash
   curl -X POST http://localhost:4000/v1/admin/federation/trust \
     -H "Authorization: Bearer ***" \
     -d '{"hubUrl": "https://remote-hub.com", "sharedSecret": "...", "trustLevel": "member"}'
   ```
3. **Identity Resolution**: Remote users are assigned a local `fed_` proxy ID and can view public spaces as authenticated guests.

## Storage Maintenance

To prevent Docker storage and build cache from consuming excessive disk space:

- **Manual Cleanup**: `pnpm run cleanup`
- **Automatic**: Runs before every `pnpm run build` (prunes build cache and dangling images)
