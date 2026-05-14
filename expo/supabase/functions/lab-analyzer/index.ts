/**
 * Supabase Edge Function: Lab Analyzer
 *
 * Async pipeline for parsing uploaded lab PDFs / images:
 *
 *   client uploads to Storage(lab-pdfs/<user_id>/...) + inserts a
 *     lab_analysis_jobs row with status='pending'
 *   client invokes lab-analyzer with { job_id }
 *
 *   THIS FUNCTION:
 *     1. status -> 'extracting'
 *     2. download from Storage; upload to AWS S3 staging bucket
 *     3. AWS Textract StartDocumentAnalysis (TABLES+FORMS, async),
 *        poll GetDocumentAnalysis until SUCCEEDED
 *     4. status -> 'enriching'
 *     5. flatten Textract blocks (lines + reconstructed tables)
 *     6. OpenAI extracts biomarkers + supplements + herbs +
 *        priority actions + clinical narrative
 *     7. deterministic safety-gate engine filters supplements
 *        (mirrors daily-coach/index.ts)
 *     8. fan biomarkers out into lab_markers
 *     9. status -> 'complete', write everything back to the job row,
 *        delete the S3 staging object
 *
 * On any failure the job is left with status='failed' + error message.
 *
 * NB: the safety-gate engine here MUST stay in sync with
 *     supabase/functions/daily-coach/index.ts.
 *
 * Deploy: supabase functions deploy lab-analyzer
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

// ────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const AWS_REGION = Deno.env.get('AWS_REGION') ?? 'us-east-1';
const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
const AWS_S3_BUCKET = Deno.env.get('AWS_S3_BUCKET') ?? '';

const STORAGE_BUCKET = 'lab-pdfs';
const TEXTRACT_POLL_INTERVAL_MS = 2000;
const TEXTRACT_MAX_POLLS = 90; // ~3 minutes wall clock

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  file_type: 'pdf' | 'jpg' | 'png';
  status: 'pending' | 'extracting' | 'enriching' | 'complete' | 'failed';
}

interface Biomarker {
  name: string;
  value: number;
  unit: string;
  referenceMin: number | null;
  referenceMax: number | null;
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

interface ExtractionOutput {
  biomarkers: Biomarker[];
  supplements: Supplement[];
  herbs: Supplement[];
  priorityActions: string[];
  analysisText: string;
}

interface RuleRow {
  id: string;
  supplement_name: string;
  rule_type: string;
  rule_value: Record<string, unknown>;
  severity: 'block' | 'caution';
  reason: string;
  active: boolean;
}

interface GateHit {
  supplement: string;
  severity: 'block' | 'caution';
  reason: string;
  rule_id: string;
  rule_type: string;
}

interface SafetyContext {
  profile: { sex: string | null; age: number | null };
  contraindications: { pregnant: boolean; nursing: boolean; medications: string[]; allergies: string[]; conditions: string[] };
  latestLabs: Array<{ marker_name: string; marker_value: number; unit: string }>;
  recentSymptoms: Array<{ symptom_name: string; severity: number | null }>;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function normalizeSymptom(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────
// Safety-gate engine
// (mirror of daily-coach/index.ts - keep in sync)
// ────────────────────────────────────────────────────────────

function evaluateRule(rule: RuleRow, ctx: SafetyContext): GateHit | null {
  const rv = rule.rule_value ?? {};

  switch (rule.rule_type) {
    case 'pregnancy':
      if (ctx.contraindications.pregnant) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;

    case 'nursing':
      if (ctx.contraindications.nursing) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;

    case 'sex': {
      const required = rv.sex as string | undefined;
      if (required && ctx.profile.sex && required.toLowerCase() === ctx.profile.sex.toLowerCase()) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'age': {
      const maxAge = rv.max_age as number | undefined;
      const minAge = rv.min_age as number | undefined;
      if (ctx.profile.age == null) return null;
      if (maxAge != null && ctx.profile.age <= maxAge) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      if (minAge != null && ctx.profile.age >= minAge) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'condition': {
      const required = (rv.any_of as string[] | undefined) ?? [];
      const userConditions = ctx.contraindications.conditions.map(c => c.toLowerCase());
      const hit = required.some(c => userConditions.some(u => u.includes(c.toLowerCase())));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'medication': {
      const required = (rv.contains as string[] | undefined) ?? [];
      const userMeds = ctx.contraindications.medications.map(m => m.toLowerCase());
      const hit = required.some(m => userMeds.some(u => u.includes(m.toLowerCase())));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'biomarker_high':
    case 'biomarker_low': {
      const name = (rv.name as string | undefined)?.toLowerCase();
      const threshold = rv.threshold as number | undefined;
      const ruleSex = (rv.sex as string | undefined)?.toLowerCase();
      if (!name || threshold == null) return null;
      if (ruleSex && ctx.profile.sex && ruleSex !== ctx.profile.sex.toLowerCase()) return null;

      // Prefer exact match (case-insensitive) before falling back to substring.
      // Substring-only matching picked up the wrong marker when the user had
      // e.g. both "Free Testosterone" and "Testosterone (Total)" rows.
      const lowered = ctx.latestLabs.map(l => ({ ...l, lname: l.marker_name.toLowerCase() }));
      const reading = lowered.find(l => l.lname === name)
        ?? lowered.find(l => l.lname.startsWith(name))
        ?? lowered.find(l => l.lname.includes(name));
      if (!reading) return null;

      const triggered = rule.rule_type === 'biomarker_high'
        ? reading.marker_value >= threshold
        : reading.marker_value <= threshold;
      if (triggered) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'symptom_pattern': {
      const anyOf = (rv.any_of as string[] | undefined) ?? [];
      const normalizedRequired = anyOf.map(normalizeSymptom);
      const normalizedRecent = ctx.recentSymptoms
        .filter(s => (s.severity ?? 0) >= 2)
        .map(s => normalizeSymptom(s.symptom_name));
      const all = new Set(normalizedRecent);
      const hit = normalizedRequired.some(r => Array.from(all).some(s => s.includes(r) || r.includes(s)));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    default:
      return null;
  }
}

function runSafetyGates(rules: RuleRow[], ctx: SafetyContext): { blocked: GateHit[]; cautioned: GateHit[] } {
  const blocked: GateHit[] = [];
  const cautioned: GateHit[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    const hit = evaluateRule(rule, ctx);
    if (!hit) continue;
    if (hit.severity === 'block') blocked.push(hit);
    else cautioned.push(hit);
  }
  const blockedSet = new Set(blocked.map(b => b.supplement.toLowerCase()));
  const dedupedCautions = cautioned.filter(c => !blockedSet.has(c.supplement.toLowerCase()));
  return { blocked, cautioned: dedupedCautions };
}

function postFilterSupplements(
  supplements: Supplement[],
  blocked: GateHit[],
  cautioned: GateHit[],
): { kept: Supplement[]; skipped: { name: string; reason: string }[] } {
  const blockedNames = new Set(blocked.map(b => b.supplement.toLowerCase()));
  const cautionByName = new Map(cautioned.map(c => [c.supplement.toLowerCase(), c]));

  const kept: Supplement[] = [];
  const skipped: { name: string; reason: string }[] = blocked.map(b => ({
    name: b.supplement,
    reason: `Auto-blocked by safety gate: ${b.reason}`,
  }));

  for (const supp of supplements) {
    const key = supp.name.toLowerCase();
    if (blockedNames.has(key)) {
      // Already in skipped via the blocked loop above; don't add the LLM
      // entry, it just gets dropped.
      continue;
    }
    // Match against blocked by substring too (LLM may produce "DHEA 25mg"
    // when rule says "DHEA").
    const blockMatch = blocked.find(b =>
      key.includes(b.supplement.toLowerCase()) || b.supplement.toLowerCase().includes(key)
    );
    if (blockMatch) {
      skipped.push({ name: supp.name, reason: `Auto-blocked by safety gate: ${blockMatch.reason}` });
      continue;
    }
    const cautionMatch = cautionByName.get(key) ?? cautioned.find(c =>
      key.includes(c.supplement.toLowerCase()) || c.supplement.toLowerCase().includes(key)
    );
    if (cautionMatch) {
      kept.push({
        ...supp,
        reason: `${supp.reason} (Caution: ${cautionMatch.reason} — monitor closely.)`,
      });
      continue;
    }
    kept.push(supp);
  }

  return { kept, skipped };
}

// ────────────────────────────────────────────────────────────
// AWS calls (Textract + S3)
// ────────────────────────────────────────────────────────────

function awsClient(): AwsClient {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not set (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  }
  return new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION,
    service: 's3',
  });
}

function textractClient(): AwsClient {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not set (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  }
  return new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: AWS_REGION,
    service: 'textract',
  });
}

// Encode each path segment individually so '/' stays as '/' in the URL.
// encodeURIComponent('a/b') -> 'a%2Fb' would change the S3 key entirely.
function encodeS3Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

async function s3PutObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (!AWS_S3_BUCKET) throw new Error('AWS_S3_BUCKET not set');
  const aws = awsClient();
  const url = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeS3Key(key)}`;
  const res = await aws.fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': contentType,
      // Server-side encryption at rest. Required for PHI.
      'x-amz-server-side-encryption': 'AES256',
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`S3 PUT failed (${res.status}): ${txt}`);
  }
}

async function s3DeleteObject(key: string): Promise<void> {
  if (!AWS_S3_BUCKET) return;
  try {
    const aws = awsClient();
    const url = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeS3Key(key)}`;
    const res = await aws.fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      console.error('[lab-analyzer] S3 DELETE non-ok', res.status, await res.text());
    }
  } catch (e) {
    console.error('[lab-analyzer] S3 DELETE failed (non-blocking)', e);
  }
}

async function textractCall<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const aws = textractClient();
  const res = await aws.fetch(`https://textract.${AWS_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `Textract.${target}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Textract.${target} failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as T;
}

interface TextractBlock {
  Id?: string;
  BlockType?: string;
  Text?: string;
  RowIndex?: number;
  ColumnIndex?: number;
  EntityTypes?: string[];
  Relationships?: { Type: string; Ids: string[] }[];
}

interface GetDocumentAnalysisResponse {
  JobStatus: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS';
  Blocks?: TextractBlock[];
  NextToken?: string;
  StatusMessage?: string;
}

async function startTextract(s3Key: string): Promise<string> {
  const start = await textractCall<{ JobId: string }>('StartDocumentAnalysis', {
    DocumentLocation: { S3Object: { Bucket: AWS_S3_BUCKET, Name: s3Key } },
    FeatureTypes: ['TABLES', 'FORMS'],
  });
  return start.JobId;
}

// Poll Textract for up to budgetMs milliseconds. Returns:
//   { done: false } if Textract is still IN_PROGRESS at the budget cutoff
//   { done: true, blocks } if SUCCEEDED / PARTIAL_SUCCESS (with all blocks paginated)
// Throws on FAILED.
async function pollTextract(textractJobId: string, budgetMs: number): Promise<{ done: false } | { done: true; blocks: TextractBlock[] }> {
  const deadline = Date.now() + budgetMs;
  let status: GetDocumentAnalysisResponse['JobStatus'] = 'IN_PROGRESS';

  while (Date.now() < deadline) {
    await sleep(TEXTRACT_POLL_INTERVAL_MS);
    const probe = await textractCall<GetDocumentAnalysisResponse>('GetDocumentAnalysis', {
      JobId: textractJobId,
      MaxResults: 1,
    });
    status = probe.JobStatus;
    if (status === 'SUCCEEDED' || status === 'PARTIAL_SUCCESS') break;
    if (status === 'FAILED') {
      throw new Error(`Textract job failed: ${probe.StatusMessage ?? 'no message'}`);
    }
  }

  if (status !== 'SUCCEEDED' && status !== 'PARTIAL_SUCCESS') {
    return { done: false };
  }

  // Paginate all blocks now that the job is finished.
  const blocks: TextractBlock[] = [];
  let nextToken: string | undefined;
  do {
    const page = await textractCall<GetDocumentAnalysisResponse>('GetDocumentAnalysis', {
      JobId: textractJobId,
      MaxResults: 1000,
      ...(nextToken ? { NextToken: nextToken } : {}),
    });
    if (page.Blocks) blocks.push(...page.Blocks);
    nextToken = page.NextToken;
  } while (nextToken);

  return { done: true, blocks };
}

// ────────────────────────────────────────────────────────────
// Textract block flattening
// ────────────────────────────────────────────────────────────

function flattenTextract(blocks: TextractBlock[]): { text: string; tables: string[][][] } {
  const byId = new Map<string, TextractBlock>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const lineTexts: string[] = [];
  for (const b of blocks) {
    if (b.BlockType === 'LINE' && b.Text) lineTexts.push(b.Text);
  }

  const tables: string[][][] = [];
  for (const tableBlock of blocks) {
    if (tableBlock.BlockType !== 'TABLE') continue;
    const cellIds = (tableBlock.Relationships ?? [])
      .filter(r => r.Type === 'CHILD')
      .flatMap(r => r.Ids);
    let maxRow = 0;
    let maxCol = 0;
    const cells: Array<{ row: number; col: number; text: string }> = [];
    for (const cellId of cellIds) {
      const cell = byId.get(cellId);
      if (!cell || cell.BlockType !== 'CELL') continue;
      const row = cell.RowIndex ?? 0;
      const col = cell.ColumnIndex ?? 0;
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);

      const childIds = (cell.Relationships ?? [])
        .filter(r => r.Type === 'CHILD')
        .flatMap(r => r.Ids);
      const cellText = childIds
        .map(id => byId.get(id))
        .filter(b => b?.BlockType === 'WORD' && !!b.Text)
        .map(b => b!.Text!)
        .join(' ');
      cells.push({ row, col, text: cellText });
    }

    const grid: string[][] = Array.from({ length: maxRow }, () => Array<string>(maxCol).fill(''));
    for (const c of cells) {
      if (c.row > 0 && c.col > 0) grid[c.row - 1][c.col - 1] = c.text;
    }
    tables.push(grid);
  }

  return { text: lineTexts.join('\n'), tables };
}

// ────────────────────────────────────────────────────────────
// OpenAI enrichment
// ────────────────────────────────────────────────────────────

interface PriorMarker {
  marker_name: string;
  marker_value: number;
  unit: string;
  collected_at: string;
}

async function fetchPriorMarkers(
  sb: ReturnType<typeof createClient>,
  userId: string,
  currentJobId: string,
): Promise<PriorMarker[]> {
  // Pull the user's last 200 lab markers from prior uploads (anything not
  // sourced from this job). For each marker_name we keep the most recent
  // reading so the LLM sees a clean "prior value" baseline to compare against.
  const { data, error } = await sb
    .from('lab_markers')
    .select('marker_name, marker_value, unit, collected_at, source')
    .eq('user_id', userId)
    .neq('source', `lab_analysis_jobs/${currentJobId}`)
    .order('collected_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[lab-analyzer] fetchPriorMarkers failed', error);
    return [];
  }
  const byName = new Map<string, PriorMarker>();
  for (const r of (data as Array<{ marker_name: string; marker_value: number; unit: string; collected_at: string }>) ?? []) {
    const key = r.marker_name.toLowerCase().trim();
    if (!byName.has(key)) {
      byName.set(key, {
        marker_name: r.marker_name,
        marker_value: r.marker_value,
        unit: r.unit,
        collected_at: r.collected_at,
      });
    }
  }
  return Array.from(byName.values());
}

const EXTRACTION_SYSTEM_PROMPT = `You are a meticulous medical data extractor and functional-medicine clinician.

You receive raw OCR text and table-cell grids from a clinical lab report. Your job is to:
1. Extract EVERY biomarker / analyte row VERBATIM. Copy numeric values exactly; do not round, convert, or substitute. If a value is illegible, OMIT it rather than guess.
2. Classify each value's status into "optimal" / "normal" / "suboptimal" / "critical" using functional-medicine optimal ranges (not just the lab's reference range).
3. Generate supplement and herb recommendations grounded in the specific biomarker values shown.
4. Generate a longevity-oriented clinical narrative.

WHEN PRIOR VALUES ARE PROVIDED:
You will see a "PRIOR VALUES" block listing the user's most recent reading for each marker that has appeared in earlier labs.
- Open the analysisText with a "PROGRESS SINCE LAST LAB" section that lists, by marker, what improved (toward functional optimal) and what worsened (away from functional optimal). Quote both numbers explicitly: "TSH 1.8 → 2.4 mIU/L (worsening; pushing toward suboptimal)".
- When recommending supplements, prefer to continue what was clearly working and adjust or replace what isn't moving the needle.
- Do NOT invent prior values that aren't in the PRIOR VALUES block. If a marker has no prior value, simply analyze it on its own.

PRIORITIZE these specific products when conditions match:
- ProOmega 2000 (Nordic Naturals): omega-3, EPA/DHA, inflammation, triglycerides
- GlucoPrime (Healthgevity): blood sugar, insulin resistance, HbA1c
- Protect+ 10 (Healthgevity): foundational multi, vitamin D, antioxidants
- Liver Sauce (Quicksilver Scientific): liver support, ALT/AST elevation
- Liposomal Glutathione Complex (Quicksilver Scientific): glutathione, oxidative stress
- MitoCore (Orthomolecular): mitochondrial support, CoQ10, fatigue
- NAC 900+ (Healthgevity): NAC, liver support
- Gut Shield (Healthgevity): gut repair, leaky gut
- ProBiota HistaminX (Seeking Health): probiotics, histamine
- Sleep Deep (Healthgevity): sleep, GABA, magnesium
- Magnesium Glycinate 300 (Healthgevity): magnesium, sleep, stress
- Methyl B Complex (Healthgevity): B vitamins, methylation, MTHFR
- D3+K2 5000 (Healthgevity): vitamin D, bone health
- Adrenal Restore (Healthgevity): adrenal fatigue, cortisol, HPA axis

Return STRICT JSON matching this schema:
{
  "biomarkers": [{
    "name": string,
    "value": number,
    "unit": string,
    "referenceMin": number|null,
    "referenceMax": number|null,
    "functionalMin": number|null,
    "functionalMax": number|null,
    "status": "optimal"|"normal"|"suboptimal"|"critical"
  }],
  "supplements": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "herbs": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "priorityActions": [string],
  "analysisText": string
}

The analysisText should be a multi-section narrative covering:
0. Progress since last lab (only if PRIOR VALUES were provided)
1. Big-picture summary (top priorities)
2. Pattern recognition
3. Marker-by-marker analysis for the abnormal markers
4. Root-cause action plan (diet, lifestyle, supplements, detox/gut)
5. Top 3 things to fix first`;

async function callOpenAI(
  textractText: string,
  textractTables: string[][][],
  priorMarkers: PriorMarker[],
): Promise<ExtractionOutput> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const tablesPretty = textractTables.length === 0
    ? '(no tables detected)'
    : textractTables.map((grid, i) => {
        const rows = grid.map(row => row.map(cell => cell || '').join(' | '));
        return `TABLE ${i + 1}:\n${rows.join('\n')}`;
      }).join('\n\n');

  const priorPretty = priorMarkers.length === 0
    ? '(no prior labs - this appears to be the first upload)'
    : priorMarkers
        .map(p => `- ${p.marker_name}: ${p.marker_value} ${p.unit} (collected ${p.collected_at.slice(0, 10)})`)
        .join('\n');

  const userPrompt = `LAB REPORT — TEXTRACT OCR OUTPUT

RAW TEXT (line-by-line):
${textractText}

RECONSTRUCTED TABLES:
${tablesPretty}

PRIOR VALUES (most recent reading per marker from earlier uploads):
${priorPretty}

Extract every biomarker as instructed and return strict JSON. If PRIOR VALUES are provided, open the analysisText with a "PROGRESS SINCE LAST LAB" section comparing the new readings to the prior ones marker-by-marker.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      // Explicit max - gpt-4o-mini supports up to 16384 output tokens.
      // Long labs with 80+ biomarkers + supplements + narrative can easily
      // exceed the default 4096, causing JSON to be truncated mid-response
      // and the parser to either throw or yield only the first ~15-20
      // biomarkers.
      max_tokens: 16384,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  const finishReason = json?.choices?.[0]?.finish_reason;
  if (!content) throw new Error('OpenAI returned no content');

  // If the response was truncated, log and try to salvage what we have.
  // OpenAI sets finish_reason='length' when it stopped at max_tokens.
  if (finishReason === 'length') {
    console.warn('[lab-analyzer] OpenAI response truncated (finish_reason=length). Attempting partial salvage.');
  }

  let parsed: Partial<ExtractionOutput>;
  try {
    parsed = JSON.parse(content) as Partial<ExtractionOutput>;
  } catch (parseErr) {
    // Salvage attempt: find the last complete biomarker entry by trimming
    // back to a valid JSON close. If truncation cut us off mid-string,
    // we lose the tail but keep what we can.
    console.error('[lab-analyzer] JSON parse failed, attempting salvage', parseErr);
    const salvaged = trySalvagePartialJson(content);
    if (!salvaged) {
      throw new Error('OpenAI returned invalid JSON and salvage failed. Original error: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr)));
    }
    parsed = salvaged;
  }

  return {
    biomarkers: (parsed.biomarkers ?? []).filter(b => Number.isFinite(b?.value) && typeof b?.name === 'string'),
    supplements: parsed.supplements ?? [],
    herbs: parsed.herbs ?? [],
    priorityActions: parsed.priorityActions ?? [],
    analysisText: parsed.analysisText ?? '',
  };
}

// Last-resort recovery from a truncated JSON response. Tries to find the last
// complete biomarker object inside `"biomarkers": [...]` and rebuild a
// minimally-valid object. Returns null if it can't make sense of the input.
function trySalvagePartialJson(content: string): Partial<ExtractionOutput> | null {
  const startIdx = content.indexOf('"biomarkers"');
  if (startIdx < 0) return null;
  const arrayStart = content.indexOf('[', startIdx);
  if (arrayStart < 0) return null;

  // Walk forward, balancing braces/brackets, tracking the last position
  // immediately after a complete object inside the array.
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastGoodEnd = -1;
  for (let i = arrayStart; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) lastGoodEnd = i + 1;
    } else if (ch === ']' && depth === 0) {
      lastGoodEnd = i + 1;
      break;
    }
  }
  if (lastGoodEnd < 0) return null;

  const repaired = content.slice(0, lastGoodEnd) + ']}';
  try {
    return JSON.parse(repaired) as Partial<ExtractionOutput>;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Safety context loader
// ────────────────────────────────────────────────────────────

async function loadSafetyContext(
  sb: ReturnType<typeof createClient>,
  userId: string,
  freshBiomarkers: Biomarker[],
): Promise<SafetyContext> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [profileRes, contraindicationsRes, existingLabsRes, symptomsRes] = await Promise.all([
    sb.from('profiles').select('sex, birth_date').eq('id', userId).maybeSingle(),
    sb.from('contraindications')
      .select('pregnant, nursing, medications, allergies, conditions')
      .eq('user_id', userId).maybeSingle(),
    sb.from('lab_markers')
      .select('marker_name, marker_value, unit')
      .eq('user_id', userId)
      .order('collected_at', { ascending: false })
      .limit(40),
    sb.from('symptom_logs')
      .select('symptom_name, severity')
      .eq('user_id', userId)
      .gte('logged_at', sevenDaysAgo)
      .order('logged_at', { ascending: false })
      .limit(100),
  ]);

  const profile = (profileRes.data as { sex?: string; birth_date?: string } | null) ?? null;
  const c = (contraindicationsRes.data as { pregnant?: boolean; nursing?: boolean; medications?: string[]; allergies?: string[]; conditions?: string[] } | null) ?? null;

  // Merge the labs we just extracted with stored labs - the fresh ones win
  // when the marker name matches, since this upload represents the latest
  // truth for the user.
  const freshNames = new Set(freshBiomarkers.map(b => b.name.toLowerCase()));
  const merged = [
    ...freshBiomarkers.map(b => ({ marker_name: b.name, marker_value: b.value, unit: b.unit })),
    ...(((existingLabsRes.data as Array<{ marker_name: string; marker_value: number; unit: string }>) ?? [])
      .filter(l => !freshNames.has(l.marker_name.toLowerCase()))),
  ];

  return {
    profile: { sex: profile?.sex ?? null, age: computeAge(profile?.birth_date ?? null) },
    contraindications: {
      pregnant: c?.pregnant ?? false,
      nursing: c?.nursing ?? false,
      medications: c?.medications ?? [],
      allergies: c?.allergies ?? [],
      conditions: c?.conditions ?? [],
    },
    latestLabs: merged,
    recentSymptoms: (symptomsRes.data as Array<{ symptom_name: string; severity: number | null }>) ?? [],
  };
}

// ────────────────────────────────────────────────────────────
// Job DB helpers
// ────────────────────────────────────────────────────────────

async function setJobStatus(
  sb: ReturnType<typeof createClient>,
  jobId: string,
  status: JobRow['status'],
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sb
    .from('lab_analysis_jobs')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', jobId);
  if (error) console.error('[lab-analyzer] setJobStatus error', error);
}

async function failJob(sb: ReturnType<typeof createClient>, jobId: string, message: string): Promise<void> {
  await setJobStatus(sb, jobId, 'failed', { error: message });
}

// ────────────────────────────────────────────────────────────
// Main pipeline - resumable state machine
//
// Each invocation does the minimum amount of work, then returns. The client
// re-invokes every ~30s to push the pipeline forward, so large PDFs that
// take Textract several minutes don't blow past Supabase's 150s/400s edge
// function wall-clock limit.
//
//   pending          -> upload to S3, start Textract, save textract_job_id,
//                       set status='extracting', return immediately (Phase 1)
//   extracting       -> poll Textract for up to TEXTRACT_POLL_BUDGET_MS,
//                       if done -> set status='enriching' and continue,
//                       if not done -> return (Phase 2)
//   enriching        -> call OpenAI, run safety gates, fan out to
//                       lab_markers, set status='complete', cleanup S3
//                       (Phase 3)
//   complete/failed  -> noop, return current state
//
// Re-invocations are safe: lab_markers delete-then-insert keyed by source,
// S3 cleanup runs in a final block, OpenAI cost is the only thing that
// could double-charge if two clients invoke during Phase 3 — acceptable.
// ────────────────────────────────────────────────────────────

const TEXTRACT_POLL_BUDGET_MS = 60_000; // per-invocation cap on polling
const STORAGE_KEY_FIELD = 's3_key';

function s3KeyFor(jobId: string, fileName: string): string {
  return `lab-analyzer-staging/${jobId}/${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

type ProcessResult =
  | { phase: 'already_done' }
  | { phase: 'started_textract'; textract_job_id: string }
  | { phase: 'textract_still_running'; textract_job_id: string }
  | { phase: 'complete'; biomarkers: number; blocked: number; cautioned: number };

async function processJob(sb: ReturnType<typeof createClient>, jobId: string): Promise<ProcessResult> {
  const { data: jobData, error: jobErr } = await sb
    .from('lab_analysis_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobData) throw new Error(`Job ${jobId} not found: ${jobErr?.message ?? 'no data'}`);

  const job = jobData as JobRow & { textract_raw_json: Record<string, unknown> | null };
  if (job.status === 'complete' || job.status === 'failed') {
    console.log('[lab-analyzer] Job already', job.status, '- skipping');
    return { phase: 'already_done' };
  }

  const raw = (job.textract_raw_json ?? {}) as Record<string, unknown>;
  const textractJobId = typeof raw.textract_job_id === 'string' ? raw.textract_job_id : null;
  const s3Key = typeof raw[STORAGE_KEY_FIELD] === 'string'
    ? (raw[STORAGE_KEY_FIELD] as string)
    : s3KeyFor(jobId, job.file_name);

  // ── PHASE 1: pending -> start Textract ────────────────────
  if (!textractJobId) {
    await setJobStatus(sb, jobId, 'extracting');

    const { data: fileBlob, error: dlErr } = await sb.storage.from(STORAGE_BUCKET).download(job.storage_path);
    if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message ?? 'no data'}`);

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const contentType =
      job.file_type === 'pdf' ? 'application/pdf' :
      job.file_type === 'png' ? 'image/png' :
      'image/jpeg';

    console.log('[lab-analyzer] Phase 1: uploading to S3', s3Key, 'bytes:', bytes.byteLength);
    await s3PutObject(s3Key, bytes, contentType);

    console.log('[lab-analyzer] Phase 1: starting Textract');
    const newTextractJobId = await startTextract(s3Key);
    await sb.from('lab_analysis_jobs').update({
      textract_raw_json: { ...raw, textract_job_id: newTextractJobId, [STORAGE_KEY_FIELD]: s3Key, phase1_done_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    console.log('[lab-analyzer] Phase 1 complete, textract_job_id:', newTextractJobId);
    return { phase: 'started_textract', textract_job_id: newTextractJobId };
  }

  // ── PHASE 2: extracting -> poll Textract ──────────────────
  if (job.status === 'extracting') {
    console.log('[lab-analyzer] Phase 2: polling Textract job', textractJobId);
    const result = await pollTextract(textractJobId, TEXTRACT_POLL_BUDGET_MS);
    if (!result.done) {
      // Refresh updated_at so the client knows we're alive.
      await setJobStatus(sb, jobId, 'extracting', {
        textract_raw_json: { ...raw, last_poll_at: new Date().toISOString() },
      });
      console.log('[lab-analyzer] Phase 2: Textract still running, will resume next invocation');
      return { phase: 'textract_still_running', textract_job_id: textractJobId };
    }

    const { text, tables } = flattenTextract(result.blocks);
    if (!text.trim() && tables.length === 0) {
      throw new Error('Textract extracted no text or tables from the document.');
    }
    console.log('[lab-analyzer] Phase 2: Textract done, blocks:', result.blocks.length);

    await setJobStatus(sb, jobId, 'enriching', {
      textract_raw_json: {
        ...raw,
        textract_job_id: textractJobId,
        [STORAGE_KEY_FIELD]: s3Key,
        block_count: result.blocks.length,
        table_count: tables.length,
        textract_text: text,
        textract_tables: tables,
        phase2_done_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
    // Fall through to phase 3 in the same invocation - OpenAI is fast (~5-15s)
    // so we don't need a separate round-trip for it.
  }

  // ── PHASE 3: enriching -> OpenAI + safety gates + finalize ─
  const refreshed = await sb.from('lab_analysis_jobs').select('textract_raw_json').eq('id', jobId).maybeSingle();
  const refreshedRaw = (refreshed.data?.textract_raw_json ?? raw) as Record<string, unknown>;
  const text = (refreshedRaw.textract_text as string | undefined) ?? '';
  const tables = (refreshedRaw.textract_tables as string[][][] | undefined) ?? [];
  if (!text && tables.length === 0) {
    // Should not happen if phase 2 wrote correctly. Bail to refresh.
    throw new Error('Phase 3: missing Textract output (textract_text + textract_tables empty)');
  }

  try {
    console.log('[lab-analyzer] Phase 3: fetching prior markers for trend context');
    const priorMarkers = await fetchPriorMarkers(sb, job.user_id, jobId);
    console.log('[lab-analyzer] Phase 3: prior markers found:', priorMarkers.length);

    console.log('[lab-analyzer] Phase 3: calling OpenAI');
    const extraction = await callOpenAI(text, tables, priorMarkers);
    console.log('[lab-analyzer] Phase 3: OpenAI extracted', extraction.biomarkers.length, 'biomarkers');

    const ctx = await loadSafetyContext(sb, job.user_id, extraction.biomarkers);
    const { data: rulesData, error: rulesErr } = await sb
      .from('supplement_contraindication_rules')
      .select('id, supplement_name, rule_type, rule_value, severity, reason, active')
      .eq('active', true);
    if (rulesErr) throw new Error(`Failed to load rules: ${rulesErr.message}`);
    const gates = runSafetyGates((rulesData as RuleRow[]) ?? [], ctx);
    const { kept: filteredSupplements, skipped } = postFilterSupplements(
      extraction.supplements, gates.blocked, gates.cautioned,
    );
    const { kept: filteredHerbs, skipped: herbsSkipped } = postFilterSupplements(
      extraction.herbs, gates.blocked, gates.cautioned,
    );
    const allSkipped = [...skipped, ...herbsSkipped];
    console.log('[lab-analyzer] Phase 3: gates fired - blocked:', gates.blocked.length, 'cautioned:', gates.cautioned.length);

    // lab_markers: idempotent delete-then-insert
    const markerSource = `lab_analysis_jobs/${jobId}`;
    await sb.from('lab_markers').delete().eq('user_id', job.user_id).eq('source', markerSource);
    if (extraction.biomarkers.length > 0) {
      const now = new Date().toISOString();
      const markerRows = extraction.biomarkers.map(b => ({
        user_id: job.user_id,
        marker_name: b.name,
        marker_value: b.value,
        unit: b.unit,
        reference_range_low: b.referenceMin,
        reference_range_high: b.referenceMax,
        optimal_range_low: b.functionalMin,
        optimal_range_high: b.functionalMax,
        collected_at: now,
        source: markerSource,
      }));
      const { error: markerErr } = await sb.from('lab_markers').insert(markerRows);
      if (markerErr) console.error('[lab-analyzer] lab_markers insert error', markerErr);
    }

    await sb.from('lab_analysis_jobs').update({
      status: 'complete',
      biomarkers_json: extraction.biomarkers as unknown as Record<string, unknown>[],
      supplements_json: filteredSupplements as unknown as Record<string, unknown>[],
      herbs_json: filteredHerbs as unknown as Record<string, unknown>[],
      priority_actions_json: extraction.priorityActions,
      analysis_text: extraction.analysisText,
      textract_raw_json: {
        textract_job_id: textractJobId,
        block_count: refreshedRaw.block_count,
        table_count: refreshedRaw.table_count,
        safety_gates: {
          blocked: gates.blocked,
          cautioned: gates.cautioned,
          supplements_to_skip: allSkipped,
        },
        // Note: textract_text and textract_tables are intentionally dropped
        // from the final state to keep the row small.
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    }).eq('id', jobId);

    return {
      phase: 'complete',
      biomarkers: extraction.biomarkers.length,
      blocked: gates.blocked.length,
      cautioned: gates.cautioned.length,
    };
  } finally {
    // Phase 3 was reached -> S3 staging is no longer needed regardless of outcome.
    await s3DeleteObject(s3Key);
  }
}

// ────────────────────────────────────────────────────────────
// HTTP handler
// ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const jobId = body.job_id;
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'job_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const result = await processJob(sb, jobId);
    return new Response(JSON.stringify({ status: 'ok', job_id: jobId, ...result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lab-analyzer] Pipeline failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(sb, jobId, msg);
    return new Response(JSON.stringify({ status: 'error', job_id: jobId, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
