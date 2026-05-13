/**
 * Supabase Edge Function: lab-analyzer
 *
 * Document-AI pipeline for functional lab reports (TruAge, TruHealth, normal panels, etc.):
 *
 *   1. Receive { jobId } from the client (PDF/image already in Supabase Storage)
 *   2. Verify the caller owns the job row
 *   3. Download the file from Supabase Storage
 *   4. Route by size/type:
 *        - Images (JPG/PNG) → sync Textract AnalyzeDocument (1-page docs, fastest)
 *        - PDFs            → upload to S3 → async StartDocumentAnalysis → poll → aggregate
 *      Async path supports up to 3,000 pages / 500 MB so 30-page TruHealth reports work.
 *   5. Parse Textract output into structured biomarkers
 *   6. Call OpenAI for enrichment ONLY (status / supplements / herbs / actions / narrative)
 *      — the model never has to read the PDF, so big files don't blow context
 *   7. Write results back to lab_analysis_jobs; realtime pushes the result to the client
 *
 * Deploy: supabase functions deploy lab-analyzer
 *
 * Required secrets (supabase secrets set ...):
 *   - SUPABASE_URL                  (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
 *   - AWS_REGION                    (e.g. us-east-1, must match S3 bucket region)
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_S3_BUCKET                 S3 bucket for async Textract input (e.g. rork-longevity-labs)
 *   - OPENAI_API_KEY
 *   - OPENAI_MODEL                  (optional; defaults to gpt-4o-mini)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';
import {
  TextractClient,
  AnalyzeDocumentCommand,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  type Block,
} from 'npm:@aws-sdk/client-textract@3.515.0';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from 'npm:@aws-sdk/client-s3@3.515.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AWS_REGION = Deno.env.get('AWS_REGION') ?? 'us-east-1';
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
const AWS_S3_BUCKET = Deno.env.get('AWS_S3_BUCKET') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches Supabase Storage bucket cap; well under Textract async 500 MB
const ASYNC_POLL_INTERVAL_MS = 2000;
const ASYNC_POLL_TIMEOUT_MS = 180_000; // 3 min — enough for ~30-page reports

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Missing Authorization bearer token' }, 401);

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const jobId = body.jobId;
  if (!jobId) return json({ error: 'jobId is required' }, 400);

  // Service-role client for DB writes + storage download
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller identity from the JWT
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid or expired token' }, 401);
  }
  const userId = userData.user.id;

  // Load the job and confirm ownership
  const { data: job, error: jobErr } = await admin
    .from('lab_analysis_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) return json({ error: 'Job not found' }, 404);
  if (job.user_id !== userId) return json({ error: 'Forbidden' }, 403);
  if (job.status === 'complete') return json({ ok: true, alreadyComplete: true });

  // Run the pipeline; failures are persisted to the job row so the client sees them.
  try {
    await processJob(admin, job);
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[lab-analyzer] failure', message);
    await admin
      .from('lab_analysis_jobs')
      .update({ status: 'failed', error: message })
      .eq('id', jobId);
    return json({ error: message }, 500);
  }
});

async function processJob(admin: SupabaseClient, job: Record<string, unknown>) {
  const jobId = job.id as string;
  const storagePath = job.storage_path as string;
  const fileType = job.file_type as 'pdf' | 'jpg' | 'png';

  await admin.from('lab_analysis_jobs').update({ status: 'extracting' }).eq('id', jobId);

  // ---- 1. Download the file from Supabase Storage ----
  const { data: fileBlob, error: dlErr } = await admin.storage
    .from('lab-pdfs')
    .download(storagePath);
  if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message ?? 'unknown'}`);

  const buf = new Uint8Array(await fileBlob.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      `File is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB. Maximum supported size is ${MAX_BYTES / 1024 / 1024} MB.`
    );
  }

  // ---- 2. Run Textract (async via S3 for PDFs, sync in-memory for images) ----
  const textract = new TextractClient({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });

  let blocks: Block[];
  if (fileType === 'pdf') {
    blocks = await runAsyncTextract(textract, buf, jobId, fileType);
  } else {
    const analyze = await textract.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: buf },
        FeatureTypes: ['TABLES', 'FORMS'],
      })
    );
    blocks = (analyze.Blocks ?? []) as Block[];
  }
  console.log(`[lab-analyzer] Textract returned ${blocks.length} blocks for job ${jobId}`);

  // ---- 3. Parse Textract tables into biomarker rows ----
  const verbatimBiomarkers = parseBiomarkersFromTextract(blocks);
  if (verbatimBiomarkers.length === 0) {
    throw new Error('Textract could not find any tabular biomarker data in this file.');
  }
  console.log(`[lab-analyzer] Parsed ${verbatimBiomarkers.length} biomarkers from Textract tables`);

  // ---- 4. GPT enrichment (status, supplements, herbs, priority actions) ----
  await admin
    .from('lab_analysis_jobs')
    .update({
      status: 'enriching',
      textract_raw_json: { biomarkers: verbatimBiomarkers }, // store parsed, not raw, to save row size
    })
    .eq('id', jobId);

  const patientCtx = await loadPatientContext(admin, job.user_id as string);
  const enriched = await enrichWithGPT(verbatimBiomarkers, patientCtx);
  const analysisText = await generateAnalysisNarrative(enriched.biomarkers, patientCtx);

  await admin
    .from('lab_analysis_jobs')
    .update({
      status: 'complete',
      biomarkers_json: enriched.biomarkers,
      supplements_json: enriched.supplements,
      herbs_json: enriched.herbs,
      priority_actions_json: enriched.priorityActions,
      analysis_text: analysisText,
      completed_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', jobId);

  console.log(`[lab-analyzer] Job ${jobId} complete`);
}

// ----------------------------------------------------------------------
// Async Textract via S3 (for multi-page PDFs > 11 pages / > 5 MB)
// ----------------------------------------------------------------------

async function runAsyncTextract(
  textract: TextractClient,
  buf: Uint8Array,
  jobId: string,
  fileType: 'pdf' | 'jpg' | 'png',
): Promise<Block[]> {
  if (!AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET secret is not set. Async Textract requires an S3 bucket.');
  }

  const s3 = new S3Client({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });

  const s3Key = `textract-jobs/${jobId}.${fileType}`;
  const contentType = fileType === 'pdf' ? 'application/pdf' : `image/${fileType}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3Key,
      Body: buf,
      ContentType: contentType,
    }),
  );
  console.log(`[lab-analyzer] Uploaded ${buf.byteLength} bytes to s3://${AWS_S3_BUCKET}/${s3Key}`);

  try {
    const start = await textract.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: AWS_S3_BUCKET, Name: s3Key } },
        FeatureTypes: ['TABLES', 'FORMS'],
      }),
    );
    const textractJobId = start.JobId;
    if (!textractJobId) throw new Error('Textract did not return a JobId');
    console.log(`[lab-analyzer] Started Textract job ${textractJobId}`);

    const blocks = await pollAsyncTextract(textract, textractJobId);
    return blocks;
  } finally {
    // Clean up so the bucket doesn't accumulate files. Best-effort — don't fail the job on cleanup error.
    s3.send(new DeleteObjectCommand({ Bucket: AWS_S3_BUCKET, Key: s3Key })).catch((e) => {
      console.warn(`[lab-analyzer] S3 cleanup failed for ${s3Key}:`, e);
    });
  }
}

async function pollAsyncTextract(textract: TextractClient, textractJobId: string): Promise<Block[]> {
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > ASYNC_POLL_TIMEOUT_MS) {
      throw new Error(`Textract job ${textractJobId} did not complete within ${ASYNC_POLL_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, ASYNC_POLL_INTERVAL_MS));

    const first = await textract.send(new GetDocumentAnalysisCommand({ JobId: textractJobId }));
    const status = first.JobStatus;
    if (status === 'IN_PROGRESS') continue;
    if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') {
      throw new Error(`Textract job ${textractJobId} ${status}: ${first.StatusMessage ?? 'no message'}`);
    }
    if (status !== 'SUCCEEDED') {
      throw new Error(`Textract job ${textractJobId} returned unexpected status ${status}`);
    }

    // Aggregate paginated results
    const allBlocks: Block[] = [...((first.Blocks ?? []) as Block[])];
    let nextToken = first.NextToken;
    while (nextToken) {
      const page = await textract.send(
        new GetDocumentAnalysisCommand({ JobId: textractJobId, NextToken: nextToken }),
      );
      allBlocks.push(...((page.Blocks ?? []) as Block[]));
      nextToken = page.NextToken;
    }
    return allBlocks;
  }
}

// ----------------------------------------------------------------------
// Textract table parsing
// ----------------------------------------------------------------------

interface VerbatimBiomarker {
  name: string;
  value: number;
  unit: string;
  referenceMin: number | null;
  referenceMax: number | null;
}

function parseBiomarkersFromTextract(blocks: Block[]): VerbatimBiomarker[] {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const cellText = (cell: Block): string => {
    const childIds = (cell.Relationships ?? [])
      .filter((r) => r.Type === 'CHILD')
      .flatMap((r) => r.Ids ?? []);
    return childIds
      .map((id) => byId.get(id))
      .filter((b): b is Block => !!b)
      .map((b) => b.Text ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();
  };

  const out: VerbatimBiomarker[] = [];

  for (const table of blocks.filter((b) => b.BlockType === 'TABLE')) {
    const cellIds = (table.Relationships ?? [])
      .filter((r) => r.Type === 'CHILD')
      .flatMap((r) => r.Ids ?? []);
    const cells = cellIds.map((id) => byId.get(id)).filter((b): b is Block => !!b && b.BlockType === 'CELL');
    if (cells.length === 0) continue;

    // Build rows: { rowIndex -> { colIndex -> text } }
    const rows = new Map<number, Map<number, string>>();
    let maxCol = 0;
    for (const c of cells) {
      const r = c.RowIndex ?? 0;
      const col = c.ColumnIndex ?? 0;
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r)!.set(col, cellText(c));
      if (col > maxCol) maxCol = col;
    }
    if (rows.size < 2) continue; // need header + at least one row

    // Identify columns by header keyword
    const headerRow = rows.get(1) ?? new Map();
    const colRole = new Map<number, 'name' | 'value' | 'unit' | 'reference' | 'flag' | 'other'>();
    for (let col = 1; col <= maxCol; col++) {
      const h = (headerRow.get(col) ?? '').toLowerCase();
      if (!h) colRole.set(col, 'other');
      else if (/test|analyte|marker|component|name/.test(h)) colRole.set(col, 'name');
      else if (/result|value|in range|out of range|current/.test(h)) colRole.set(col, 'value');
      else if (/unit/.test(h)) colRole.set(col, 'unit');
      else if (/ref|range|interval|normal/.test(h)) colRole.set(col, 'reference');
      else if (/flag|status/.test(h)) colRole.set(col, 'flag');
      else colRole.set(col, 'other');
    }

    // Heuristic fallback if headers didn't match: assume [name, value, unit, reference]
    const haveName = [...colRole.values()].includes('name');
    const haveValue = [...colRole.values()].includes('value');
    if (!haveName || !haveValue) {
      for (let col = 1; col <= maxCol; col++) {
        if (col === 1) colRole.set(col, 'name');
        else if (col === 2) colRole.set(col, 'value');
        else if (col === 3) colRole.set(col, 'unit');
        else if (col === 4) colRole.set(col, 'reference');
      }
    }

    const sortedRowIndexes = [...rows.keys()].sort((a, b) => a - b).slice(1); // skip header row
    for (const ri of sortedRowIndexes) {
      const row = rows.get(ri)!;
      let name = '';
      let valueStr = '';
      let unit = '';
      let referenceStr = '';
      for (let col = 1; col <= maxCol; col++) {
        const role = colRole.get(col) ?? 'other';
        const v = row.get(col) ?? '';
        if (role === 'name' && !name) name = v;
        else if (role === 'value' && !valueStr) valueStr = v;
        else if (role === 'unit' && !unit) unit = v;
        else if (role === 'reference' && !referenceStr) referenceStr = v;
      }
      if (!name) continue;

      const numericValue = parseNumericValue(valueStr);
      if (numericValue === null) continue;

      const { min, max } = parseReferenceRange(referenceStr);

      out.push({
        name: name.trim(),
        value: numericValue,
        unit: unit.trim(),
        referenceMin: min,
        referenceMax: max,
      });
    }
  }

  return dedupeByName(out);
}

function parseNumericValue(raw: string): number | null {
  if (!raw) return null;
  // Handle "<0.1", ">100", "12.3 H", "  4.5"
  const cleaned = raw
    .replace(/[<>]/g, '')
    .replace(/[a-zA-Z%*]/g, '') // strip flag letters and units that leaked in
    .replace(/,/g, '')
    .trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

function parseReferenceRange(raw: string): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const cleaned = raw.replace(/[,]/g, '').trim();

  // "70-99" or "70 - 99"
  const dash = cleaned.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (dash) return { min: parseFloat(dash[1]), max: parseFloat(dash[2]) };

  // "<100"
  const lt = cleaned.match(/^<\s*(-?\d+(?:\.\d+)?)/);
  if (lt) return { min: null, max: parseFloat(lt[1]) };

  // ">40"
  const gt = cleaned.match(/^>\s*(-?\d+(?:\.\d+)?)/);
  if (gt) return { min: parseFloat(gt[1]), max: null };

  return { min: null, max: null };
}

function dedupeByName(list: VerbatimBiomarker[]): VerbatimBiomarker[] {
  const seen = new Map<string, VerbatimBiomarker>();
  for (const b of list) {
    const key = b.name.toLowerCase().trim();
    if (!seen.has(key)) seen.set(key, b);
  }
  return [...seen.values()];
}

// ----------------------------------------------------------------------
// OpenAI enrichment
// ----------------------------------------------------------------------

interface EnrichedBiomarker extends VerbatimBiomarker {
  functionalMin: number | null;
  functionalMax: number | null;
  status: 'optimal' | 'normal' | 'suboptimal' | 'critical';
}

interface Supplement {
  name: string;
  dose: string;
  timing: string;
  reason: string;
  mechanism: string;
}

interface EnrichmentResult {
  biomarkers: EnrichedBiomarker[];
  supplements: Supplement[];
  herbs: Supplement[];
  priorityActions: string[];
}

const ENRICHMENT_PROMPT = `You are a functional medicine practitioner. The biomarker values below were extracted by AWS Textract directly from a lab PDF — the numbers are correct and you MUST NOT modify them. Your job is ONLY to add functional ranges, status, supplements, herbs, and priority actions.

PRESERVE EXACTLY: name, value, unit, referenceMin, referenceMax. Do not round, convert, or replace any number.

For each biomarker add:
- functionalMin / functionalMax: optimal functional medicine range
- status: "optimal" (within functional range), "normal" (within reference but not optimal), "suboptimal" (slightly outside), or "critical" (significantly outside)

For SUPPLEMENTS, prioritize these specific products from our catalog when the condition matches:
- ProOmega 2000 (Nordic Naturals) — 2 softgels daily with meals — omega-3, EPA/DHA, inflammation, cardiovascular, triglycerides
- GlucoPrime (Healthgevity) — 1 capsule 2x daily with meals — blood sugar, insulin resistance, glucose, HbA1c
- Protect+ 10 (Healthgevity) — 1 softgel daily with fat — foundational multi, vitamin D, antioxidants
- Liver Sauce (Quicksilver Scientific) — 1 tsp daily empty stomach — liver, detox, ALT/AST elevation
- Liposomal Glutathione Complex (Quicksilver Scientific) — 1 tsp daily empty stomach — glutathione, oxidative stress, detox
- Glutaryl Transdermal Glutathione (Auro Wellness) — 4 pumps daily on skin — glutathione, detox
- MitoCore (Orthomolecular) — 4 capsules daily with breakfast — mitochondrial support, CoQ10, energy, fatigue
- NAC 900+ (Healthgevity) — 1-2 capsules daily — NAC, liver support, glutathione precursor
- Gut Shield (Healthgevity) — 1 scoop daily — gut repair, leaky gut, IBS, gut inflammation
- ProBiota HistaminX (Seeking Health) — 1 capsule daily — probiotics, histamine intolerance, gut
- Sleep Deep (Healthgevity) — 2 capsules before bed — sleep, insomnia, GABA, magnesium
- Magnesium Glycinate 300 (Healthgevity) — 1-2 capsules evening — magnesium, sleep, muscle cramps, stress
- Methyl B Complex (Healthgevity) — 1 capsule morning — B vitamins, methylation, MTHFR, homocysteine
- D3+K2 5000 (Healthgevity) — 1 softgel morning with fat — vitamin D deficiency, bone, immune
- Adrenal Restore (Healthgevity) — 2 capsules morning — adrenal fatigue, cortisol, HPA axis, stress

Return ONLY valid JSON:
{
  "biomarkers": [{"name": string, "value": number, "unit": string, "referenceMin": number|null, "referenceMax": number|null, "functionalMin": number|null, "functionalMax": number|null, "status": "optimal"|"normal"|"suboptimal"|"critical"}],
  "supplements": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "herbs": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "priorityActions": [string]
}

The "biomarkers" array MUST contain exactly the same entries (same name/value/unit/referenceMin/referenceMax) as provided, in the same order, only with functionalMin/functionalMax/status added.`;

async function enrichWithGPT(verbatim: VerbatimBiomarker[], patientCtx: PatientContext): Promise<EnrichmentResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY secret is not set on the edge function.');

  const gates = computeLabSupplementGates(verbatim, patientCtx);
  const contextBlock = formatPatientContextForPrompt(patientCtx, gates);
  const userMessage = `${ENRICHMENT_PROMPT}\n\n${contextBlock}\n\nVERBATIM BIOMARKERS (do not modify):\n${JSON.stringify(verbatim, null, 2)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a meticulous functional medicine practitioner.' },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI enrichment failed (${res.status}): ${t.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '';
  let parsed: EnrichmentResult;
  try {
    parsed = JSON.parse(content) as EnrichmentResult;
  } catch (e) {
    throw new Error(`OpenAI returned invalid JSON: ${(e as Error).message}`);
  }

  // Safety net: force-restore verbatim values in case the model drifted.
  const byName = new Map(verbatim.map((b) => [b.name.toLowerCase().trim(), b]));
  parsed.biomarkers = (parsed.biomarkers ?? []).map((b) => {
    const truth = byName.get((b.name ?? '').toLowerCase().trim());
    if (!truth) return b;
    return {
      ...b,
      name: truth.name,
      value: truth.value,
      unit: truth.unit,
      referenceMin: truth.referenceMin,
      referenceMax: truth.referenceMax,
    };
  });

  // Post-filter: enforce safety gates even if the model recommended something blocked.
  const filterFn = (list: Supplement[]): Supplement[] =>
    list.filter((s) => !gates.blockedSupplements.has((s.name ?? '').toLowerCase()))
      .map((s) => {
        const cautions = gates.cautionSupplements.get((s.name ?? '').toLowerCase());
        if (cautions?.length) {
          return { ...s, reason: `${s.reason} | CAUTION: ${cautions.join('; ')}` };
        }
        return s;
      });

  return {
    biomarkers: parsed.biomarkers ?? [],
    supplements: filterFn(parsed.supplements ?? []),
    herbs: filterFn(parsed.herbs ?? []),
    priorityActions: parsed.priorityActions ?? [],
  };
}

const ANALYSIS_PROMPT = `You are a world-class functional medicine and longevity physician. Below are the patient's lab biomarkers (already extracted and statused). Produce a structured narrative analysis:

1. BIG-PICTURE SUMMARY — 3-6 bullets of the most important physiological imbalances, ranked by impact.
2. PATTERN RECOGNITION — identify mitochondrial dysfunction, insulin resistance, thyroid resistance, HPA axis, methylation, oxidative stress, inflammation, gut, detox patterns.
3. MARKER-BY-MARKER ANALYSIS — for each abnormal marker: meaning, system, functional range, root causes, links to other markers.
4. ROOT-CAUSE ACTION PLAN — diet, lifestyle, supplements, peptides, detox/gut.
5. LONGEVITY INTERPRETATION — biological age, cardiometabolic risk, inflammaging.
6. PATIENT-FRIENDLY EXPLANATION — speak directly to "you".
7. TOP 3 PRIORITIES.

Tone: clear, precise, educational, no fear-mongering.`;

async function generateAnalysisNarrative(biomarkers: EnrichedBiomarker[], patientCtx: PatientContext): Promise<string> {
  if (!OPENAI_API_KEY) return 'Analysis temporarily unavailable.';
  const summary = biomarkers
    .map(
      (b) =>
        `- ${b.name}: ${b.value} ${b.unit} (ref ${b.referenceMin ?? '?'}-${b.referenceMax ?? '?'}, functional ${b.functionalMin ?? '?'}-${b.functionalMax ?? '?'}) [${b.status}]`
    )
    .join('\n');

  const patientHeader = formatPatientHeaderForNarrative(patientCtx);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: ANALYSIS_PROMPT },
          { role: 'user', content: `${patientHeader}\n\nBiomarkers:\n${summary}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? 'Analysis temporarily unavailable.';
  } catch (e) {
    console.error('[lab-analyzer] narrative generation failed', e);
    return 'Analysis temporarily unavailable. Your biomarkers have been extracted and saved.';
  }
}

// ----------------------------------------------------------------------
// Patient context + contraindication-aware supplement gating
//
// Before recommending supplements off labs, we load the patient's profile,
// pregnancy/nursing status, conditions, medications, and the shared
// supplement_contraindication_rules table. The full multi-domain coach
// (symptoms + wearables + nutrition) lives in the daily-coach function;
// this loader is a lightweight subset so even a one-off lab upload is
// safety-aware (e.g. won't recommend DHEA when DHEA-S is already high).
// ----------------------------------------------------------------------

interface PatientContext {
  sex: 'male' | 'female' | 'other' | null;
  ageYears: number | null;
  pregnant: boolean;
  nursing: boolean;
  conditions: string[];
  medications: string[];
  allergies: string[];
  rules: ContraindicationRule[];
}

interface ContraindicationRule {
  id: string;
  supplement_name: string;
  rule_type: string;
  rule_value: Record<string, unknown>;
  severity: 'block' | 'caution';
  reason: string;
}

interface LabGateOutput {
  blockedSupplements: Set<string>;
  cautionSupplements: Map<string, string[]>;
  notes: string[];
}

async function loadPatientContext(admin: SupabaseClient, userId: string): Promise<PatientContext> {
  const [profileR, contraR, rulesR] = await Promise.all([
    admin.from('profiles').select('sex, birth_date').eq('id', userId).maybeSingle(),
    admin.from('contraindications').select('*').eq('user_id', userId)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('supplement_contraindication_rules').select('*').eq('active', true),
  ]);

  const p = profileR.data;
  const c = contraR.data as Record<string, unknown> | null;
  const birth = p?.birth_date as string | null;
  const ageYears = birth
    ? Math.floor((Date.now() - new Date(birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return {
    sex: ((p?.sex as PatientContext['sex']) ?? null),
    ageYears,
    pregnant: Boolean(c?.pregnant),
    nursing: Boolean(c?.nursing),
    conditions: (c?.conditions as string[] | null) ?? [],
    medications: (c?.medications as string[] | null) ?? [],
    allergies: (c?.allergies as string[] | null) ?? [],
    rules: (rulesR.data ?? []) as ContraindicationRule[],
  };
}

function computeLabSupplementGates(
  biomarkers: VerbatimBiomarker[],
  ctx: PatientContext,
): LabGateOutput {
  const blocked = new Set<string>();
  const caution = new Map<string, string[]>();
  const notes: string[] = [];

  for (const rule of ctx.rules) {
    if (!ruleAppliesToLabContext(rule, biomarkers, ctx)) continue;
    const key = rule.supplement_name.toLowerCase();
    if (rule.severity === 'block') {
      blocked.add(key);
      notes.push(`BLOCK ${rule.supplement_name}: ${rule.reason}`);
    } else {
      if (!caution.has(key)) caution.set(key, []);
      caution.get(key)!.push(rule.reason);
      notes.push(`CAUTION ${rule.supplement_name}: ${rule.reason}`);
    }
  }

  return { blockedSupplements: blocked, cautionSupplements: caution, notes };
}

function ruleAppliesToLabContext(
  rule: ContraindicationRule,
  biomarkers: VerbatimBiomarker[],
  ctx: PatientContext,
): boolean {
  switch (rule.rule_type) {
    case 'pregnancy': return ctx.pregnant;
    case 'nursing': return ctx.nursing;
    case 'sex': {
      const target = String(rule.rule_value.sex ?? '').toLowerCase();
      return ctx.sex === target;
    }
    case 'age': {
      if (ctx.ageYears === null) return false;
      const max = Number(rule.rule_value.max_age ?? Infinity);
      const min = Number(rule.rule_value.min_age ?? 0);
      return ctx.ageYears < max && ctx.ageYears >= min;
    }
    case 'condition': {
      const target = String(rule.rule_value.condition ?? '').toLowerCase();
      return ctx.conditions.some((c) => c.toLowerCase().includes(target));
    }
    case 'medication': {
      const list = (rule.rule_value.contains as string[] | undefined) ?? [];
      const meds = ctx.medications.map((m) => m.toLowerCase());
      return list.some((n) => meds.some((m) => m.includes(n.toLowerCase())));
    }
    case 'biomarker_high': {
      const name = String(rule.rule_value.name ?? '').toLowerCase();
      const threshold = Number(rule.rule_value.threshold ?? Infinity);
      const requiredSex = rule.rule_value.sex ? String(rule.rule_value.sex).toLowerCase() : null;
      if (requiredSex && ctx.sex !== requiredSex) return false;
      const bio = biomarkers.find((b) => b.name.toLowerCase().includes(name));
      return bio ? bio.value > threshold : false;
    }
    case 'biomarker_low': {
      const name = String(rule.rule_value.name ?? '').toLowerCase();
      const threshold = Number(rule.rule_value.threshold ?? -Infinity);
      const bio = biomarkers.find((b) => b.name.toLowerCase().includes(name));
      return bio ? bio.value < threshold : false;
    }
    case 'symptom_pattern':
      // Lab-only path has no symptom data — daily-coach evaluates these.
      return false;
    default:
      return false;
  }
}

function formatPatientContextForPrompt(ctx: PatientContext, gates: LabGateOutput): string {
  const lines = [
    'PATIENT CONTEXT (consider before recommending supplements):',
    `- Sex: ${ctx.sex ?? 'unknown'}`,
    `- Age: ${ctx.ageYears !== null ? `${ctx.ageYears} years` : 'unknown'}`,
    `- Pregnant: ${ctx.pregnant ? 'YES' : 'no'}`,
    `- Nursing: ${ctx.nursing ? 'YES' : 'no'}`,
    `- Active conditions: ${ctx.conditions.length ? ctx.conditions.join(', ') : 'none reported'}`,
    `- Current medications: ${ctx.medications.length ? ctx.medications.join(', ') : 'none reported'}`,
    `- Allergies: ${ctx.allergies.length ? ctx.allergies.join(', ') : 'none reported'}`,
  ];

  if (gates.blockedSupplements.size > 0) {
    lines.push('', 'STRICTLY BLOCKED supplements (do NOT recommend, do NOT mention positively):');
    for (const s of gates.blockedSupplements) lines.push(`  - ${s}`);
  }
  if (gates.cautionSupplements.size > 0) {
    lines.push('', 'CAUTION supplements (only with explicit warning in the reason field):');
    for (const [s, reasons] of gates.cautionSupplements) {
      lines.push(`  - ${s}: ${reasons.join('; ')}`);
    }
  }

  return lines.join('\n');
}

function formatPatientHeaderForNarrative(ctx: PatientContext): string {
  const parts: string[] = ['PATIENT BACKGROUND:'];
  parts.push(`- ${ctx.sex ?? 'unknown sex'}, ${ctx.ageYears !== null ? `${ctx.ageYears} y/o` : 'age unknown'}`);
  if (ctx.pregnant) parts.push('- PREGNANT — adjust recommendations accordingly');
  if (ctx.nursing) parts.push('- NURSING — adjust recommendations accordingly');
  if (ctx.conditions.length) parts.push(`- Conditions: ${ctx.conditions.join(', ')}`);
  if (ctx.medications.length) parts.push(`- Medications: ${ctx.medications.join(', ')}`);
  return parts.join('\n');
}
