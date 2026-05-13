# Skerry Deployment Kit

This directory contains everything needed to deploy a Skerry Hub from
pre-built Docker images on GitHub Container Registry.

## Files

```
.
├── docker-compose.yml              # Service orchestration (uses GHCR images)
├── .env.example                    # Environment template → copy to .env
├── docker/
│   ├── Caddyfile                   # Reverse proxy routing
│   └── synapse/
│       ├── homeserver.yaml         # Synapse Matrix config
│       ├── hub-localhost.log.config
│       └── setup-synapse.sh        # Signing key generator
├── scripts/
│   ├── bootstrap-hub.sh            # One-command setup
│   └── backup-db.sh                # PostgreSQL backup (daily cron)
└── README.md
```

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env with your domain and OAuth credentials

# 2. Bootstrap (generates secrets, pulls images, runs migrations, starts)
chmod +x scripts/bootstrap-hub.sh
./scripts/bootstrap-hub.sh
```

Or step by step:

```bash
cp .env.example .env
# Edit .env — set BASE_DOMAIN and OAuth credentials at minimum

# Generate Synapse signing key
bash docker/synapse/setup-synapse.sh

# Pull images
docker compose pull

# Start
docker compose up -d
```

## Access

- **Web UI**: `http://localhost` (or your `BASE_DOMAIN`)
- **Health check**: `http://localhost/health`
- **Metrics**: `http://localhost/metrics` (if `METRICS_TOKEN` configured)

## Upgrading

```bash
# Edit .env and bump SKERRY_VERSION
SKERRY_VERSION=v0.2.0-alpha docker compose pull
docker compose up -d
```

## Requirements

- Docker Engine 24+ with Compose v2
- A domain name (for OAuth redirects and federation)
- Discord application credentials (for login)

## Images

| Image | Registry |
|-------|----------|
| `skerry-control-plane` | `ghcr.io/secarelupus/skerry-control-plane` |
| `skerry-web` | `ghcr.io/secarelupus/skerry-web` |
| `skerry-sticker-renderer` | `ghcr.io/secarelupus/skerry-sticker-renderer` |
