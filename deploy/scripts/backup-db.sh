#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql"
RETENTION_DAYS=7

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting Database Backup..."

# Perform pg_dump
# Environment variables like PGHOST, PGUSER, PGPASSWORD, PGDATABASE should be set
pg_dump -v > "${BACKUP_FILE}"

# Optional: Compress the backup
gzip "${BACKUP_FILE}"
BACKUP_FILE_GZ="${BACKUP_FILE}.gz"

echo "[$(date)] Backup completed: ${BACKUP_FILE_GZ}"

# Cleanup old backups
echo "[$(date)] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "db_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete

# Optional: Upload to S3 if configured
if [ -n "${S3_BUCKET}" ] && [ -n "${S3_ACCESS_KEY_ID}" ]; then
    echo "[$(date)] Uploading to S3: s3://${S3_BUCKET}/backups/"
    # Assuming aws-cli or rclone is available
    # aws s3 cp "${BACKUP_FILE_GZ}" "s3://${S3_BUCKET}/backups/db_backup_${TIMESTAMP}.sql.gz"
fi

echo "[$(date)] Backup process finished successfully."
