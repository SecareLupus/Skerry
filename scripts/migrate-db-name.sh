#!/bin/bash
# Skerry - Database Renaming Utility
# Used to upgrade existing development databases from the 'escapehatch' name to 'skerry'.

set -e

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

echo "=> Disconnecting active sessions to 'escapehatch' database..."
docker compose exec -T postgres psql -U postgres -d postgres -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'escapehatch' AND pid <> pg_backend_pid();
" || echo "No active connections or database not found."

echo "=> Renaming database 'escapehatch' to 'skerry'..."
docker compose exec -T postgres psql -U postgres -d postgres -c "ALTER DATABASE escapehatch RENAME TO skerry;"

echo "=> Database renamed successfully! You may need to run 'docker compose down' and 'docker compose up -d' for changes to take effect across all application containers."
