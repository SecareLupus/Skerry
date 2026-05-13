#!/bin/bash
set -e

echo "🚀 Skerry Hub Bootstrapper"
echo "=========================="

# Check dependencies
for cmd in docker; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Error: docker is not installed."
    exit 1
  fi
done

# Generate .env if not present
if [ ! -f .env ]; then
  echo "📄 Creating .env from .env.example..."
  cp .env.example .env
  
  # Generate random secrets
  POSTGRES_PW=$(openssl rand -hex 16)
  SESSION_SECRET=$(openssl rand -hex 32)
  
  sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PW/" .env
  sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
  echo "✅ .env created with random secrets."
else
  echo "📄 Using existing .env file."
fi

# Generate Synapse signing key if missing
if [ ! -f docker/synapse/hub-localhost.signing.key ]; then
  echo "🔑 Generating Synapse signing key..."
  bash docker/synapse/setup-synapse.sh
fi

# Pull images
echo "📥 Pulling Docker images..."
docker compose pull

# Start database first
echo "🐘 Starting PostgreSQL..."
docker compose up -d postgres
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U postgres 2>/dev/null; do
  sleep 2
done

# Run migrations
echo "🛠️ Running control-plane migrations..."
docker compose run --rm control-plane pnpm --filter @skerry/control-plane migrate

# Start everything
echo "🚢 Launching Skerry Hub..."
docker compose up -d

echo "=========================="
echo "🎉 Skerry Hub is starting!"
echo "📍 Access it at: http://localhost (or your configured BASE_DOMAIN)"
echo "📊 Health check: http://localhost/health"
echo "=========================="
