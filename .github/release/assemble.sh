#!/bin/bash
set -euo pipefail
STAGING="skerry"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# Copy files per manifest
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  src="${line%% -> *}"
  dest="${line##* -> }"
  mkdir -p "$STAGING/$(dirname "$dest")"
  cp -r "$src" "$STAGING/$dest"
done < .github/release/manifest

# Overlay release-specific files
cp .github/release/.env "$STAGING/"
cp .github/release/README.md "$STAGING/"
cp .github/release/docker-compose.yml "$STAGING/"

echo "Release tarball assembled in $STAGING/"
ls -laR "$STAGING/"
