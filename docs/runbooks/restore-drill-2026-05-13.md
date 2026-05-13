# Restore Drill — 2026-05-13

## Operator
agent (hardening phase E)

## Source dump
`/tmp/rpe-backups/rpe-supply-20260513-153445.dump` (214 KB; pg_dump custom, compression 6)

Captured from `postgresql://rpe_user:rpe_pass@localhost:5432/rpe_supply` (Postgres 16.13 / Homebrew) at 15:34:45Z.

## Target
Fresh database `rpe_drill` on the same Postgres instance.

```
psql -U rpe_user -d postgres -h localhost -c "DROP DATABASE IF EXISTS rpe_drill;" -c "CREATE DATABASE rpe_drill;"
RESTORE_FORCE=true DATABASE_URL='postgresql://rpe_user:rpe_pass@localhost:5432/rpe_drill' \
  bash backend/scripts/restore.sh /tmp/rpe-backups/rpe-supply-20260513-153445.dump
```

## Outcome
- `[restore] done` — exit 0
- Row counts in restored DB matched source:
  - `Product` = 7
  - `User` = 6
  - `PurchaseOrder` = 16

## Wall-clock
Backup + restore round trip < 5 seconds on dev-sized data (~200 KB dump).

## Result
PASS. The dump is restorable end-to-end without manual intervention beyond
creating an empty target DB.

## Cleanup
```
psql -U rpe_user -d postgres -h localhost -c "DROP DATABASE rpe_drill;"
```

## Next drill due
2026-08-13 (quarterly cadence).
