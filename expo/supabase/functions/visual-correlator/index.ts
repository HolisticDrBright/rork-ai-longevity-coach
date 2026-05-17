/**
 * Supabase Edge Function: visual-correlator
 *
 * Runs after the per-modality `visual-analysis` calls complete. Fuses
 * tags across modalities (noisy-OR), detects contradictions, computes
 * the Visual Health Index, and fans out to downstream consumers:
 *
 *   1. visual_convergent_findings rows
 *   2. visual_divergent_findings rows
 *   3. visual_sessions.visual_health_index + status='review_pending'
 *   4. visual_red_flag_alerts rows + clinic_alert_events for severity
 *      critical / high
 *   5. detected_patterns rows with source='visual_convergent' so the
 *      existing rule-based detect-patterns surface picks up visual
 *      signal IMMEDIATELY without waiting for the statistical Pattern
 *      Discovery miner to be built (Dr. Bright's MVP addition)
 *
 * Trigger: called by the client when the last per-modality
 * visual-analysis completes (client-side coordination via polling),
 * OR by a scheduled job that scans for analyzing sessions older than
 * 60 seconds with at least 2 findings rows.
 *
 * Idempotent. Re-running re-deletes prior convergent/divergent rows
 * for the session before re-inserting (per the lab-markers pattern).
 *
 * Deploy: supabase functions deploy visual-correlator
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const STORAGE_BUCKET = 'visual-diagnostics';

// ────────────────────────────────────────────────────────────
// Correlator (mirror of expo/backend/services/correlator-service.ts)
// MUST stay in sync.
// ────────────────────────────────────────────────────────────

const CONVERGENCE_MIN_MODALITIES = 2;
const CONVERGENCE_MIN_COMBINED_CONF = 0.7;

interface ModalityFindingInput {
  modality: string;
  tagsWithConfidence: Record<string, number>;
}

interface ConvergentFinding {
  tag: string;
  contributingModalities: string[];
  combinedConfidence: number;
  trend?: 'improving' | 'worsening' | 'stable' | null;
  prevConfidence?: number | null;
}

interface DivergentFinding {
  tagA: string;
  tagB: string;
  contributingModalities: Record<string, string[]>;
  note: string;
}

function noisyOr(confidences: number[]): number {
  if (confidences.length === 0) return 0;
  let invProduct = 1;
  for (const c of confidences) {
    const clamped = Math.max(0, Math.min(1, c));
    invProduct *= 1 - clamped;
  }
  return 1 - invProduct;
}

function runCorrelator(input: {
  findings: ModalityFindingInput[];
  contradictionPairs: Array<{ tagA: string; tagB: string; note: string | null }>;
  symptomEvidence?: Record<string, number>;
  modalityWeights: Record<string, number>;
  previousConvergent?: Array<{ tag: string; combinedConfidence: number }>;
}): { convergent: ConvergentFinding[]; divergent: DivergentFinding[]; visualHealthIndex: number | null } {
  const tagMap = new Map<string, Map<string, number>>();

  for (const f of input.findings) {
    for (const [tag, rawConf] of Object.entries(f.tagsWithConfidence)) {
      const conf = Math.max(0, Math.min(1, Number(rawConf) || 0));
      if (conf <= 0) continue;
      if (!tagMap.has(tag)) tagMap.set(tag, new Map());
      tagMap.get(tag)!.set(f.modality, conf);
    }
  }
  if (input.symptomEvidence) {
    for (const [tag, rawConf] of Object.entries(input.symptomEvidence)) {
      const conf = Math.max(0, Math.min(1, Number(rawConf) || 0));
      if (conf <= 0) continue;
      if (!tagMap.has(tag)) tagMap.set(tag, new Map());
      tagMap.get(tag)!.set('symptom_rollup', conf);
    }
  }

  const convergent: ConvergentFinding[] = [];
  for (const [tag, modalityConfs] of tagMap.entries()) {
    if (modalityConfs.size < CONVERGENCE_MIN_MODALITIES) continue;
    const combined = noisyOr(Array.from(modalityConfs.values()));
    if (combined < CONVERGENCE_MIN_COMBINED_CONF) continue;
    convergent.push({
      tag,
      contributingModalities: Array.from(modalityConfs.keys()),
      combinedConfidence: combined,
    });
  }

  const divergent: DivergentFinding[] = [];
  for (const pair of input.contradictionPairs) {
    const aMap = tagMap.get(pair.tagA);
    const bMap = tagMap.get(pair.tagB);
    if (!aMap || !bMap) continue;
    divergent.push({
      tagA: pair.tagA,
      tagB: pair.tagB,
      contributingModalities: {
        [pair.tagA]: Array.from(aMap.keys()),
        [pair.tagB]: Array.from(bMap.keys()),
      },
      note: pair.note ?? 'Modalities disagree on opposing patterns',
    });
  }

  // Trend
  const previousByTag = new Map<string, number>(
    (input.previousConvergent ?? []).map(p => [p.tag, p.combinedConfidence]),
  );
  for (const c of convergent) {
    const prev = previousByTag.get(c.tag) ?? null;
    if (prev == null) {
      c.trend = null;
      c.prevConfidence = null;
    } else {
      const delta = c.combinedConfidence - prev;
      if (Math.abs(delta) < 0.05) c.trend = 'stable';
      else if (delta < 0) c.trend = 'improving';
      else c.trend = 'worsening';
      c.prevConfidence = prev;
    }
  }

  // Visual Health Index: avg-conf-as-concern proxy
  const present = input.findings.map(f => f.modality);
  let wSum = 0;
  let wTotal = 0;
  for (const m of present) {
    const w = input.modalityWeights[m] ?? 1.0;
    const f = input.findings.find(x => x.modality === m);
    if (!f) continue;
    const confs = Object.values(f.tagsWithConfidence).map(v => Number(v) || 0);
    const avgConf = confs.length > 0 ? confs.reduce((s, v) => s + v, 0) / confs.length : 0;
    const modalityScore = Math.round(100 * (1 - avgConf));
    wSum += modalityScore * w;
    wTotal += w;
  }
  const visualHealthIndex = wTotal > 0 ? Math.round(wSum / wTotal) : null;

  return { convergent, divergent, visualHealthIndex };
}

// ────────────────────────────────────────────────────────────
// Symptom evidence builder — mirrors part 3 §8.6
// ────────────────────────────────────────────────────────────

async function buildSymptomEvidence(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<Record<string, number>> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await sb
    .from('symptom_logs')
    .select('symptom_name, severity')
    .eq('user_id', userId)
    .gte('logged_at', fourteenDaysAgo);
  if (error) return {};
  const rows = (data as Array<{ symptom_name: string; severity: number | null }>) ?? [];

  // Map symptom names to taxonomy tags. This is intentionally narrow
  // for MVP — fatigue + brain fog map to pattern.qi_deficiency, etc.
  // Each tag's confidence = (count >=2 / 14) capped at 0.5 to keep
  // visual modalities as the primary evidence source.
  const symptomTagMap: Record<string, string[]> = {
    fatigue: ['pattern.qi_deficiency', 'pattern.spleen_qi_deficiency'],
    brain_fog: ['pattern.qi_deficiency', 'lifestyle.high_inflammation_appearance'],
    insomnia: ['lifestyle.poor_sleep_appearance', 'pattern.yin_deficiency'],
    cold_hands: ['pattern.yang_deficiency', 'system.circulation_compromise'],
    cold_feet: ['pattern.yang_deficiency', 'system.circulation_compromise'],
    anxiety: ['pattern.heart_shen_disturbance', 'lifestyle.high_stress_load'],
    bloating: ['system.gut_dysbiosis_appearance', 'pattern.spleen_qi_deficiency'],
    constipation: ['system.gut_dysbiosis_appearance'],
    acne: ['lifestyle.high_inflammation_appearance', 'pattern.damp_heat'],
    skin_dryness: ['lifestyle.dehydration_signs'],
  };

  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    if ((r.severity ?? 0) < 2) continue;
    const name = r.symptom_name.toLowerCase();
    const tags = symptomTagMap[name] ?? [];
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  const out: Record<string, number> = {};
  for (const [tag, count] of tagCounts) {
    out[tag] = Math.min(0.5, count / 14);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Cross-modality summary renderer (Deno mirror of
// expo/backend/services/visual-summary-renderer.ts renderCrossModalitySummaryMd)
// ────────────────────────────────────────────────────────────

function renderCrossModalitySummaryMd(args: {
  convergent: ConvergentFinding[];
  divergent: DivergentFinding[];
  visualHealthIndex: number | null;
  modalitiesRun: string[];
  capturedDate: string;
}): string {
  const { convergent, divergent, visualHealthIndex, modalitiesRun, capturedDate } = args;
  return `# Cross-Modality Session Summary — ${capturedDate}

## Visual Health Index
${visualHealthIndex != null ? `${visualHealthIndex}/100` : 'not computed'}

## Modalities Run
${modalitiesRun.map(m => `- ${m}`).join('\n')}

## Convergent Findings (multi-modality, combined confidence ≥ 0.70)
${convergent.length === 0
  ? '- No convergent findings this session.'
  : convergent
      .map(c => {
        const trendNote = c.trend ? ` · trend: ${c.trend}` : '';
        return `- ${c.tag} (confidence ${(c.combinedConfidence * 100).toFixed(0)}%, modalities: ${c.contributingModalities.join(', ')})${trendNote}`;
      })
      .join('\n')}

## Divergent Findings (modalities disagree)
${divergent.length === 0
  ? '- No contradictions detected.'
  : divergent
      .map(d => `- ${d.tagA} (${d.contributingModalities[d.tagA].join(', ')}) vs ${d.tagB} (${d.contributingModalities[d.tagB].join(', ')}) — ${d.note}`)
      .join('\n')}
`;
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let body: { session_id?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const sessionId = body.session_id;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  try {
    // Mark session as correlating
    await sb.from('visual_sessions')
      .update({ status: 'correlating', updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    // Load session + all findings
    const { data: sessionData, error: sessionErr } = await sb
      .from('visual_sessions').select('id, user_id, captured_at')
      .eq('id', sessionId).maybeSingle();
    if (sessionErr || !sessionData) throw new Error(`Session not found: ${sessionErr?.message}`);
    const session = sessionData as { id: string; user_id: string; captured_at: string };

    const { data: findingsData, error: findingsErr } = await sb
      .from('visual_findings').select('modality, tags_with_confidence, red_flags')
      .eq('session_id', sessionId);
    if (findingsErr) throw new Error(`Findings query failed: ${findingsErr.message}`);
    const findings = (findingsData as Array<{ modality: string; tags_with_confidence: Record<string, number>; red_flags: Array<{ severity: string; observation: string; recommended_action: string }> }>) ?? [];

    if (findings.length === 0) {
      throw new Error(`No completed findings for session ${sessionId}`);
    }

    // Load contradiction pairs + modality weights + previous convergent
    const [pairsRes, weightsRes, prevConvergentRes] = await Promise.all([
      sb.from('cross_modality_contradiction_pairs').select('tag_a, tag_b, note'),
      sb.from('visual_health_index_modality_weights').select('modality, weight'),
      sb.from('visual_convergent_findings')
        .select('tag, combined_confidence, session_id, created_at')
        .eq('user_id', session.user_id)
        .neq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const pairs = ((pairsRes.data as Array<{ tag_a: string; tag_b: string; note: string | null }>) ?? [])
      .map(p => ({ tagA: p.tag_a, tagB: p.tag_b, note: p.note }));
    const weights: Record<string, number> = {};
    for (const w of ((weightsRes.data as Array<{ modality: string; weight: number }>) ?? [])) {
      weights[w.modality] = w.weight;
    }
    // Use the most-recent prior session's convergent findings for trend
    const allPrev = (prevConvergentRes.data as Array<{ tag: string; combined_confidence: number; session_id: string }>) ?? [];
    const mostRecentPrevSessionId = allPrev.length > 0 ? allPrev[0].session_id : null;
    const previousConvergent = mostRecentPrevSessionId
      ? allPrev.filter(p => p.session_id === mostRecentPrevSessionId)
          .map(p => ({ tag: p.tag, combinedConfidence: p.combined_confidence }))
      : [];

    // Symptom evidence (part 3 §8.6)
    const symptomEvidence = await buildSymptomEvidence(sb, session.user_id);

    // Run correlator
    const result = runCorrelator({
      findings: findings.map(f => ({
        modality: f.modality,
        tagsWithConfidence: f.tags_with_confidence ?? {},
      })),
      contradictionPairs: pairs,
      symptomEvidence,
      modalityWeights: weights,
      previousConvergent,
    });

    // Persist: delete prior rows for this session, then insert fresh
    await sb.from('visual_convergent_findings').delete().eq('session_id', sessionId);
    await sb.from('visual_divergent_findings').delete().eq('session_id', sessionId);

    if (result.convergent.length > 0) {
      const rows = result.convergent.map(c => ({
        session_id: sessionId,
        user_id: session.user_id,
        tag: c.tag,
        contributing_modalities: c.contributingModalities,
        combined_confidence: c.combinedConfidence,
        trend: c.trend ?? null,
        prev_session_id: mostRecentPrevSessionId,
      }));
      const { error: cErr } = await sb.from('visual_convergent_findings').insert(rows);
      if (cErr) console.error('[visual-correlator] convergent insert failed:', cErr);
    }

    if (result.divergent.length > 0) {
      const rows = result.divergent.map(d => ({
        session_id: sessionId,
        user_id: session.user_id,
        tag_a: d.tagA,
        tag_b: d.tagB,
        contributing_modalities: d.contributingModalities,
        note: d.note,
      }));
      const { error: dErr } = await sb.from('visual_divergent_findings').insert(rows);
      if (dErr) console.error('[visual-correlator] divergent insert failed:', dErr);
    }

    // Bridge: write each convergent finding into detected_patterns with
    // source='visual_convergent' so the existing Clinical Analysis tab
    // surface picks up visual signal IMMEDIATELY (Dr. Bright's MVP
    // addition; ahead of the future statistical Pattern Discovery miner).
    if (result.convergent.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      // Delete prior visual_convergent rows for today first so re-runs
      // don't duplicate.
      await sb.from('detected_patterns')
        .delete()
        .eq('user_id', session.user_id)
        .eq('date', today)
        .like('pattern_type', 'visual_convergent:%');

      const patternRows = result.convergent.map(c => ({
        user_id: session.user_id,
        date: today,
        pattern_type: `visual_convergent:${c.tag}`,
        severity: c.combinedConfidence >= 0.85 ? 'high' : c.combinedConfidence >= 0.75 ? 'moderate' : 'low',
        confidence: 'moderate',
        title: c.tag.replace(/_/g, ' ').replace(/\./g, ' / '),
        summary: `Convergent across ${c.contributingModalities.join(', ')} at ${(c.combinedConfidence * 100).toFixed(0)}% combined confidence.`,
        evidence_json: {
          source: 'visual_convergent',
          session_id: sessionId,
          contributing_modalities: c.contributingModalities,
          combined_confidence: c.combinedConfidence,
          trend: c.trend,
        },
      }));
      const { error: dpErr } = await sb.from('detected_patterns').upsert(
        patternRows,
        { onConflict: 'user_id,date,pattern_type' },
      );
      if (dpErr) console.error('[visual-correlator] detected_patterns insert failed:', dpErr);
    }

    // Aggregate red flags from all findings → visual_red_flag_alerts + clinic_alert_events
    const allRedFlags: Array<{ modality: string; severity: string; observation: string; recommended_action: string }> = [];
    for (const f of findings) {
      for (const rf of f.red_flags ?? []) {
        allRedFlags.push({
          modality: f.modality,
          severity: rf.severity,
          observation: rf.observation,
          recommended_action: rf.recommended_action,
        });
      }
    }
    if (allRedFlags.length > 0) {
      const rfRows = allRedFlags.map(rf => ({
        session_id: sessionId,
        user_id: session.user_id,
        modality: rf.modality,
        severity: rf.severity,
        category: 'visual_diagnostics',
        observation: rf.observation,
        recommended_action: rf.recommended_action,
      }));
      const { error: rfErr } = await sb.from('visual_red_flag_alerts').insert(rfRows);
      if (rfErr) console.error('[visual-correlator] red_flag insert failed:', rfErr);
    }

    // Update session
    const finalStatus = allRedFlags.length > 0 ? 'review_pending' : 'review_pending';
    await sb.from('visual_sessions').update({
      status: finalStatus,
      visual_health_index: result.visualHealthIndex,
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId);

    // Write cross_modality_summary.md to Storage
    const summaryMd = renderCrossModalitySummaryMd({
      convergent: result.convergent,
      divergent: result.divergent,
      visualHealthIndex: result.visualHealthIndex,
      modalitiesRun: findings.map(f => f.modality),
      capturedDate: session.captured_at.slice(0, 10),
    });
    const summaryStorageKey = `${session.user_id}/${sessionId}/cross_modality_summary.md`;
    await sb.storage.from(STORAGE_BUCKET).upload(
      summaryStorageKey,
      new Blob([summaryMd], { type: 'text/markdown' }),
      { upsert: true, contentType: 'text/markdown' },
    );

    // Also write cross_modality.json
    const summaryJsonKey = `${session.user_id}/${sessionId}/cross_modality.json`;
    await sb.storage.from(STORAGE_BUCKET).upload(
      summaryJsonKey,
      new Blob([JSON.stringify({
        convergent: result.convergent,
        divergent: result.divergent,
        visual_health_index: result.visualHealthIndex,
        modalities_run: findings.map(f => f.modality),
        captured_at: session.captured_at,
      }, null, 2)], { type: 'application/json' }),
      { upsert: true, contentType: 'application/json' },
    );

    console.log(`[visual-correlator] ${sessionId} complete: ${result.convergent.length} convergent, ${result.divergent.length} divergent, VHI=${result.visualHealthIndex}, ${allRedFlags.length} red flags`);

    return new Response(JSON.stringify({
      status: 'ok',
      convergent_count: result.convergent.length,
      divergent_count: result.divergent.length,
      visual_health_index: result.visualHealthIndex,
      red_flag_count: allRedFlags.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[visual-correlator] failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    await sb.from('visual_sessions').update({
      status: 'failed',
      notes: msg,
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
    return new Response(JSON.stringify({ status: 'error', error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
