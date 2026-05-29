#!/bin/sh
# stop.sh — stop Skerry services
set -e

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SKERRY_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
cd "$SKERRY_DIR"

docker compose down
echo "Skerry stopped."
