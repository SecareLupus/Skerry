#!/bin/bash
# skerry-backup — PostgreSQL backup with daily/weekly retention.
# Runs from the db-backup service in docker-compose.
#
# Environment:
#   PGHOST / PGUSER / PGPASSWORD / PGDATABASE — passed by compose from .env.ops
#   SYNAPSE_DATABASE — optional override for synapse DB name (default: synapse)
#   BACKUP_DIR — optional override (default: /backups)
#   RETENTION_DAILY — number of daily backups to keep (default: 7)
#   RETENTION_WEEKLY — number of weekly (Sunday) backups to keep (default: 4)
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
SYNAPSE_DATABASE="${SYNAPSE_DATABASE:-synapse}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
DOW=$(date +"%u")               # 1=Mon … 7=Sun
LOG_TAG="[$(date '+%Y-%m-%d %H:%M:%S')] [backup]"

# ── helpers ──────────────────────────────────────────────────────────
log()  { echo "${LOG_TAG} $*"; }
die()  { log "FAILURE: $*"; exit 1; }

# ── ensure backup directory exists ───────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── dump all databases ──────────────────────────────────────────────
# Dump both the main app database and the Synapse Matrix database.
DATABASES=("${PGDATABASE:-skerry}" "${SYNAPSE_DATABASE}")

for DB in "${DATABASES[@]}"; do
    BASENAME="${DB}_${TIMESTAMP}"
    SQL_FILE="${BACKUP_DIR}/${BASENAME}.sql"
    GZ_FILE="${BACKUP_DIR}/${BASENAME}.sql.gz"

    log "Dumping database: ${DB} (host=${PGHOST:-?})…"

    if PGDATABASE="${DB}" pg_dump --no-owner --no-acl > "${SQL_FILE}" 2>/tmp/pg_dump_stderr.log; then
        :
    else
        die "pg_dump of ${DB} failed — see /tmp/pg_dump_stderr.log"
    fi

    # ── compress ─────────────────────────────────────────────────────
    gzip -f "${SQL_FILE}"
    SIZE=$(du -h "${GZ_FILE}" | cut -f1)
    log "  Dump complete: ${GZ_FILE} (${SIZE})"
done

# ── retention ────────────────────────────────────────────────────────
# Apply retention per database prefix: skerry_* and synapse_*
for PREFIX in "${PGDATABASE:-skerry}" "${SYNAPSE_DATABASE}"; do
    # 1. Daily retention: keep the last N daily backups (any day of week).
    log "Applying daily retention for ${PREFIX} (keep ${RETENTION_DAILY})…"
    mapfile -t DAILY_FILES < <(find "${BACKUP_DIR}" -maxdepth 1 \
        -name "${PREFIX}_*.sql.gz" -type f | sort -r)

    DAILY_COUNT=0
    for f in "${DAILY_FILES[@]}"; do
        DAILY_COUNT=$((DAILY_COUNT + 1))
        if [ "${DAILY_COUNT}" -gt "${RETENTION_DAILY}" ]; then
            log "  Pruning daily: $(basename "${f}")"
            rm -f "${f}"
        fi
    done

    # 2. Weekly retention: keep the last N Sunday backups.
    if [ "${RETENTION_WEEKLY}" -gt 0 ]; then
        log "Applying weekly retention for ${PREFIX} (keep ${RETENTION_WEEKLY} Sundays)…"
        mapfile -t SUNDAY_FILES < <(find "${BACKUP_DIR}" -maxdepth 1 \
            -name "${PREFIX}_*.sql.gz" -type f | while read -r f; do
            bn=$(basename "${f}" .sql.gz)
            dt=${bn#${PREFIX}_}           # YYYY-MM-DD_HHMMSS
            dt=${dt%_*}                    # YYYY-MM-DD
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
done

log "Backup completed successfully."
