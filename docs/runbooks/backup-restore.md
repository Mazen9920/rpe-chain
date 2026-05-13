# Runbook — Backup & Restore (RPE Supply)

Owner: Platform / DBA on-call
Target RPO: 24 h · Target RTO: 1 h (initial baseline)

## Backups

### What
Nightly `pg_dump --format=custom` of the production database.

### Schedule
Cron (host): `0 2 * * * /opt/rpe/backend/scripts/backup.sh >> /var/log/rpe-backup.log 2>&1`

### Storage
- Local: `/var/backups/rpe-supply/rpe-supply-YYYYMMDD-HHMMSS.dump`
- Remote (recommended): set `BACKUP_REMOTE=s3://rpe-backups/prod` to push to S3.

### Retention
14 daily local dumps. Object-storage lifecycle policy keeps 90 days hot + 1 year cold.

### Verification
1. The cron output should end with `[backup] done` and a printed file size.
2. Every Monday, run `pg_restore --list dumpfile` to confirm the dump is parseable.

## Restore

### Full database restore
```
DATABASE_URL=postgresql://... ./backend/scripts/restore.sh /path/to/rpe-supply-YYYYMMDD-HHMMSS.dump
```
The script will prompt for confirmation. Use `RESTORE_FORCE=true` to skip in automation.

### Point-in-time
Not currently supported (no WAL archiving). Add WAL-G/WAL-E in a future hardening pass if RPO requirement tightens below 24 h.

## Drill cadence
Quarterly restore drill against a throwaway database; log the outcome under
`docs/runbooks/restore-drill-YYYY-MM-DD.md`.

## Common failure modes
| Symptom | Cause | Fix |
|---|---|---|
| `error: role "rpe_user" does not exist` | restoring across instances | dump uses `--no-owner --no-privileges`; if still seen, create role first |
| `relation already exists` | target has existing schema | always restore into an empty DB or rely on `--clean --if-exists` |
| Empty dump (~few KB) | dumped while DB was empty | check source DB had data; re-run `backup.sh` |
