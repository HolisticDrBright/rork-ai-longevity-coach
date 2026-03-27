# Backup and Restore Procedures

**AI Longevity Pro**
**Last Updated: March 27, 2026**

---

## Overview

This document covers backup strategies, restore procedures, and data recovery for all AI Longevity Pro systems. The primary data store is Supabase (PostgreSQL). Device-side data is treated as a cache and can be re-synced from the server.

---

## 1. Supabase Automatic Backups

Supabase provides automatic backups depending on the plan:

| Feature | Pro Plan | Enterprise |
|---------|----------|------------|
| Daily backups | Yes (7-day retention) | Yes (configurable retention) |
| Point-in-time recovery (PITR) | Yes (7-day window) | Yes (up to 30-day window) |
| Backup frequency | Daily + WAL archiving | Continuous WAL archiving |

### Point-in-Time Recovery (PITR)

PITR allows restoring the database to any second within the retention window. Use this for:
- Accidental data deletion
- Data corruption from a bad migration
- Restoring to a known-good state after a security incident

**To initiate PITR:**
1. Go to Supabase Dashboard > Project > Database > Backups
2. Select "Point in Time Recovery"
3. Choose the target timestamp (use audit logs to determine the correct time)
4. Confirm restoration -- this will replace the current database state

**Important**: PITR restores the entire database. You cannot selectively restore individual tables. Plan accordingly.

---

## 2. Manual Backup Procedures

### Full Database Dump (pg_dump)

Use `pg_dump` for portable backups that can be restored to any PostgreSQL instance.

```bash
# Set connection string (from Supabase Dashboard > Settings > Database)
export DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

# Full backup (compressed, custom format)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="backup_$(date +%Y%m%d_%H%M%S).dump"

# Schema-only backup (for migration reference)
pg_dump "$DATABASE_URL" \
  --schema-only \
  --file="schema_$(date +%Y%m%d_%H%M%S).sql"
```

### Table-Specific Backups

For targeted backups of critical tables:

```bash
# Backup specific tables
pg_dump "$DATABASE_URL" \
  --format=custom \
  --table=profiles \
  --table=lab_results \
  --table=biomarkers \
  --table=nutrition_logs \
  --table=assessments \
  --file="health_data_$(date +%Y%m%d_%H%M%S).dump"
```

### Backup Schedule Recommendation

| Backup Type | Frequency | Retention | Storage |
|-------------|-----------|-----------|---------|
| Supabase automatic (daily) | Daily | 7 days | Supabase-managed |
| PITR WAL archives | Continuous | 7-30 days | Supabase-managed |
| Manual pg_dump (full) | Weekly | 90 days | Encrypted S3 bucket |
| Manual pg_dump (pre-migration) | Before each migration | 1 year | Encrypted S3 bucket |
| Audit log export | Monthly | 6 years | Encrypted cold storage (S3 Glacier) |

### Automated Manual Backups

Set up a cron job or CI/CD scheduled task:

```bash
#!/bin/bash
# backup.sh - Run weekly via CI or cron
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.dump"
S3_BUCKET="s3://ailongevitypro-backups/weekly/"

pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

# Encrypt before upload
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /run/secrets/backup_key "$BACKUP_FILE"

# Upload to S3
aws s3 cp "${BACKUP_FILE}.gpg" "$S3_BUCKET"

# Clean up local files
rm -f "$BACKUP_FILE" "${BACKUP_FILE}.gpg"

echo "Backup completed: ${BACKUP_FILE}.gpg uploaded to ${S3_BUCKET}"
```

---

## 3. Restore Procedures

### Restore from Supabase Automatic Backup

1. Navigate to Supabase Dashboard > Database > Backups
2. Select the daily backup or PITR timestamp
3. Click "Restore" and confirm
4. Wait for restoration to complete (monitor via dashboard)
5. Verify data integrity (see Testing section below)

### Restore from pg_dump

```bash
# Decrypt backup if encrypted
gpg --decrypt --batch --passphrase-file /run/secrets/backup_key backup_20260327.dump.gpg > backup_20260327.dump

# Restore to target database
pg_restore \
  --dbname="$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  backup_20260327.dump
```

