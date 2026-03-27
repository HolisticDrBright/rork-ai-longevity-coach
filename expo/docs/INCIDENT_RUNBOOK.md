# Incident Response Runbook

**AI Longevity Pro**
**Last Updated: March 27, 2026**

---

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **P1 - Critical** | Service fully down or data breach | 15 minutes | API outage, database unreachable, confirmed data breach, auth system down |
| **P2 - High** | Major feature broken, data integrity risk | 1 hour | Lab result processing failing, practitioner portal inaccessible, webhook delivery failing globally |
| **P3 - Medium** | Degraded experience, workaround exists | 4 hours | Slow API responses, food recognition errors, intermittent sync failures |
| **P4 - Low** | Minor issue, cosmetic, or non-urgent | 24 hours | UI glitch, non-critical logging error, single user edge case |

---

## Escalation Contacts

| Role | Contact | When |
|------|---------|------|
| On-call engineer | PagerDuty rotation | All incidents |
| Engineering lead | Slack #incidents + phone | P1, P2 |
| CTO | Phone call | P1 |
| Legal / compliance | Email + phone | Data breach (P1) |
| Communications / PR | Email | Data breach requiring user notification |

---

## Response Procedures

### API Outage (P1)

1. **Confirm** the outage: `curl -s https://api.ailongevitypro.com/health` and check Fly.io dashboard
2. **Check Fly.io status**: `fly status -a ai-longevity-pro`
3. **Review logs**: `fly logs -a ai-longevity-pro --since 30m`
4. **Check if deployment-related**: `fly releases -a ai-longevity-pro` -- if recent deploy, initiate rollback (see Rollback section)
5. **Check Supabase connectivity**: Verify Supabase dashboard status and connection pool metrics
6. **Scale up if needed**: `fly scale count 3 -a ai-longevity-pro`
7. **If unresolved in 30 minutes**: escalate to engineering lead

### Database Issues (P1/P2)

1. **Check Supabase dashboard** for connection pool saturation, replication lag, or storage limits
2. **Verify RLS policies** are not causing query timeouts: check `pg_stat_activity` for long-running queries
3. **Check connection limits**: Review active connections via Supabase SQL editor
   ```sql
   SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
   ```
4. **If connection pool exhausted**: restart the backend to release stale connections, then investigate the leak
5. **If data corruption suspected**: stop writes immediately, assess scope, initiate point-in-time recovery (see BACKUP_RESTORE.md)

### Authentication Failures (P1/P2)

1. **Check Supabase Auth status** on the dashboard
2. **Verify JWT secret** has not been rotated unexpectedly
3. **Check token expiration config**: ensure refresh tokens are working
4. **Review Supabase Auth logs** for error patterns
5. **If Supabase Auth is down**: enable maintenance mode in the App, communicate to users
6. **If keys compromised**: rotate immediately (see Key Rotation section)

### Data Breach (P1)

1. **Immediately** contain the breach: revoke compromised credentials, disable affected endpoints
2. **Preserve evidence**: do NOT delete logs. Snapshot current state.
3. **Assess scope**: determine what data was accessed, how many users affected, and attack vector
4. **Notify legal/compliance** within 1 hour
5. **Rotate all potentially compromised keys** (see Key Rotation section)
6. **Review audit logs**: query the `audit_logs` table for unauthorized access patterns
   ```sql
   SELECT * FROM audit_logs
   WHERE created_at > now() - interval '24 hours'
   ORDER BY created_at DESC;
   ```
7. **User notification**: if PHI was exposed, notify affected users within 72 hours (per HIPAA/GDPR requirements). Use the communication template below.
8. **File regulatory reports** as required (HHS breach portal for HIPAA, DPA for GDPR)

### Deployment Failures (P2/P3)

1. **Check EAS build logs**: `eas build:list`
2. **Check Fly.io deploy logs**: `fly releases -a ai-longevity-pro`
3. **If backend deploy failed**: Fly.io will auto-rollback if health check fails. Verify with `fly status`.
4. **If OTA update caused issues**: rollback via EAS (see Rollback section)
5. **If DB migration failed**: check migration status, do NOT re-run without reviewing state. Restore from backup if needed.

---

## Rollback Procedures

