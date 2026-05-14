# Skerry Deployment Kit

Everything needed to run a Skerry Hub from pre-built Docker images.

## Quick Start

```bash
# 1. (Optional) Edit .env — BASE_DOMAIN defaults to localhost
#    Uncomment OAuth providers to enable login.

# 2. Initialize (first run only — generates secrets and .env.ops)
docker compose run --rm init

# 3. Start
docker compose up -d
```

First run requires `docker compose run --rm init` to generate secrets. Subsequent starts just need `docker compose up -d` — init runs as a dependency but exits immediately since `.env.ops` already exists.

## Access

- **Web UI**: `http://localhost` (or your `BASE_DOMAIN`)
- **Health**: `http://localhost/health`

## Configuration

Edit `.env` — `BASE_DOMAIN` defaults to `localhost` (works for local testing). Set it to your domain for production.

```bash
BASE_DOMAIN=skerry.chat    # Change from localhost for production

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
