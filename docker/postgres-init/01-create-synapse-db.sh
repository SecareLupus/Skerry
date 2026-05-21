#!/bin/bash
# Creates the "synapse" database on the postgres container for Synapse.
# Mounted at /docker-entrypoint-initdb.d/ — runs only when the data dir is empty.
# Idempotent: skips if database already exists (handles partial-init recovery).
set -e

if psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'synapse'" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" | grep -q 1; then
    echo "synapse database already exists, skipping."
else
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
        CREATE DATABASE synapse
            WITH LC_COLLATE 'C'
                 LC_CTYPE 'C'
                 TEMPLATE template0;
EOSQL
    echo "synapse database created."
fi
