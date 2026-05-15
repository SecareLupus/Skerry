#!/bin/bash
# skerry-backup — PostgreSQL backup with daily/weekly retention.
# Runs from the db-backup service in docker-compose.
#
# Environment:
#   PGHOST / PGUSER / PGPASSWORD / PGDATABASE — passed by compose from .env.ops
#   BACKUP_DIR — optional override (default: /backups)
#   RETENTION_DAILY — number of daily backups to keep (default: 7)
#   RETENTION_WEEKLY — number of weekly (Sunday) backups to keep (default: 4)
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
DOW=$(date +"%u")               # 1=Mon … 7=Sun
BASENAME="skerry_${TIMESTAMP}"
SQL_FILE="${BACKUP_DIR}/${BASENAME}.sql"
GZ_FILE="${BACKUP_DIR}/${BASENAME}.sql.gz"
LOG_TAG="[$(date '+%Y-%m-%d %H:%M:%S')] [backup]"

# ── helpers ──────────────────────────────────────────────────────────
log()  { echo "${LOG_TAG} $*"; }
die()  { log "FAILURE: $*"; exit 1; }

# ── ensure backup directory exists ───────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── dump ─────────────────────────────────────────────────────────────
log "Starting PostgreSQL dump (db=${PGDATABASE:-?} host=${PGHOST:-?})…"

if pg_dump --no-owner --no-acl > "${SQL_FILE}" 2>/tmp/pg_dump_stderr.log; then
    :
else
    die "pg_dump failed — see /tmp/pg_dump_stderr.log"
fi

# ── compress ─────────────────────────────────────────────────────────
gzip -f "${SQL_FILE}"
SIZE=$(du -h "${GZ_FILE}" | cut -f1)
log "Dump complete: ${GZ_FILE} (${SIZE})"

# ── retention ────────────────────────────────────────────────────────
# 1. Daily retention: keep the last N daily backups (any day of week).
log "Applying daily retention (keep ${RETENTION_DAILY})…"
mapfile -t DAILY_FILES < <(find "${BACKUP_DIR}" -maxdepth 1 \
    -name 'skerry_*.sql.gz' -type f | sort -r)

DAILY_COUNT=0
for f in "${DAILY_FILES[@]}"; do
    DAILY_COUNT=$((DAILY_COUNT + 1))
    if [ "${DAILY_COUNT}" -gt "${RETENTION_DAILY}" ]; then
        log "  Pruning daily: $(basename "${f}")"
        rm -f "${f}"
    fi
done

# 2. Weekly retention: keep the last N Sunday backups.
#    A Sunday backup is one whose filename timestamp falls on a Sunday.
if [ "${RETENTION_WEEKLY}" -gt 0 ]; then
    log "Applying weekly retention (keep ${RETENTION_WEEKLY} Sundays)…"
    mapfile -t SUNDAY_FILES < <(find "${BACKUP_DIR}" -maxdepth 1 \
        -name 'skerry_*.sql.gz' -type f | while read -r f; do
        # Extract date part: skerry_YYYY-MM-DD_HHMMSS.sql.gz → YYYY-MM-DD
        bn=$(basename "${f}" .sql.gz)
        dt=${bn#skerry_}              # YYYY-MM-DD_HHMMSS
        dt=${dt%_*}                    # YYYY-MM-DD
        # Check if it's a Sunday (date -d "$dt" +%u → 7)
        if [ "$(date -d "${dt}" +%u 2>/dev/null || true)" = "7" ]; then
            echo "${f}"
        fi
    done | sort -r)

    WEEKLY_COUNT=0
    for f in "${SUNDAY_FILES[@]}"; do
        WEEKLY_COUNT=$((WEEKLY_COUNT + 1))
        if [ "${WEEKLY_COUNT}" -gt "${RETENTION_WEEKLY}" ]; then
            log "  Pruning weekly (Sunday): $(basename "${f}")"
            rm -f "${f}"
        fi
    done
fi

log "Backup completed successfully."
