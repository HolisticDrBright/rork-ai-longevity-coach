# Visual Diagnostics MVP — Demo Walkthrough

> This doc walks through the end-to-end flow we built for the MVP. The
> goal: a TestFlight-ready demo where a patient captures a skin and/or
> tongue image, sees structured findings + a Visual Health Index, and
> Dr. Bright reviews and signs off from the practitioner queue.
>
> Branch: `claude/visual-diagnostics-mvp`

## What ships in MVP

- **Modalities enabled**: `skin` (front portrait) + `tongue` (extended).
- **Modalities deferred to Phase 2**: `tcm_face`, `nails`, `iris` —
  shown as "Coming in v1.1" in the patient UI, prompts not wired.
- **PDF/PNG renderer**: deferred to v1.1. Sidecars shipped instead —
  `findings.json`, `ai_summary.md`, `cross_modality.json`,
  `cross_modality_summary.md` written to Storage.
- **Pattern Discovery / Outcome Report**: deferred to Phase 2.
  Convergent findings *do* land in `detected_patterns` with
  `pattern_type='visual_convergent:{tag}'` and `source` carried in the
  metadata so the existing Clinical Analysis tab surfaces them immediately.

## Architecture (3-step recommendation pipeline)

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│ Analyzer LLM    │     │ Recommendation Service   │     │ Copy Generator  │
│ (Claude vision) │ ──▶ │ (deterministic SQL)      │ ──▶ │ (narrow LLM)    │
│ Emits TAGS only │     │ Filters + ranks products │     │ Paraphrases     │
│ — never product │     │ by tags / exclusions /   │     │ template + uses │
│   names         │     │ skin types / verification│     │ allowed_products│
└─────────────────┘     └──────────────────────────┘     └─────────────────┘
                                                                  │
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │ validateCopy...  │
                                                         │ rejects any out- │
                                                         │ of-list mentions │
                                                         └──────────────────┘
```

Key invariant: **the LLM never sees product names until step 3**, and step 3
can only mention products from a server-supplied allowed list. The
runtime validator (and its [negative test](../expo/__tests__/visual-diagnostics/no-brand-hallucination.test.ts))
is the gate that enforces it.

## Demo script

### Patient flow

1. Open the **Visual** tab (camera icon).
2. Tap "New assessment".
3. Toggle **"Mark as baseline"** if it's the patient's first session.
4. Tap **Facial skin** → take a portrait photo in even daylight.
5. The capture screen kicks off `analyzeVisualSession()`:
   - Image uploads to `visual-diagnostics` Storage (chunked on iOS to
     dodge the EMSGSIZE constraint).
   - `visual_session_images` row inserted.
   - `visual-analysis` edge function invoked per modality.
   - `visual-correlator` edge function invoked once all per-modality
     analyses complete.
   - Client polls `visual_sessions.status` until `review_pending`.
6. Patient lands on the session detail screen showing:
   - Visual Health Index ring (0-100).
   - Per-modality findings (cross_modality_tags, confidence).
   - Convergent findings across modalities.
   - Red flags requiring practitioner attention.
   - "Share report summary" button → native share sheet.

To demo cross-modality fusion, capture both skin AND tongue in
succession (currently sequential — repeat the new-session flow with
the second modality). Convergent findings (`≥2 modalities, combined
conf ≥0.7`) surface in their own section.

### Practitioner flow (clinician role)

1. Switch to a clinician account → **Clinic** tab.
2. Quick action **"Visual Review"** opens the review queue.
3. Each queue row shows the captured timestamp, VHI, and red-flag
   severity counts.
4. Tap a session to see the full detail screen with:
   - Per-modality findings + prompt/model version stamps (audit trail).
   - Convergent findings.
   - Red flags — each ackn-owledge-able; severity critical/high also
     land in `clinic_alert_events` and surface in the regular alert
     inbox.
   - Recommendation render audit ("Why this product?"): tags, db
     version, generated copy. Linked to the deterministic Recommendation
     Service output.
5. Type reviewer notes → **Sign off & complete**. The session status
   transitions to `signed_off`, visible to the patient.
6. **"Email this report"** → opens the system mail client with a
   pre-populated summary.

## Key safety guarantees (and where they live)

| Guarantee | Enforcement point |
|---|---|
| No brand hallucination | `validateCopyAgainstAllowedProducts` in `recommendation-copy-v1.ts` + `__tests__/visual-diagnostics/no-brand-hallucination.test.ts` (12 fixtures) |
| Scope-of-practice language | Static prompt audit: `__tests__/visual-diagnostics/scope-of-practice.test.ts` |
| Pregnancy/lactation gate | `recommendation-service.ts` filters `exclusion_flags ⊇ user.contraindications` BEFORE the copy generator sees products |
| Verification level gate | `recommendation-service.ts` only returns `verification_level ∈ {verified, official}`, never `pending` |
| Image no-retention | Anthropic Messages API called from the edge function with no caching; raw uploads land in private Storage with RLS `auth.uid() = user_id` |
| Audit trail | Every recommendation writes a `recommendation_renders` row with `finding_tags`, `exclusions`, `db_version_used`, `products_returned`, `copy_generated` |

## Known gaps (track for follow-up)

- White-balance reference card asset is a placeholder. We reference it in
  the capture-screen instructions; the printed card needs design.
- Practitioner RLS on `visual_sessions` is currently owner-only. Cross-user
  reads for the clinician role need the clinic-scope policy expansion
  before this can go beyond Dr. Bright's own test patient.
- Full product DB ingestion script (`scripts/ingest-product-db.ts`) is
  stubbed — the seed migration covers ~20 products for the demo. Full
  ingest from the v2 Excel is a separate pass.
- `getSignedAssetUrl` is wired but not yet consumed in the dashboard UI
  (images aren't rendered in the patient-facing session view yet — they
  appear in the practitioner audit only via storage_key for now).
- Native share-sheet uses `Share.share` (text only). The full "render a
  PDF/PNG and share it" flow lands with the v1.1 renderer.

## Test status

```
__tests__/visual-diagnostics/
  no-brand-hallucination.test.ts  ✓ 12 tests
  scope-of-practice.test.ts       ✓ 12 tests
```

Pre-existing clinic/biometrics + clinic/patients failures are unrelated
to this branch — they were red on `main` before any visual-diagnostics
work landed.

## Migration order (apply in this order)

1. `20260513000006_visual_diagnostics.sql` — schema + reference seeds.
2. `20260517000001_visual_diagnostics_product_seed.sql` — brands,
   products, categories, rules.

Both are re-runnable.
