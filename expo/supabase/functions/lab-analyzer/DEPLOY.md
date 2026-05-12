# Lab Analyzer — Deployment Checklist

This pipeline replaces the old client-side OpenAI-PDF flow with a server-side
**AWS Textract + GPT enrichment** flow. PDFs (and lab image files) are
uploaded to Supabase Storage, parsed by Textract, then enriched by OpenAI
on the server. No OpenAI key is needed on the mobile client for labs.

## Prerequisites

You should have signed up for these and have keys handy before deploying:

- **AWS account** with Textract access in your chosen region (`us-east-1`
  is the default; pick one close to your Supabase region).
- **AWS BAA** signed in AWS Artifact (required for processing PHI / lab
  reports). Free, takes ~5 minutes.
- **IAM user** with a programmatic access key + secret. Attach the
  `AmazonTextractFullAccess` policy (or scope it down to just the
  `AnalyzeDocument` action).
- **OpenAI API key** — the same key you've been using is fine; it just
  moves from the mobile app to the server. **Rotate it after this ships
  since it was previously embedded in client builds.**
- **Supabase service_role key** rotation if it's ever been exposed.
  (It's auto-injected into the edge function, you don't have to set it.)

## 1. Set Edge Function secrets

Run these from the project root (one-time):

```bash
supabase secrets set \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=AKIA... \
  AWS_SECRET_ACCESS_KEY=... \
  OPENAI_API_KEY=sk-... \
  OPENAI_MODEL=gpt-4o-mini
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase
at runtime — do **not** set them manually.

## 2. Apply the database migration

```bash
supabase db push
```

This creates:

- `lab-pdfs` Storage bucket (private, 50 MB limit, PDF/JPG/PNG only)
- Storage RLS so users can only read/write objects under their own `{user_id}/` folder
- `public.lab_analysis_jobs` table for tracking job status and storing results
- RLS so users only see their own jobs
- Realtime publication on the jobs table so the client gets push updates

## 3. Deploy the edge function

```bash
supabase functions deploy lab-analyzer
```

Verify with:

```bash
supabase functions list
```

You should see `lab-analyzer` listed with status `ACTIVE`.

## 4. Smoke test

From the app (or `curl` with a real user JWT):

1. Sign in.
2. Upload a small lab PDF (1-3 pages).
3. Watch the job row populate: `select * from lab_analysis_jobs order by created_at desc limit 1;`
4. Status should transition `pending` → `extracting` → `enriching` → `complete` within ~30 seconds.

If anything fails, `lab_analysis_jobs.error` contains the message.

## 5. Rotate the old OpenAI key

After confirming the new flow works:

- Go to https://platform.openai.com/api-keys
- Revoke the old key (the one that was in `EXPO_PUBLIC_OPENAI_API_KEY`)
- Generate a new one, set it as the `OPENAI_API_KEY` secret on the edge function

## Current limits

The edge function uses Textract's **synchronous `AnalyzeDocument`** API, which is
capped at:

- **5 pages** per PDF
- **5 MB** per file

This covers ~95% of consumer lab PDFs. If you start seeing "PDF too large"
errors, upgrade to the async path:

1. Create an S3 bucket (`lab-pdfs-staging`) in the same region.
2. In the edge function, upload the file to S3 first, then call
   `StartDocumentAnalysis`, then poll `GetDocumentAnalysis` (or use SNS).
3. This supports up to **500 pages / 500 MB**.

## What still uses the public OpenAI key

These are *not* migrated by this PR and still use `EXPO_PUBLIC_OPENAI_API_KEY`
on the mobile client. They should move to the server later:

- `expo/utils/nutrition/transcribeAudio.ts` — Whisper for nutrition voice input
- `expo/providers/LabsProvider.tsx` — image-based (JPG/PNG) lab extraction
  still uses the OpenAI gateway via the Rork toolkit. PDFs are migrated.

Until those move server-side, treat the OpenAI key as *partially* exposed.
