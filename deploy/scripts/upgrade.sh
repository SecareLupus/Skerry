#!/bin/sh
# upgrade.sh — merge .env changes, pull latest images, restart changed services
set -e

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Merge .env into .env.ops, regenerate appservice YAML (same as start.sh does)
"$SCRIPTS_DIR/start.sh" --init-only

cd "$(cd "$SCRIPTS_DIR/.." && pwd)"

# Source .env.ops so compose gets SKERRY_VERSION for image tag resolution.
# (start.sh --init-only ran in a subprocess — its exports don't propagate.)
# shellcheck disable=SC1090
. "./.env.ops"
export SKERRY_VERSION
export COMPOSE_PROFILES

echo "Pulling images (${SKERRY_VERSION:-latest})..."
docker compose pull

echo "Restarting changed services..."
docker compose up -d

echo ""
echo "Upgrade complete. Check status with: docker compose ps"
