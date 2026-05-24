#!/bin/bash
# Mounted at /docker-entrypoint-initdb.d/ — runs only when the data dir is empty.
# PGHOST is set in .env.ops for runtime connectivity, but during initdb.d
# the temp server only listens on Unix socket — unset to avoid TCP attempt.
unset PGHOST
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
    CREATE DATABASE synapse
        WITH LC_COLLATE 'C'
             LC_CTYPE 'C'
             TEMPLATE template0;
EOSQL

echo "synapse database created."
