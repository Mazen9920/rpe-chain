#!/usr/bin/env bash
# RPE Supply DB backup — pg_dump custom format with retention.
#
# Usage:
#     DATABASE_URL=postgresql://... ./backup.sh [BACKUP_DIR]
#
# Optional env:
#     BACKUP_DIR        local dir (default /var/backups/rpe-supply)
#     BACKUP_RETAIN_DAYS  daily backups kept (default 14)
#     BACKUP_REMOTE     rclone/aws remote (e.g. s3://bucket/path).
#                       When set, the dump is uploaded after creation.
#
# Recommended cron (host):
#     0 2 * * *  /opt/rpe/backup.sh >> /var/log/rpe-backup.log 2>&1

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${1:-${BACKUP_DIR:-/var/backups/rpe-supply}}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/rpe-supply-$TS.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] $(date -u +%FT%TZ) dumping → $OUT"
pg_dump --format=custom --no-owner --no-privileges --compress=6 \
  --dbname="$DATABASE_URL" --file="$OUT"

SIZE=$(du -h "$OUT" | awk '{print $1}')
echo "[backup] wrote $OUT ($SIZE)"

# Optional remote upload (rclone or aws s3)
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1 && [[ "$BACKUP_REMOTE" != s3://* ]]; then
    echo "[backup] uploading to $BACKUP_REMOTE via rclone"
    rclone copy "$OUT" "$BACKUP_REMOTE"
  elif command -v aws >/dev/null 2>&1; then
    echo "[backup] uploading to $BACKUP_REMOTE via aws s3"
    aws s3 cp "$OUT" "$BACKUP_REMOTE/$(basename "$OUT")"
  else
    echo "[backup] WARNING: BACKUP_REMOTE set but no rclone/aws CLI found"
  fi
fi

# Retention: keep last $RETAIN_DAYS days of local dumps
echo "[backup] pruning local backups older than $RETAIN_DAYS days"
find "$BACKUP_DIR" -name 'rpe-supply-*.dump' -mtime "+$RETAIN_DAYS" -delete

echo "[backup] done"
