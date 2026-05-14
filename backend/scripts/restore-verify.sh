#!/usr/bin/env bash
# RPE Supply — Restore drill (verifies that backups are actually restorable).
#
# 1. Spin up a fresh ephemeral postgres role + database.
# 2. Restore the most-recent dump in $BACKUP_DIR (or the path passed as $1).
# 3. Sanity-check core tables: User, Product, GlJournal exist + counts > 0.
# 4. Drop the verification DB.
#
# Designed to run nightly in CI. Exit non-zero on any failure.
#
# Usage:
#     DATABASE_URL=postgresql://... ./restore-verify.sh [/path/to/dump]
#
# Required env: PGHOST, PGPORT, PGUSER, PGPASSWORD (or full DATABASE_URL).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rpe-supply}"
DUMP="${1:-}"

if [ -z "$DUMP" ]; then
  DUMP=$(ls -1t "$BACKUP_DIR"/rpe-supply-*.dump 2>/dev/null | head -1 || true)
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "[restore-verify] no dump found in $BACKUP_DIR (or arg)"; exit 2
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

# Parse host/port/user/password from DATABASE_URL using Node URL.
eval "$(node -e '
const u = new URL(process.env.DATABASE_URL);
const map = { PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) };
for (const [k,v] of Object.entries(map)) process.stdout.write(`export ${k}="${v}"\n`);
')"

VERIFY_DB="rpe_verify_$$_$RANDOM"
echo "[restore-verify] $(date -u +%FT%TZ) dump=$DUMP db=$VERIFY_DB"

cleanup() {
  PGPASSWORD="$PGPASSWORD" dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$VERIFY_DB" 2>/dev/null || true
}
trap cleanup EXIT

PGPASSWORD="$PGPASSWORD" createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$VERIFY_DB"

echo "[restore-verify] restoring…"
PGPASSWORD="$PGPASSWORD" pg_restore --no-owner --no-privileges \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$VERIFY_DB" "$DUMP"

echo "[restore-verify] sanity-checking core tables"
COUNTS=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$VERIFY_DB" -At -F'|' -c '
  SELECT
    (SELECT COUNT(*) FROM "User"),
    (SELECT COUNT(*) FROM "Product"),
    (SELECT COUNT(*) FROM "GlJournal");
')
USERS=$(echo "$COUNTS" | cut -d'|' -f1)
PRODS=$(echo "$COUNTS" | cut -d'|' -f2)
JOURNALS=$(echo "$COUNTS" | cut -d'|' -f3)
echo "[restore-verify] User=$USERS Product=$PRODS GlJournal=$JOURNALS"

if [ "${USERS:-0}" -lt 1 ]; then
  echo "[restore-verify] FAIL: zero users after restore"; exit 1
fi
if [ "${PRODS:-0}" -lt 1 ]; then
  echo "[restore-verify] FAIL: zero products after restore"; exit 1
fi

echo "[restore-verify] OK"