### Fly.io Backend Rollback

```bash
# List recent releases
fly releases -a ai-longevity-pro

# Rollback to a specific release version
fly deploy -a ai-longevity-pro --image <previous-image-ref>

# Verify health after rollback
curl -s https://api.ailongevitypro.com/health
```

If the release included a database migration, assess whether the migration needs to be reverted manually. Forward-compatible migrations are preferred to avoid this scenario.

### EAS OTA Rollback

```bash
# List recent updates
eas update:list --branch production

# Roll back by publishing the previous update as the latest
eas update --branch production --message "Rollback to previous version"

# For severe issues, disable OTA updates and force users to the last stable native build
eas update:rollback --branch production
```

---

## Key Rotation Procedures

### Supabase Keys (anon key, service_role key)

1. Generate new keys in the Supabase dashboard under Settings > API
2. Update secrets in Fly.io: `fly secrets set SUPABASE_ANON_KEY=<new> SUPABASE_SERVICE_ROLE_KEY=<new> -a ai-longevity-pro`
3. Update secrets in EAS: `eas secret:create --name SUPABASE_ANON_KEY --value <new>`
4. Deploy backend and publish OTA update
5. Verify authentication and data access still work
6. Old keys are invalidated automatically by Supabase upon regeneration

### Sentry DSN

1. Create a new DSN in Sentry project settings > Client Keys
2. Update in app config and backend environment
3. Deploy updates
4. Revoke the old DSN in Sentry
5. Verify error reporting is working with a test event

### Webhook Signing Secrets

1. Generate a new secret: `openssl rand -hex 32`
2. Update the secret in the backend environment: `fly secrets set WEBHOOK_SIGNING_SECRET=<new> -a ai-longevity-pro`
3. Notify webhook consumers to update their verification key
4. Deploy backend
5. Verify webhook delivery and signature validation

### Supabase JWT Secret

1. Rotate in Supabase dashboard under Settings > API > JWT Secret
2. **Warning**: this will invalidate ALL existing user sessions
3. Update the JWT secret in Fly.io: `fly secrets set SUPABASE_JWT_SECRET=<new> -a ai-longevity-pro`
4. Deploy backend
5. Users will need to re-authenticate

---

## Communication Templates

### User-Facing Outage Notice (In-App / Status Page)

```
AI Longevity Pro is currently experiencing a service disruption.
Our team is actively working to resolve the issue. Your data is safe.
We expect to restore full service by [ETA]. We apologize for the inconvenience.
```

### Data Breach User Notification (Email)

```
Subject: Important Security Notice from AI Longevity Pro

Dear [User],

We are writing to inform you of a security incident that may have affected
your data. On [date], we identified unauthorized access to [description].

What happened: [brief description]
What data was affected: [types of data]
What we have done: [remediation steps taken]
What you should do: [recommended user actions, e.g., change password]

We take the security of your health data extremely seriously. We have
[steps taken to prevent recurrence].

If you have questions, contact us at privacy@ailongevitypro.com.

Sincerely,
AI Longevity Pro Security Team
```

### Internal Incident Alert (Slack #incidents)

```
:rotating_light: INCIDENT [P-level] - [Title]
Detected: [time]
Impact: [what's broken, how many users affected]
Lead: [on-call engineer name]
Status: Investigating / Mitigating / Resolved
Thread for updates below.
```

---

## Post-Incident Review

Every P1 and P2 incident requires a post-incident review within 3 business days.

### Review Document Template

1. **Incident summary**: What happened, when, and for how long
2. **Timeline**: Chronological record of detection, response actions, and resolution
3. **Root cause**: What caused the incident (use 5-Whys analysis)
4. **Impact**: Users affected, data affected, financial impact, SLA impact
5. **What went well**: Things that helped resolve the incident faster
6. **What went poorly**: Gaps in process, tooling, or communication
7. **Action items**: Concrete tasks with owners and due dates to prevent recurrence
8. **Detection improvement**: How can we detect this faster next time?

### Review Process

- Engineering lead schedules the review meeting
- All responders attend; blame-free discussion
- Action items are tracked in the project issue tracker
- Review document is stored in `/docs/incidents/YYYY-MM-DD-title.md`
- P1 incidents are reviewed with the CTO
