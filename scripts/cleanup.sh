#!/bin/bash
# Docker Maintenance Script for Skerry
# Addresses Issue #20: Storage Audit

set -e

echo "--- Skerry Storage Maintenance ---"

# Check if docker exists (skips if running inside a Docker build container)
if ! command -v docker &> /dev/null
then
    echo "Docker command not found. Skipping host maintenance (likely running inside a container)."
    exit 0
fi

echo "1. Pruning Docker build cache..."
docker builder prune -f

echo "2. Pruning dangling Docker images..."
docker image prune -f

# We omit volume pruning as per user preference (safety)
# echo "3. Pruning unused volumes..."
# docker volume prune -f

echo ""
echo "Maintenance complete! Disk space has been reclaimed."
