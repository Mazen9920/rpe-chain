#!/usr/bin/env bash
# RPE Supply DB restore — DESTRUCTIVE.
#
# Usage:
#     DATABASE_URL=postgresql://... ./restore.sh path/to/rpe-supply-YYYYMMDD.dump
#
# Will drop & recreate every object in the target database.
# Requires confirmation unless RESTORE_FORCE=true.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
DUMP="${1:?usage: restore.sh <path-to-.dump>}"

if [ ! -f "$DUMP" ]; then
  echo "[restore] dump file not found: $DUMP" >&2
  exit 1
fi

echo "============================================================"
echo " DESTRUCTIVE RESTORE"
echo "   target  : $DATABASE_URL"
echo "   source  : $DUMP"
echo "============================================================"

if [ "${RESTORE_FORCE:-false}" != "true" ]; then
  read -r -p "Type 'YES' to continue: " ANSWER
  if [ "$ANSWER" != "YES" ]; then
    echo "[restore] aborted"
    exit 1
  fi
fi

echo "[restore] running pg_restore..."
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DATABASE_URL" "$DUMP"

echo "[restore] done"
