# Production Launch Checklist

**AI Longevity Pro**
**Last Updated: March 27, 2026**

---

## Pre-Launch (Environment & Infrastructure)

- [ ] All environment variables set in production (see list below)
- [ ] All secrets stored securely (Fly.io secrets, EAS secrets -- never in code)
- [ ] Database migrations run against production Supabase instance
- [ ] Seed data loaded (default biomarker reference ranges, supplement catalog, assessment templates)
- [ ] SSL/TLS configured for custom API domain
- [ ] DNS records configured (API domain, any custom domains)
- [ ] Supabase project upgraded to Pro plan (for PITR and daily backups)
- [ ] Supabase connection pooling enabled (PgBouncer)
- [ ] Fly.io app scaled to minimum 2 instances for availability

### Required Environment Variables

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET
SENTRY_DSN
PASSIO_API_KEY
WEBHOOK_SIGNING_SECRET
API_BASE_URL
```

---

## iOS Submission

- [ ] Bundle identifier confirmed: `app.rork.ai-longevity-pro`
- [ ] Build number incremented
- [ ] App icon (1024x1024, no alpha channel)
- [ ] Distribution certificate and provisioning profile configured
- [ ] App Store Connect app record created
- [ ] Screenshots uploaded (6.7" iPhone, 6.5" iPhone, 5.5" iPhone, iPad if applicable)
- [ ] App description, keywords, and subtitle written
- [ ] Support URL provided
- [ ] Privacy Policy URL provided (link to hosted version of PRIVACY_POLICY.md)
- [ ] App Privacy labels completed in App Store Connect:
  - [ ] Health & Fitness data -- linked to user
  - [ ] Contact Info (email) -- linked to user
  - [ ] Diagnostics (crash data) -- not linked to user
  - [ ] Usage Data -- not linked to user
- [ ] HealthKit usage descriptions in Info.plist (already in app.json)
- [ ] Test account credentials provided for App Review
- [ ] App Review notes written (explain health features, practitioner module, HealthKit usage)
- [ ] In-app purchases / subscriptions configured (if applicable)
- [ ] Production EAS build created: `eas build --platform ios --profile production`
- [ ] Binary submitted to App Store Connect: `eas submit --platform ios`

---

## Android Submission

- [ ] Package name confirmed: `app.rork.ai_longevity_pro`
- [ ] Version code incremented
- [ ] App icon (512x512, adaptive icon configured)
- [ ] Signing keystore created and backed up securely (NEVER commit to repo)
- [ ] Google Play Console app record created
- [ ] Feature graphic (1024x500)
- [ ] Screenshots uploaded (phone, 7" tablet, 10" tablet if applicable)
- [ ] Store listing (title, short description, full description)
- [ ] Content rating questionnaire completed (health category)
- [ ] Data Safety form completed:
  - [ ] Personal info (name, email) -- collected, not shared
  - [ ] Health info (health data, fitness data) -- collected, not shared
  - [ ] Data encrypted in transit and at rest
  - [ ] Users can request data deletion
- [ ] Privacy Policy URL provided
- [ ] Test account credentials provided for review
- [ ] Target API level meets current Google Play requirements
- [ ] Production EAS build created: `eas build --platform android --profile production`
- [ ] AAB uploaded to Google Play Console: `eas submit --platform android`
- [ ] Internal testing track validated before promoting to production

---

## Backend Deployment (Fly.io)

- [ ] All secrets set via `fly secrets set`
- [ ] `fly.toml` configured with production settings:
  - [ ] Health check endpoint (`/health`)
  - [ ] Auto-stop disabled for production
  - [ ] Memory and CPU appropriately sized
  - [ ] Regions selected (primary + failover)
- [ ] Deploy: `fly deploy -a ai-longevity-pro`
- [ ] Health check passing: `curl https://api.ailongevitypro.com/health`
- [ ] Monitoring configured:
  - [ ] Fly.io metrics dashboard reviewed
  - [ ] Sentry project configured with PHI scrubbing rules
  - [ ] Sentry alerts set for error rate spikes
  - [ ] Uptime monitoring configured (e.g., BetterStack, Fly.io checks)
- [ ] Alert thresholds configured:
  - [ ] Error rate > 5% in 5 minutes
  - [ ] Response time p95 > 2 seconds
  - [ ] CPU > 80% sustained for 10 minutes
  - [ ] Memory > 85%
  - [ ] Database connection pool > 80% utilized

---

## Security Audit

- [ ] **Row-Level Security (RLS)**:
  - [ ] RLS enabled on ALL tables containing user data
  - [ ] Policies verified: users can only read/write their own data
  - [ ] Practitioner policies verified: practitioners see only their linked patients
  - [ ] Admin policies verified: admin access is scoped and logged
  - [ ] Test RLS with multiple user accounts to confirm isolation
- [ ] **CORS**:
  - [ ] CORS configured to allow only the app's domains (not wildcard `*`)
- [ ] **Rate Limiting**:
  - [ ] API rate limiting enabled (per-user and global)
  - [ ] Auth endpoints have stricter rate limits (prevent brute force)
- [ ] **Audit Logging**:
  - [ ] Audit log triggers active on all sensitive tables
  - [ ] Audit logs are insert-only (no update/delete)
  - [ ] Verified audit log entries are generated for CRUD operations
- [ ] **Authentication**:
  - [ ] JWT expiration configured (short-lived access tokens)
  - [ ] Refresh token rotation enabled
  - [ ] Password policy meets minimum requirements (8+ chars, complexity)
- [ ] **Data Encryption**:
  - [ ] Data encrypted at rest in Supabase (AES-256)
  - [ ] Data encrypted in transit (TLS 1.2+)
  - [ ] On-device encryption verified (AES-GCM via SecureStore keys)
- [ ] **Sentry PHI Scrubbing**:
  - [ ] `beforeSend` hook strips PII/PHI fields
  - [ ] Verified no health data appears in Sentry events (test with sample data)
- [ ] **Webhook Security**:
  - [ ] All webhook payloads signed with HMAC-SHA256
  - [ ] Webhook endpoints validate signatures before processing
- [ ] **Dependency Audit**:
  - [ ] `npm audit` shows no high/critical vulnerabilities
  - [ ] All dependencies up to date (or known exceptions documented)

---

## Post-Launch

- [ ] **Monitoring (first 48 hours)**:
  - [ ] Watch error rates in Sentry -- respond to any new crash patterns
  - [ ] Watch API response times and database query performance
  - [ ] Monitor Supabase connection pool usage
  - [ ] Monitor Fly.io resource utilization
- [ ] **Crash Reports**:
  - [ ] Sentry alerts routing to on-call channel
  - [ ] Triage and fix any P1/P2 crashes within 24 hours
- [ ] **OTA Updates**:
  - [ ] Verify EAS Update is configured for the production branch
  - [ ] Test OTA update delivery to a production device
  - [ ] Confirm rollback procedure works (see INCIDENT_RUNBOOK.md)
- [ ] **User Feedback**:
  - [ ] In-app feedback mechanism active
  - [ ] App Store / Play Store review monitoring set up
  - [ ] Support email monitored (privacy@ailongevitypro.com)
- [ ] **Backup Verification**:
  - [ ] Confirm Supabase daily backups are running
  - [ ] Confirm PITR is enabled
  - [ ] Schedule first manual backup test (within 1 week of launch)
- [ ] **Documentation**:
  - [ ] Incident runbook reviewed by on-call team (INCIDENT_RUNBOOK.md)
  - [ ] Backup/restore procedures reviewed (BACKUP_RESTORE.md)
  - [ ] Key rotation procedures tested at least once pre-launch
