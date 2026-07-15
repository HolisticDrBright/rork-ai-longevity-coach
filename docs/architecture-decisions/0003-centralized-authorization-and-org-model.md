# 3. Centralized authorization and organization-first tenancy

Date: 2026-07-15
Status: Proposed

## Context

Authorization today is implemented **per tRPC handler and inconsistently**.
All `clinic` procedures are `protectedProcedure` (authenticated), but ownership
enforcement varies: some procedures filter by `clinician_id = ctx.user.id`
(`patients.getTags`, `patients.exportRecord`, parts of `labs`/`alerts`) while
others rely on RLS alone (`patients.getById/update/delete/getHealthHistory/
getTimeline`). If RLS on `clinic_*` is missing or loose (currently unverifiable
— see ADR-0002), the latter allow cross-clinician PHI access by row id.

There is no tenant boundary above the individual clinician: no
`organizations`, `organization_memberships`, `roles`, or
`practitioner_patient_relationships`. The mobile domain and the clinic domain
use disjoint tables and different notions of "who can see what". The target
platform is explicitly **organization-first** and requires a **single
centralized authorization layer** used by every procedure, with identity always
derived from the authenticated server context and `organization_id` / ownership
never accepted from the client.

## Decision

1. Introduce a shared protected-procedure family in the tRPC layer:
   `authenticatedProcedure`, `organizationProcedure`, `practitionerProcedure`,
   `patientAccessProcedure`, `adminProcedure`. Each resolves the caller's
   memberships/roles server-side and attaches a validated authorization context;
   ownership checks live here, **not** in individual handlers.
2. Introduce the organization-first tables (`organizations`,
   `organization_memberships`, `roles`, `practitioner_patient_relationships`,
   `invitations`) and add `organization_id` to tenant/patient tables.
3. Migrate existing `clinic_*` rows under a default organization derived from
   `clinician_id`, preserving current access, then convert the `clinic` router
   to the new procedures **without behavior change** as the first step.
4. Enforce the same boundaries in the database via RLS (defense in depth), and
   add cross-tenant access-denied tests against a real ephemeral Postgres.

## Consequences

- Uniform, reviewable authorization; the "forgot the ownership filter" class of
  bug becomes impossible because the check is centralized.
- The desktop app and mobile app share one authorization model and one backend.
- Migration effort: backfilling `organization_id`, writing RLS, and a data
  migration for existing clinic rows. Must be feature-flagged and tested before
  cutover.
- UI (mobile or desktop) authorization is treated as convenience only; the
  server + RLS are the enforcement points, per the prompt ("do not rely only on
  UI checks").
- Depends on ADR-0002 (need the real schema before adding columns/policies).
