![Skerry Full Width Logo](Skerry_FullWidth.png)

# Skerry

Skerry (or **Skerry Chat**) is the monorepo for the **Skerry Collective Hub Chat Platform**: a Matrix-based, Discord-like community product for creator collectives.

## Current Capability

The platform provides a complete community experience with high-level abstractions over Matrix:

- **Single-Domain Routing**: Unified entry point via Caddy; no more subdomain management.
- **Identity & Auth**: Multi-provider OIDC (Discord, Google, Twitch) or Developer Login.
- **Hub Architecture**: Multi-server (space) organization with categories and channels.
- **Rich Messaging**: Persistent chat, reactions, file uploads, and mention markers.
- **Voice & Video**: Ultra-low latency conferencing powered by LiveKit.
- **Discord Bridge**: Bi-directional message relay between Matrix channels and Discord guilds.
- **Advanced Moderation**: Reporting system, audit logs, and policy-driven access control.
- **Full Dockerization**: Simple, one-command deployment for the entire stack.

## Repository Layout

```text
.
├── apps/
│   ├── control-plane/      # Fastify policy gate, auth, and provisioning API
│   └── web/                # Next.js web client
├── packages/
│   └── shared/             # Shared types, constants, and domain contracts
├── docker/
│   ├── Caddyfile           # Reverse proxy / routing configuration
│   └── synapse/            # Matrix homeserver configuration
├── docker-compose.yml      # Full stack: Postgres, Synapse, LiveKit, Control Plane, Web, Caddy
└── AGENTS.md               # AI collaborator instructions and project scope
```

## Internal Network Architecture

When running via Docker Compose, services reside on a shared network (`escapehatch_default`) and communicate using their service names as hostnames:

| Service           | Internal URL         | Purpose                                 |
| :---------------- | :------------------- | :-------------------------------------- |
| **Caddy**         | Port 80/443          | Public entry point & path-based routing |
| **Web UI**        | `web:3000`           | Frontend Next.js application            |
| **Control Plane** | `control-plane:4000` | Fastify API & provisioning gateway      |
| **Matrix**        | `synapse:8008`       | Matrix homeserver (Synapse)             |
| **LiveKit**       | `livekit:7880`       | Real-time voice/video signaling         |
| **Database**      | `postgres:5432`      | Persistence layer                       |

## Quick Start (Docker)

The fastest way to run the entire stack is using Docker Compose:

```bash
pnpm install
cp .env.example .env
# Edit .env with your secrets/domain
docker compose up -d
```

- **Web UI**: `http://localhost` (or your configured `BASE_DOMAIN`)
- **API Health**: `http://localhost/health`

### One-Click Bootstrap (Recommended)

For a production-ready deployment on a fresh Linux instance:

```bash
chmod +x bootstrap-hub.sh
./bootstrap-hub.sh
```

This script generates unique secrets, pulls images, runs migrations, and starts the entire stack.


## Development

For local development where you want to run services individually:

1. **Start Infrastructure**: `docker compose up -d postgres synapse livekit coturn caddy`
2. **Run Apps**: `pnpm dev` (matches components in `package.json`)

### Matrix (Synapse) Setup

1. **Generate signing key**: `bash docker/synapse/setup-synapse.sh`
2. **Admin Access Token**: Needed for `SYNAPSE_ACCESS_TOKEN` in `.env`. You can create an admin user via the `synapse:8008` admin API or use an established administrative account.

### Discord Bridge Setup

1. **Discord App**: Create a Discord application at the developer portal.
2. **OIDC**: Configure redirect URIs to `https://<domain>/auth/callback/discord`.
3. **Bot**: Add a bot to your application and provide `DISCORD_BRIDGE_BOT_TOKEN` in `.env`.

### Voice & Video Setup

Powered by **LiveKit**. The `docker-compose.yml` includes a LiveKit server and a `coturn` instance for TURN/STUN support. Ensure `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are configured.

## Federation (Web-of-Trust)

Skerry Hubs can trust each other to allow cross-hub browsing and interaction without secondary logins.

1. **Exchange Secrets**: Hub admins must exchange a 32+ character shared secret.
2. **Add Trust**: Use the Admin API or Dashboard to add the remote hub:
   ```bash
   # Add a trusted hub
   curl -X POST http://localhost:4000/v1/admin/federation/trust \
     -H "Authorization: Bearer <admin_token>" \
     -d '{"hubUrl": "https://remote-hub.com", "sharedSecret": "...", "trustLevel": "member"}'
   ```
3. **Identity Resolution**: Remote users are assigned a local `fed_` proxy ID and can view public spaces as authenticated guests.


## Validation Commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```