### Partial Restore (Single Table)

```bash
# List contents of a backup to find the table
pg_restore --list backup_20260327.dump | grep "TABLE DATA"

# Restore only a specific table
pg_restore \
  --dbname="$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --data-only \
  --table=lab_results \
  backup_20260327.dump
```

### Post-Restore Checklist

- [ ] Verify row counts for critical tables match expectations
- [ ] Test user authentication (login flow)
- [ ] Test RLS policies (user can only see own data)
- [ ] Verify practitioner-patient relationships are intact
- [ ] Check that audit logs are present and sequential
- [ ] Run the backend health check endpoint
- [ ] Verify webhook delivery is functioning

---

## 4. Audit Log Backup Strategy

Audit logs require special handling due to regulatory retention requirements.

### Requirements
- **Immutable**: audit logs must not be modified or deleted
- **Retention**: 6-year minimum (HIPAA requirement)
- **Integrity**: tamper-evident (hash chaining or similar)

### Strategy

1. **Database**: audit logs are stored in the `audit_logs` table with RLS policies preventing updates and deletes (insert-only)
2. **Monthly export**: export audit logs to encrypted cold storage

```bash
# Export audit logs for a given month
psql "$DATABASE_URL" -c "\copy (
  SELECT * FROM audit_logs
  WHERE created_at >= '2026-03-01'
  AND created_at < '2026-04-01'
) TO STDOUT WITH CSV HEADER" | \
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /run/secrets/backup_key \
  > audit_logs_2026_03.csv.gpg

# Upload to cold storage
aws s3 cp audit_logs_2026_03.csv.gpg s3://ailongevitypro-audit-archive/ \
  --storage-class GLACIER
```

3. **Verification**: store a SHA-256 hash of each monthly export in a separate manifest file for tamper detection
4. **Retention lifecycle**: S3 lifecycle rule set to retain audit archives for 6 years, then auto-delete

---

## 5. Device Data Recovery

Data stored on-device (AsyncStorage + SecureStore) is a local cache of server-side data.

### User Recovery Flow

1. User reinstalls app or logs in on a new device
2. Upon authentication, the app syncs all user data from Supabase
3. Encryption keys are generated fresh per device and stored in SecureStore
4. Local data is re-encrypted with the new device keys
5. No user action needed beyond logging in

### What Cannot Be Recovered from Device

- Locally-drafted entries that were never synced (e.g., offline edits not yet uploaded)
- Device-specific preferences not synced to the server

To minimize data loss, the app implements:
- Automatic background sync when connectivity is available
- Sync status indicators so users know when data is pending upload
- Offline queue that persists pending writes across app restarts

---

## 6. Testing Restore Procedures

Restore procedures must be tested quarterly to ensure they work.

### Quarterly Restore Test Process

1. **Provision a test database** (use a separate Supabase project or local PostgreSQL)
2. **Restore the latest weekly backup** to the test database
3. **Run verification queries**:
   ```sql
   -- Check row counts
   SELECT 'profiles' AS table_name, count(*) FROM profiles
   UNION ALL SELECT 'lab_results', count(*) FROM lab_results
   UNION ALL SELECT 'biomarkers', count(*) FROM biomarkers
   UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;

   -- Check most recent records exist
   SELECT max(created_at) FROM profiles;
   SELECT max(created_at) FROM lab_results;
   ```
4. **Test application connectivity**: point a staging backend at the restored database and run smoke tests
5. **Document results**: record the test date, backup used, restore duration, and any issues in `/docs/backup-tests/YYYY-MM-DD.md`
6. **Tear down** the test database after verification

### Recovery Time Objectives

| Scenario | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) |
|----------|------|------|
| Full database restore (PITR) | < 1 hour | < 1 minute (PITR) |
| Full database restore (daily backup) | < 2 hours | < 24 hours |
| Full database restore (weekly pg_dump) | < 4 hours | < 7 days |
| Single table restore | < 1 hour | Depends on backup source |
| Device data re-sync | < 5 minutes | Last successful sync |
