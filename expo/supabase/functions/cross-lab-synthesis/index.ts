/**
 * Supabase Edge Function: Cross-Lab Synthesis
 *
 * Pulls all of a user's lab_markers + lab_analysis_jobs metadata, groups
 * them by upload (which is typically one panel type per upload, e.g.
 * Blood Labs / Dutch / GI Map / Total Tox), then asks an LLM to find
 * functional-medicine patterns that span multiple test types.
 *
 * Why a separate function from daily-coach:
 *   - daily-coach reads only the most-recent 40 markers and is meant
 *     for daily synthesis. Cross-lab synthesis wants ALL markers across
 *     ALL panels and is much heavier.
 *   - The user invokes this on demand from the labs tab; the result
 *     is cached client-side via React Query.
 *
 * Returns:
 *   {
 *     status: 'ok',
 *     panelCount: number,
 *     patterns: string[],          // bullet-list of cross-test patterns
 *     narrative: string,           // long-form clinical synthesis
 *     generatedAt: string          // ISO timestamp
 *   }
 *
 * Deploy: supabase functions deploy cross-lab-synthesis
 * Invoke: supabase.functions.invoke('cross-lab-synthesis', {})
 *         (userId resolved from JWT)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

interface MarkerRow {
  marker_name: string;
  marker_value: number;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
  optimal_range_low: number | null;
  optimal_range_high: number | null;
  collected_at: string;
  source: string | null;
}

interface JobRow {
  id: string;
  file_name: string;
  completed_at: string | null;
  created_at: string;
}

// ────────────────────────────────────────────────────────────
// Heuristic panel-type guess from filename
// ────────────────────────────────────────────────────────────

function guessPanelType(fileName: string): string {
  const f = fileName.toLowerCase();
  if (f.includes('dutch')) return 'Dutch (urine hormone metabolites)';
  if (f.includes('gi') && (f.includes('map') || f.includes('stool'))) return 'GI Map (stool / microbiome)';
  if (f.includes('tox') || f.includes('mycotox') || f.includes('mold')) return 'Total Tox / mycotoxin panel';
  if (f.includes('hormone')) return 'Hormone panel';
  if (f.includes('thyroid')) return 'Thyroid panel';
  if (f.includes('omx') || f.includes('organic')) return 'Organic Acids (OMX / OAT)';
  if (f.includes('food sensitivity') || f.includes('mrt')) return 'Food sensitivity panel';
  if (f.includes('hair')) return 'Hair tissue mineral analysis';
  return 'Blood lab panel';
}

interface PanelGroup {
  jobId: string;
  fileName: string;
  panelType: string;
  collectedAt: string;
  markers: MarkerRow[];
}

function groupMarkersByPanel(markers: MarkerRow[], jobs: JobRow[]): PanelGroup[] {
  const jobsById = new Map<string, JobRow>();
  for (const j of jobs) jobsById.set(j.id, j);

  const groups = new Map<string, PanelGroup>();
  // markers without a job-source bucket go into a "manual" bucket
  for (const m of markers) {
    const sourceMatch = m.source?.match(/^lab_analysis_jobs\/(.+)$/);
    const jobId = sourceMatch ? sourceMatch[1] : 'manual';
    if (!groups.has(jobId)) {
      const job = jobsById.get(jobId);
      groups.set(jobId, {
        jobId,
        fileName: job?.file_name ?? (jobId === 'manual' ? 'Manual entry' : `Job ${jobId.slice(0, 8)}`),
        panelType: job?.file_name ? guessPanelType(job.file_name) : 'Unknown panel',
        collectedAt: job?.completed_at ?? job?.created_at ?? m.collected_at,
        markers: [],
      });
    }
    groups.get(jobId)!.markers.push(m);
  }
  // Sort groups newest-first
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime(),
  );
}

// ────────────────────────────────────────────────────────────
// LLM
// ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a functional-medicine and longevity physician synthesizing multiple lab panels for a single patient.

You receive a series of panels (each one labelled with its panel type and the markers it contains). Your job is to find patterns that ONLY become visible when you read the panels TOGETHER. Examples of cross-panel patterns to look for:

- HPA axis dysregulation: Dutch cortisol pattern + low DHEA-S (blood) + low energy / fatigue symptoms
- Insulin resistance + estrogen dominance: high HOMA-IR / fasting insulin (blood) + 4-OH and 16-OH estrogen metabolites elevated (Dutch) + low SHBG
- Gut-driven systemic inflammation: high zonulin / low secretory IgA (GI Map) + high hs-CRP (blood) + elevated histamine
- Mycotoxin → mitochondrial dysfunction: positive mycotoxins (Tox panel) + low CoQ10 / suppressed organic acids (OMX) + high oxidative stress markers
- Thyroid resistance: normal TSH (blood) + low free T3 + high reverse T3 + cortisol elevation (Dutch)
- Methylation block: high homocysteine (blood) + elevated formate / low methylmalonic acid (OMX)
- Detox bottleneck: high glucuronate / orotate (OMX) + low glutathione / high oxidative stress + sluggish phase II clearance

For each pattern you find, list:
- the SPECIFIC markers (with values and which panel they came from) that support it
- the clinical implication
- a concrete root-cause action

Return STRICT JSON in this shape:
{
  "patterns": [string],
  "narrative": string
}

patterns: 3-8 short bullets, each one a single cross-panel pattern with its supporting evidence inline. Example: "HPA axis dysregulation: morning cortisol 18 ng/mL (Dutch) + DHEA-S 90 ug/dL (blood) + persistent low-energy symptoms — suggests chronic stress with adrenal output uncoupling."

narrative: 4-8 paragraphs of integrated clinical synthesis. Open with the highest-impact cross-panel pattern, then walk through 2-3 more, finishing with a prioritized action plan that explicitly references which panel(s) drove which recommendation.

If only ONE panel is present, return patterns=[] and narrative="Single panel detected — cross-lab synthesis requires at least 2 different panels (e.g., blood + Dutch + GI Map). Please upload additional panels for cross-test pattern detection."`;

interface LLMOutput {
  patterns: string[];
  narrative: string;
}

async function callLLM(groups: PanelGroup[]): Promise<LLMOutput> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const panelBlock = groups
    .map((g, i) => {
      const markersText = g.markers
        .map(m => {
          const ref = (m.reference_range_low != null || m.reference_range_high != null)
            ? ` (ref ${m.reference_range_low ?? '?'}–${m.reference_range_high ?? '?'})`
            : '';
          const opt = (m.optimal_range_low != null || m.optimal_range_high != null)
            ? ` [optimal ${m.optimal_range_low ?? '?'}–${m.optimal_range_high ?? '?'}]`
            : '';
          return `  - ${m.marker_name}: ${m.marker_value} ${m.unit}${ref}${opt}`;
        })
        .join('\n');
      return `PANEL ${i + 1}: ${g.panelType}
Source: ${g.fileName}
Collected: ${g.collectedAt.slice(0, 10)}
Markers (${g.markers.length}):
${markersText}`;
    })
    .join('\n\n');

  const userPrompt = `${groups.length} lab panel${groups.length === 1 ? '' : 's'} for synthesis:

${panelBlock}

Find cross-panel patterns and produce strict JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as Partial<LLMOutput>;
  return {
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((s: unknown) => typeof s === 'string') : [],
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
  };
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

  let body: { userId?: string };
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  // Resolve userId from explicit body or from caller's JWT.
  let userId = body.userId;
  if (!userId) {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      userId = userData?.user?.id ?? undefined;
    }
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required (body or auth)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const [markersRes, jobsRes] = await Promise.all([
      sb.from('lab_markers')
        .select('marker_name, marker_value, unit, reference_range_low, reference_range_high, optimal_range_low, optimal_range_high, collected_at, source')
        .eq('user_id', userId)
        .order('collected_at', { ascending: false })
        .limit(500),
      sb.from('lab_analysis_jobs')
        .select('id, file_name, completed_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'complete')
        .order('completed_at', { ascending: false }),
    ]);

    const markers = (markersRes.data as MarkerRow[] | null) ?? [];
    const jobs = (jobsRes.data as JobRow[] | null) ?? [];

    if (markers.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'ok',
          panelCount: 0,
          patterns: [],
          narrative: 'No lab markers found yet. Upload at least 2 different panels (e.g., blood + Dutch) to enable cross-lab synthesis.',
          generatedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const groups = groupMarkersByPanel(markers, jobs);
    console.log(`[cross-lab-synthesis] ${userId}: ${groups.length} panels, ${markers.length} markers`);

    const llmOutput = await callLLM(groups);

    return new Response(
      JSON.stringify({
        status: 'ok',
        panelCount: groups.length,
        patterns: llmOutput.patterns,
        narrative: llmOutput.narrative,
        generatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[cross-lab-synthesis] failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ status: 'error', error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
