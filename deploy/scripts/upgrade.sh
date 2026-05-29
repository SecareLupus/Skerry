#!/bin/sh
# upgrade.sh — merge .env changes, pull latest images, restart changed services
set -e

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Merge .env into .env.ops, regenerate appservice YAML (same as start.sh does)
"$SCRIPTS_DIR/start.sh" --init-only

cd "$(cd "$SCRIPTS_DIR/.." && pwd)"

echo "Pulling latest images..."
docker compose pull

echo "Restarting changed services..."
docker compose up -d

echo ""
echo "Upgrade complete. Check status with: docker compose ps"
