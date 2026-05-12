/**
 * Supabase Edge Function: lab-analyzer
 *
 * Replaces the client-side PDF-via-GPT extraction flow with a real
 * document-AI pipeline:
 *
 *   1. Receive { jobId } from the client (PDF/image already in Supabase Storage)
 *   2. Verify the caller owns the job row
 *   3. Download the file from Storage
 *   4. Send to AWS Textract AnalyzeDocument with TABLES + FORMS
 *   5. Parse Textract output into structured biomarkers
 *   6. Call OpenAI for enrichment ONLY (status / supplements / herbs / actions / narrative)
 *      — the model never has to read the PDF, so big files no longer break it
 *   7. Write results back to lab_analysis_jobs; realtime pushes the result to the client
 *
 * Deploy: supabase functions deploy lab-analyzer
 *
 * Required secrets (supabase secrets set ...):
 *   - SUPABASE_URL                  (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
 *   - AWS_REGION                    (e.g. us-east-1)
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - OPENAI_API_KEY
 *   - OPENAI_MODEL                  (optional; defaults to gpt-4o-mini)
 *
 * Sync Textract supports up to 5 pages / 5 MB. Bigger files return a clear
 * "PDF too large" error so the user knows to split it. Upgrade to the async
 * StartDocumentAnalysis path when you add an S3 bucket.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';
import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
} from 'npm:@aws-sdk/client-textract@3.515.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AWS_REGION = Deno.env.get('AWS_REGION') ?? 'us-east-1';
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const MAX_SYNC_BYTES = 5 * 1024 * 1024; // 5 MB — Textract sync limit

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
  if (buf.byteLength > MAX_SYNC_BYTES) {
    throw new Error(
      `PDF is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB. Sync Textract is capped at 5 MB. Please split the PDF or upgrade this function to use S3 + StartDocumentAnalysis.`
    );
  }

  // ---- 2. Send to AWS Textract ----
  const textract = new TextractClient({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });

  const analyze = await textract.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: buf },
      FeatureTypes: ['TABLES', 'FORMS'],
    })
  );

  const blocks = (analyze.Blocks ?? []) as Block[];
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

  const enriched = await enrichWithGPT(verbatimBiomarkers);
  const analysisText = await generateAnalysisNarrative(enriched.biomarkers);

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

async function enrichWithGPT(verbatim: VerbatimBiomarker[]): Promise<EnrichmentResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY secret is not set on the edge function.');

  const userMessage = `${ENRICHMENT_PROMPT}\n\nVERBATIM BIOMARKERS (do not modify):\n${JSON.stringify(verbatim, null, 2)}`;

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

  return {
    biomarkers: parsed.biomarkers ?? [],
    supplements: parsed.supplements ?? [],
    herbs: parsed.herbs ?? [],
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

async function generateAnalysisNarrative(biomarkers: EnrichedBiomarker[]): Promise<string> {
  if (!OPENAI_API_KEY) return 'Analysis temporarily unavailable.';
  const summary = biomarkers
    .map(
      (b) =>
        `- ${b.name}: ${b.value} ${b.unit} (ref ${b.referenceMin ?? '?'}-${b.referenceMax ?? '?'}, functional ${b.functionalMin ?? '?'}-${b.functionalMax ?? '?'}) [${b.status}]`
    )
    .join('\n');

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
          { role: 'user', content: `Biomarkers:\n${summary}` },
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
