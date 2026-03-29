#!/bin/bash
set -e

echo "🚀 Skerry Hub Bootstrapper"
echo "=========================="

# Check dependencies
for cmd in docker docker-compose pnpm; do
  if ! command -v $cmd &> /dev/null; then
    echo "❌ Error: $cmd is not installed."
    exit 1
  fi
done

# Generate secrets if not present
if [ ! -f .env ]; then
  echo "📄 Creating .env file..."
  cp .env.example .env
  
  # Generate random secrets
  sed -i "s/OIDC_CLIENT_SECRET=.*/OIDC_CLIENT_SECRET=$(openssl rand -hex 32)/" .env
  sed -i "s/SYNAPSE_AS_TOKEN=.*/SYNAPSE_AS_TOKEN=$(openssl rand -hex 32)/" .env
  sed -i "s/SYNAPSE_HS_TOKEN=.*/SYNAPSE_HS_TOKEN=$(openssl rand -hex 32)/" .env
  echo "✅ .env created with random secrets."
fi

# Pull images
echo "📥 Pulling Docker images..."
docker-compose pull

# Start database
echo "🐘 Starting Database..."
docker-compose up -d db
echo "⏳ Waiting for DB to be ready..."
sleep 5

# Run migrations
echo "🛠️ Running control-plane migrations..."
docker-compose run --rm control-plane pnpm run migrate

# Start everything
echo "🚢 Launching Skerry Hub..."
docker-compose up -d

echo "=========================="
echo "🎉 Skerry Hub is starting!"
echo "📍 Access it at: http://localhost:3000"
echo "📊 Admin Control: http://localhost:4000/health"
echo "=========================="
