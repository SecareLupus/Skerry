#!/bin/bash
# Creates the "synapse" database on the postgres container for Synapse.
# Mounted at /docker-entrypoint-initdb.d/ — runs only when the data dir is empty.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
    CREATE DATABASE synapse
        WITH LC_COLLATE 'C'
             LC_CTYPE 'C'
             TEMPLATE template0;
EOSQL

echo "synapse database created."
