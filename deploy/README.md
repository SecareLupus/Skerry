# Skerry Deployment Kit

Everything needed to run a Skerry Hub from pre-built Docker images.

## Quick Start

```bash
# 1. (Optional) Edit .env — BASE_DOMAIN defaults to localhost
#    Uncomment OAuth providers to enable login.

# 2. Initialize (first run only — generates secrets and .env.ops)
docker compose run --rm init

# 3. Start
docker compose --env-file .env.ops up -d
```

First run requires `docker compose run --rm init` to generate secrets. Subsequent starts just need `docker compose --env-file .env.ops up -d` — init runs as a dependency but exits immediately since `.env.ops` already exists.

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

Secrets (`POSTGRES_PASSWORD`, `SESSION_SECRET`, etc.) are auto-generated on first run and stored in `.env.ops`. Edit `.env` to change settings; changes are merged on next `docker compose --env-file .env.ops up -d`.

## Upgrading

```bash
docker compose pull
docker compose --env-file .env.ops up -d
```

## Backup & Restore

### Where backups are stored

Backups are stored in the `pg_backups` Docker volume, mounted at `/backups` inside
the `db-backup` container.  You can inspect them with:

```bash
docker compose exec db-backup ls -lh /backups/
```

To copy a backup locally:

```bash
docker compose cp db-backup:/backups/skerry_YYYY-MM-DD_HHMMSS.sql.gz .
```

### Schedule and retention

The `db-backup` service uses the `postgres:16` image.  It wakes every day at
02:00 UTC, runs `pg_dump`, gzips the output, and stores it as:

    skerry_YYYY-MM-DD_HHMMSS.sql.gz

Retention policy (applied after every successful dump):

- **Daily** — keep the 7 most recent backups (any day of week).
- **Weekly** — keep up to 4 Sunday backups (Sunday = the day on which the
  backup timestamp falls), regardless of daily age.

You can override the defaults via environment in `.env`:

```
RETENTION_DAILY=7    # number of daily backups to keep
RETENTION_WEEKLY=4   # number of Sunday backups to keep
```

### Restore

To restore the latest backup:

```bash
# 1. Copy the backup into the postgres container
gunzip -c skerry_YYYY-MM-DD_HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U skerry -d skerry
```

Or, from a specific backup file already inside the db-backup container:

```bash
docker compose exec db-backup sh -c 'gunzip -c /backups/skerry_YYYY-MM-DD_HHMMSS.sql.gz' | \
  docker compose exec -T postgres psql -U skerry -d skerry
```

**Important:** Restoring overwrites the current database.  Take a fresh backup
first if you need to preserve the current state:

```bash
docker compose exec db-backup /usr/local/bin/backup.sh
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
