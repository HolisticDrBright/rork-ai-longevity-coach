# HIPAA Readiness Checklist

_Code alone cannot make a product HIPAA-compliant. This checklist tracks the technical, contractual, operational, and administrative work that remains. Status reflects the repository as of 2026-07-15._

Legend: ✅ in place · 🟡 partial · ❌ missing

## Technical safeguards

| Item | Status | Notes |
|---|---|---|
| TLS in transit (app ↔ backend ↔ Supabase) | ✅ | HTTPS everywhere; HSTS header set in `backend/hono.ts` |
| Encryption at rest (database) | 🟡 | Supabase encrypts at rest; verify plan tier + document |
| Encryption at rest (device) | 🟡 | PIN-gated; `lib/secureStorage.ts` uses XOR obfuscation with a SecureStore key — replace with real AES (e.g. `expo-crypto`/MMKV encrypted) or stop storing PHI locally |
| Row-level security policies, versioned in repo | 🟡 | RLS exists only in the remote DB; new `clinical_*` tables ship policies in `expo/supabase/migrations/`; legacy tables must be exported into migrations |
| Server-side RBAC (role checked on the server, not the client) | 🟡 | Added for the reasoning router (`practitionerProcedure`); clinic router still trusts row scoping + RLS; practitioner role assignment is client-side self-serve — needs an approval workflow |
| Tenant isolation (org/clinic) | ❌ | Single-tenant assumptions throughout |
| Append-only server-side audit log of PHI access | 🟡 | `audit_events` table added (Phase 1) and written by the reasoning router; must expand to all PHI reads/writes incl. clinic routes and storage downloads |
| Session security | 🟡 | Supabase JWT + PIN relock after 5 min; add server-side session revocation checks and shorter token TTLs for practitioners |
| MFA for practitioners | ❌ | Supabase supports TOTP; not enabled |
| Secrets management | ❌ | LLM keys are `EXPO_PUBLIC_*` (in the client bundle). Move all AI calls server-side; rotate exposed keys; server secrets via Fly secrets |
| No PHI to third-party AI without approved provider/config | ❌ | Lab PDFs currently go device → OpenAI. Route via backend, gate by org-level provider approval flag, log every call in `ai_operations` |
| No PHI in logs/analytics/errors | 🟡 | Sentry scrubbing exists server-side; several `console.log` sites print record contents — sweep needed |
| Rate limiting | ❌ | None on Hono/tRPC; `nutrition.*` is public |
| Signed, expiring file URLs | 🟡 | `getDocumentDownloadUrl` uses signed URLs; verify expiry ≤15 min and audit downloads |
| Input sanitization for DB filters | ❌ | `ilike` filter interpolation in patient search |
| Backups & recovery | 🟡 | Supabase PITR depends on plan; document + test restore |
| Retention & deletion workflows | 🟡 | Client-side PHI purge exists; need server-side export + deletion (right-of-access analog) with audit trail |

## Contractual

| Item | Status |
|---|---|
| BAA with Supabase (HIPAA add-on tier) | ❌ verify/execute |
| BAA with Fly.io (or move backend into covered infra) | ❌ |
| BAA/approved-use agreement with AI providers (OpenAI/Rork or Anthropic enterprise) | ❌ |
| BAA with Sentry (or disable PHI-adjacent capture) | ❌ |
| BAA with Passio / Junction (Vital) for food images & wearable data | ❌ |
| Affiliate/marketing data flows reviewed (webhooks carry email + event data) | ❌ |

## Operational & administrative

| Item | Status |
|---|---|
| Designated privacy & security officers | ❌ |
| Risk analysis + risk management plan (§164.308) | ❌ |
| Workforce training + sanctions policy | ❌ |
| Incident response & breach notification procedure (the in-app breach banner is not a procedure) | ❌ |
| Contingency plan: backup, disaster recovery, emergency-mode operation | ❌ |
| Access-review cadence (practitioner↔patient relationships, consents) | ❌ |
| Minimum-necessary policies for practitioner data views | ❌ |
| Vendor/security review for every new integration | ❌ |
| Penetration test & remediation before production PHI | ❌ |
| Policies for de-identification if data is used for analytics/research | ❌ |

## Product-language obligations

- Do not label XOR obfuscation as "encryption" in UI copy until replaced.
- Reasoning scores must be labeled "support level / reasoning strength", never diagnostic probability.
- Emergency-adjacent outputs must show escalation guidance, not diagnosis.
