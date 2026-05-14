# Skerry Deployment Kit

Everything needed to run a Skerry Hub from pre-built Docker images.

## Quick Start

```bash
# 1. Set your domain
echo "BASE_DOMAIN=skerry.chat" > .env

# 2. (Optional) Enable OAuth — uncomment and fill in:
#    DISCORD_CLIENT_ID=...
#    DISCORD_CLIENT_SECRET=...
#    DISCORD_BOT_TOKEN=...

# 3. Start
docker compose up -d
```

First run auto-generates secrets, creates the Synapse signing key, and writes `.env.ops`. Subsequent starts reuse the same secrets and merge any changes from `.env`.

## Access

- **Web UI**: `http://localhost` (or your `BASE_DOMAIN`)
- **Health**: `http://localhost/health`

## Configuration

Edit `.env` — only `BASE_DOMAIN` is required. All other values are optional.

```bash
BASE_DOMAIN=skerry.chat    # REQUIRED

# Optional — OAuth (uncomment to enable)
#DISCORD_CLIENT_ID=
#DISCORD_CLIENT_SECRET=
#DISCORD_BOT_TOKEN=
#GOOGLE_CLIENT_ID=
#GOOGLE_CLIENT_SECRET=
#TWITCH_CLIENT_ID=
#TWITCH_CLIENT_SECRET=
#EMAIL=
```

Secrets (`POSTGRES_PASSWORD`, `SESSION_SECRET`, etc.) are auto-generated on first run and stored in `.env.ops`. Edit `.env` to change settings; changes are merged on next `docker compose up -d`.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

## Files

```
.
├── .env                    # You edit this
├── .env.ops               # Generated — do not edit
├── docker-compose.yml
├── docker/
│   ├── Caddyfile
│   └── synapse/            # Synapse config
└── scripts/
    ├── init.sh             # First-run initialization
    └── backup-db.sh        # Daily PostgreSQL backup
```

## Requirements

- Docker Engine 24+ with Compose v2.20+
- A domain name (for OAuth redirects)
- Discord application credentials (for login)
