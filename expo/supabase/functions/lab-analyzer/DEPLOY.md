# Lab Analyzer — Deployment Checklist

This function runs the async lab-PDF pipeline: Supabase Storage → AWS S3 → AWS Textract → OpenAI enrichment → safety-gate filtering → `lab_markers` + `lab_analysis_jobs` writeback.

## 1. Database prerequisites

These migrations must be applied to the project:

- `20260513000000_add_supplement_contraindication_rules.sql` — rules + audit + shared indexes
- `20260513000001_add_lab_analysis_jobs.sql` — `lab_analysis_jobs` table + `lab-pdfs` storage bucket + RLS

Apply via the Supabase SQL editor or `supabase db push`.

## 2. AWS setup (one-time)

### 2a. BAA

If you are processing real patient labs, **sign the AWS Business Associate Addendum** in AWS Artifact before doing anything else. Textract sees PHI. Required for HIPAA compliance.

### 2b. S3 staging bucket

Create or reuse a private S3 bucket in the same region as your Textract calls. This is **staging only** — the function uploads each PDF, runs Textract against it, then deletes the object in a `finally` block. Recommended name: `ai-longevity-pro` (or whatever you set `AWS_S3_BUCKET` to).

```bash
aws s3api create-bucket \
  --bucket ai-longevity-pro \
  --region us-east-1
aws s3api put-public-access-block \
  --bucket ai-longevity-pro \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Optional but recommended: add a 1-day lifecycle rule under `lab-analyzer-staging/` so any object the function fails to clean up disappears automatically.

### 2c. IAM user for the edge function

Create a programmatic IAM user with this minimal policy (replace bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TextractAccess",
      "Effect": "Allow",
      "Action": [
        "textract:StartDocumentAnalysis",
        "textract:GetDocumentAnalysis",
        "textract:AnalyzeDocument"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3StagingBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::ai-longevity-pro/lab-analyzer-staging/*"
    }
  ]
}
```

Save the access key + secret — you'll paste them into Supabase secrets next.

## 3. Supabase edge function secrets

In Supabase Dashboard → Project Settings → Edge Functions → Secrets, set:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI key (required) |
| `OPENAI_MODEL` | Optional, defaults to `gpt-4o-mini` |
| `AWS_REGION` | e.g. `us-east-1` |
| `AWS_ACCESS_KEY_ID` | From the IAM user above |
| `AWS_SECRET_ACCESS_KEY` | From the IAM user above |
| `AWS_S3_BUCKET` | Staging bucket name (`ai-longevity-pro`) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase runtime — you don't set those manually.

## 4. Deploy the function

```bash
supabase functions deploy lab-analyzer
```

## 5. Verify

### 5a. Smoke test

From the app, upload any lab PDF as a logged-in user. The client (`lib/labAnalyzerClient.ts`) will:

1. PUT the file to `lab-pdfs/<user_id>/<timestamp>_<name>` in Storage
2. Insert a `lab_analysis_jobs` row with `status='pending'`
3. Invoke the function with `{ job_id }`
4. Poll the row until `status='complete'` or `status='failed'`

You should see the status progress through `pending → extracting → enriching → complete` within ~30-90 seconds for a typical 1-3 page lab.

### 5b. Check the audit data

After a successful run:

```sql
select id, status, completed_at - created_at as duration,
  jsonb_array_length(biomarkers_json) as marker_count,
  textract_raw_json->'safety_gates'->'blocked' as blocked_supplements
from public.lab_analysis_jobs
order by created_at desc
limit 5;
```

Confirm:
- `lab_markers` has one row per biomarker, sourced as `lab_analysis_jobs/<job_id>`
- `daily_recommendations` from `daily-coach` now references the new markers

### 5c. Safety gate sanity check

Mark yourself pregnant (Onboarding → "Currently pregnant" toggle), then upload a lab PDF. In the resulting job row:

```sql
select textract_raw_json->'safety_gates'->'supplements_to_skip'
from public.lab_analysis_jobs
where id = '<your-job-id>';
```

You should see DHEA, Vitex, Berberine, Black Cohosh, etc. with `"Auto-blocked by safety gate: ..."` reasons. None of those should appear in `supplements_json`.

## 6. Operational notes

### Idempotency

The function is safe to re-invoke on the same `job_id`. If `status='complete'`, it returns immediately. If it's mid-run, calling again will race — generally you should only invoke once and poll.

### S3 cleanup

The function uses a `finally` block to delete its S3 staging object. If the function process is killed, the bucket lifecycle rule (Step 2b) is the backstop.

### Timeouts

Supabase edge functions have a wall-clock timeout (150s free tier, 400s pro tier). Textract for a 5-10 page lab usually takes 10-30 seconds. The function polls Textract up to ~3 minutes (`TEXTRACT_MAX_POLLS`). Multi-page heavy PDFs may exceed the free-tier window — bump to Pro if you see consistent timeouts.

### Cost

Per lab:
- Textract `AnalyzeDocument` with TABLES+FORMS: ~$0.065 per page (US East)
- OpenAI gpt-4o-mini extraction: ~$0.002 per lab
- S3 storage: negligible (staged for seconds)

### Failure modes

| Failure | What you see | Where to look |
|---|---|---|
| AWS creds wrong | `Textract.StartDocumentAnalysis failed (403)` | edge function logs |
| Textract sees no text (scanned PDF) | `Textract extracted no text or tables` | job.error |
| OpenAI rate limit | `OpenAI 429` | edge function logs |
| Storage path mismatch | `Storage download failed` | check `storage_path` in the row |

## 7. Related artifacts

- Client: `expo/lib/labAnalyzerClient.ts`
- Clinic-side tRPC mutation: `expo/backend/trpc/routes/clinic/labs.ts` → `triggerLabAnalysis`
- Hooked into `LabsProvider.tsx` PDF flow — the old client-side OpenAI Files API path has been replaced
- Safety gate engine is duplicated from `supabase/functions/daily-coach/index.ts`; keep both files in sync when adding new rule types
