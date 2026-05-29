#!/bin/sh
# upgrade.sh — pull latest images and restart changed services
set -e

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SKERRY_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
cd "$SKERRY_DIR"

ENV_OPS=".env.ops"

if [ ! -f "$ENV_OPS" ]; then
  echo "No .env.ops found — run ./scripts/start.sh first to initialize."
  exit 1
fi

# shellcheck disable=SC1090
. "./$ENV_OPS"

# Regenerate appservice registration with current tokens
cat > "docker/synapse/skerry-appservice.yaml" << YAML
id: Skerry
url: http://control-plane:4000
as_token: ${SYNAPSE_AS_TOKEN}
hs_token: ${SYNAPSE_HS_TOKEN}
sender_localpart: skerry-bot
namespaces:
  users:
    - exclusive: false
      regex: "@.*"
  rooms: []
  aliases: []
YAML

echo "Pulling latest images..."
docker compose pull

echo "Restarting changed services..."
docker compose up -d

echo ""
echo "Upgrade complete. Check status with: docker compose ps"
