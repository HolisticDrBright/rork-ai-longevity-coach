// The reasoning pipeline (v2). One runner shared by reasoning.analysis.run and
// labs.extract so any meaningful new data re-reasons the record.
//
// Stages (spec mapping):
//  1-2  gather + validate            5   retrieve history (windowed queries)
//  4    change detection             7   update hypothesis scores
//  8    generate candidates (rules, optional AI)
//  9-10 supporting/contradicting evidence ledger
//  11   data quality + missing data  12   (safety engine lands in Phase 3)
//  14   versioned snapshot + twin systems state
//  15   practitioner review queue

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ClinicalHypothesis, ReasoningSnapshot } from '@/types/reasoning';
import { getServerAiConfig, generateStructured } from '../ai/aiClient';
import { safeRows } from './access';
import { writeAuditEvent } from './audit';
import {
  assessDataQuality,
  detectBiometricChanges,
  detectLabChanges,
  type LabMarkerPoint,
} from './changeDetection';
import { computeSystemsModel } from './healthTwin';
import {
  buildReasoningContext,
  detectContradictions,
  generateRuleHypotheses,
  TWIN_SYSTEM_KEYS,
  type ReasoningContext,
} from './hypothesisRules';
import { mapRowToEvidence, mapRowToHypothesis, mapRowToSnapshot } from './rowMappers';
import { computeSupportScore, diffSnapshots, statusFromScore, toSnapshotEntry } from './scoring';

export const REASONING_PIPELINE_VERSION = '2.0.0';

const aiHypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        name: z.string().min(3).max(160),
        description: z.string().max(1200),
        systems: z.array(z.enum(TWIN_SYSTEM_KEYS)).max(4),
        missingEvidence: z.array(z.string().max(200)).max(5),
        supportRationale: z.array(z.string().max(300)).min(1).max(4),
        confidence: z.number().min(0).max(1),
      })
    )
    .max(3),
});

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

async function loadHypothesesWithEvidence(
  sb: SupabaseClient,
  userId: string
): Promise<ClinicalHypothesis[]> {
  const rows = await safeRows(
    sb
      .from('clinical_hypotheses')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'archived')
      .order('support_score', { ascending: false }),
    'hypotheses'
  );
  const hypotheses = rows.map(mapRowToHypothesis);
  if (hypotheses.length === 0) return [];
  const evidenceRows = await safeRows(
    sb
      .from('evidence_items')
      .select('*')
      .eq('user_id', userId)
      .in('hypothesis_id', hypotheses.map((h) => h.id)),
    'evidence'
  );
  const evidence = evidenceRows.map(mapRowToEvidence);
  for (const h of hypotheses) {
    h.supportingEvidence = evidence.filter((e) => e.hypothesisId === h.id && e.direction === 'supports');
    h.contradictingEvidence = evidence.filter((e) => e.hypothesisId === h.id && e.direction === 'contradicts');
  }
  return hypotheses;
}

interface CandidateHypothesis {
  code: string;
  name: string;
  description: string;
  systems: string[];
  missingEvidence: string[];
  sourceType: 'rule_engine' | 'ai_inference';
  evidence: { summary: string; strength: number; evidenceType: string; observedAt?: string }[];
}

async function persistCandidates(
  sb: SupabaseClient,
  userId: string,
  actorId: string,
  candidates: CandidateHypothesis[],
  existingCodes: Set<string>
): Promise<string[]> {
  const created: string[] = [];
  for (const c of candidates) {
    if (existingCodes.has(c.code)) continue;
    const { data, error } = await sb
      .from('clinical_hypotheses')
      .insert({
        user_id: userId,
        code: c.code,
        name: c.name,
        description: c.description,
        status: 'proposed',
        support_score: 50,
        systems: c.systems,
        missing_evidence: c.missingEvidence,
        source_type: c.sourceType,
        review_status: 'pending_review',
        created_by: actorId,
        earliest_supporting_at: c.evidence[0]?.observedAt ?? null,
      })
      .select('*')
      .single();
    if (error || !data) {
      console.log(`[Reasoning] failed to persist hypothesis ${c.code}: ${error?.code ?? 'unknown'}`);
      continue;
    }
    const hypothesisId = String(data.id);
    existingCodes.add(c.code);
    created.push(c.name);

    for (const e of c.evidence) {
      await sb.from('evidence_items').insert({
        user_id: userId,
        hypothesis_id: hypothesisId,
        direction: 'supports',
        evidence_type: e.evidenceType,
        source_type: c.sourceType,
        summary: e.summary,
        strength: e.strength,
        observed_at: e.observedAt ?? null,
        created_by: actorId,
      });
    }

    await sb.from('practitioner_reviews').insert({
      patient_id: userId,
      subject_type: 'hypothesis',
      subject_id: hypothesisId,
      priority: 'routine',
      proposed_summary: `${c.sourceType === 'rule_engine' ? 'Rule engine' : 'AI'} proposed: ${c.name} — ${c.evidence.length} supporting observation(s).`,
      context: { code: c.code, systems: c.systems },
      created_by: actorId,
    });
  }
  return created;
}

async function generateAiCandidates(
  sb: SupabaseClient,
  userId: string,
  actorId: string,
  ctx: ReasoningContext,
  existingNames: string[]
): Promise<CandidateHypothesis[]> {
  const config = getServerAiConfig();
  if (!config) return [];
  if (ctx.markers.length === 0 && ctx.changes.length === 0 && ctx.symptoms.length === 0) return [];

  // PHI-minimized structured summary: clinical values only, no identifiers.
  const summary = {
    flaggedMarkers: ctx.markers
      .filter((m) => (m.low != null && m.value < m.low) || (m.high != null && m.value > m.high))
      .slice(0, 20)
      .map((m) => ({ name: m.name, value: m.value, unit: m.unit ?? null, low: m.low, high: m.high })),
    detectedChanges: ctx.changes.slice(0, 10).map((c) => ({
      metric: c.label,
      direction: c.direction,
      magnitudePercent: c.magnitudePercent,
      severity: c.severity,
    })),
    recentSymptoms: ctx.symptoms.slice(0, 15).map((s) => ({ name: s.name, severity: s.severity })),
    alreadyProposed: existingNames.slice(0, 20),
  };

  const result = await generateStructured({
    config,
    log: {
      sb,
      userId,
      initiatedBy: actorId,
      operation: 'reasoning.hypothesis_generation',
      promptTemplate: 'hypothesis-generation',
      promptVersion: '1.0.0',
      inputRecordIds: {
        markers: summary.flaggedMarkers.length,
        changes: summary.detectedChanges.length,
        symptoms: summary.recentSymptoms.length,
      },
      clinical: true,
    },
    schema: aiHypothesesSchema,
    messages: [
      {
        role: 'system',
        content:
          'You are a clinical-reasoning assistant for a functional-medicine platform. You propose CANDIDATE hypotheses (patterns worth investigating) for practitioner review — never diagnoses. Use cautious pattern language ("...pattern", "...insufficiency pattern"). Only propose hypotheses grounded in the provided data. Do not repeat hypotheses in alreadyProposed. Respond with JSON: {"hypotheses": [{"name", "description", "systems" (subset of: ' +
          TWIN_SYSTEM_KEYS.join(', ') +
          '), "missingEvidence" (what data would confirm or refute), "supportRationale" (observations from the input that support this), "confidence" (0-1)}]}. Propose at most 3; propose zero if the data is unremarkable.',
      },
      { role: 'user', content: JSON.stringify(summary) },
    ],
  });

  if (!result.ok) {
    console.log('[Reasoning] AI hypothesis generation failed validation; continuing without AI candidates');
    return [];
  }

  return result.data.hypotheses.map((h) => ({
    code: `ai:${slug(h.name)}`,
    name: h.name,
    description: h.description,
    systems: h.systems,
    missingEvidence: h.missingEvidence,
    sourceType: 'ai_inference' as const,
    evidence: h.supportRationale.map((r) => ({
      summary: r,
      strength: Math.max(0.1, Math.min(0.6, h.confidence * 0.6)),
      evidenceType: 'observation',
    })),
  }));
}

export interface PipelineResult {
  snapshot: ReasoningSnapshot;
  aiUsed: boolean;
  hypothesesCreated: string[];
  contradictionsRecorded: number;
}

export async function runReasoningPipeline(
  sb: SupabaseClient,
  actor: { id: string },
  userId: string,
  trigger: string
): Promise<PipelineResult> {
  const startedAt = Date.now();

  // ---- Gather ---------------------------------------------------------------
  const [biometricRows, baselineRows, labRows, symptomRows] = await Promise.all([
    safeRows(
      sb.from('daily_biometric_records').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(30),
      'daily_biometric_records'
    ),
    safeRows(
      sb.from('daily_baselines').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(1),
      'daily_baselines'
    ),
    safeRows(
      sb.from('lab_markers').select('*').eq('user_id', userId).order('collected_at', { ascending: false }).limit(200),
      'lab_markers'
    ),
    safeRows(
      sb.from('symptom_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(50),
      'symptom_logs'
    ),
  ]);

  // ---- Change detection -------------------------------------------------------
  const biometricDays = biometricRows.map((r) => ({ ...r, date: String(r.date ?? '') })).reverse();
  const biometricChanges = detectBiometricChanges(biometricDays, baselineRows[0] ?? null);

  const labPoints: LabMarkerPoint[] = labRows
    .map((r) => ({
      markerName: String(r.marker_name ?? ''),
      value: Number(r.marker_value ?? NaN),
      unit: typeof r.unit === 'string' ? r.unit : undefined,
      referenceLow: typeof r.reference_range_low === 'number' ? r.reference_range_low : null,
      referenceHigh: typeof r.reference_range_high === 'number' ? r.reference_range_high : null,
      collectedAt: String(r.collected_at ?? ''),
    }))
    .filter((p) => Number.isFinite(p.value) && p.markerName && p.collectedAt);
  const labChanges = detectLabChanges(labPoints);
  const detectedChanges = [...biometricChanges, ...labChanges];

  // ---- Data quality -----------------------------------------------------------
  const { issues, missing } = assessDataQuality({
    lastWearableDate: biometricRows[0] ? String(biometricRows[0].date) : null,
    lastLabDate: labPoints[0]?.collectedAt ?? null,
    lastSymptomDate: symptomRows[0] ? String(symptomRows[0].logged_at ?? '') : null,
  });

  // ---- Candidate hypotheses (rules, then optional AI) --------------------------
  const ctx = buildReasoningContext({ labPoints, changes: detectedChanges, symptomRows });
  let hypotheses = await loadHypothesesWithEvidence(sb, userId);
  const existingCodes = new Set(
    hypotheses.map((h) => (h as ClinicalHypothesis & { code?: string }).code ?? '').filter(Boolean)
  );
  // Row mapper does not carry code; re-read codes directly to be safe.
  const codeRows = await safeRows(
    sb.from('clinical_hypotheses').select('id, code, status').eq('user_id', userId).neq('status', 'archived'),
    'hypothesis codes'
  );
  for (const r of codeRows) {
    if (typeof r.code === 'string' && r.code) existingCodes.add(r.code);
  }

  const ruleCandidates: CandidateHypothesis[] = generateRuleHypotheses(ctx).map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    systems: r.systems,
    missingEvidence: r.missingEvidence,
    sourceType: 'rule_engine' as const,
    evidence: r.supporting,
  }));

  const createdFromRules = await persistCandidates(sb, userId, actor.id, ruleCandidates, existingCodes);

  let aiUsed = false;
  let createdFromAi: string[] = [];
  const aiCandidates = await generateAiCandidates(
    sb,
    userId,
    actor.id,
    ctx,
    [...hypotheses.map((h) => h.name), ...createdFromRules]
  );
  if (aiCandidates.length > 0) aiUsed = true;
  createdFromAi = await persistCandidates(sb, userId, actor.id, aiCandidates, existingCodes);

  // ---- Contradiction detection --------------------------------------------------
  const activeCodeRows = codeRows.filter(
    (r) => typeof r.code === 'string' && r.code && r.status !== 'rejected'
  );
  const contradictions = detectContradictions(
    ctx,
    activeCodeRows.map((r) => String(r.code))
  );
  let contradictionsRecorded = 0;
  for (const finding of contradictions) {
    const target = activeCodeRows.find((r) => r.code === finding.code);
    if (!target) continue;
    const hypothesisId = String(target.id);
    const { data: existing } = await sb
      .from('evidence_items')
      .select('id')
      .eq('hypothesis_id', hypothesisId)
      .eq('direction', 'contradicts')
      .eq('summary', finding.summary)
      .limit(1);
    if (existing && existing.length > 0) continue;
    const { error } = await sb.from('evidence_items').insert({
      user_id: userId,
      hypothesis_id: hypothesisId,
      direction: 'contradicts',
      evidence_type: 'observation',
      source_type: 'rule_engine',
      summary: finding.summary,
      strength: 0.7,
      created_by: actor.id,
    });
    if (!error) contradictionsRecorded += 1;
  }

  // ---- Recompute support scores (fresh read includes new candidates/evidence) ---
  hypotheses = await loadHypothesesWithEvidence(sb, userId);
  for (const h of hypotheses) {
    const evidence = [...(h.supportingEvidence ?? []), ...(h.contradictingEvidence ?? [])];
    const newScore = computeSupportScore(evidence, h.missingEvidence.length);
    if (newScore !== h.supportScore) {
      const reason = `Recomputed from ${evidence.length} evidence item(s) on ${trigger} run`;
      const newStatus =
        h.status === 'rejected' || h.status === 'archived' || h.status === 'under_review'
          ? h.status
          : statusFromScore(newScore, evidence.length);
      await sb
        .from('clinical_hypotheses')
        .update({
          prior_support_score: h.supportScore,
          support_score: newScore,
          score_change_reason: reason,
          status: newStatus,
        })
        .eq('id', h.id);
      h.priorSupportScore = h.supportScore;
      h.supportScore = newScore;
      h.scoreChangeReason = reason;
      h.status = newStatus;
    }
  }

  // ---- Record significant changes as rule_engine facts ---------------------------
  const significant = detectedChanges.filter((c) => c.severity === 'significant');
  for (const change of significant) {
    const { data: existing } = await sb
      .from('clinical_facts')
      .select('id')
      .eq('user_id', userId)
      .eq('fact_type', 'change')
      .eq('code', change.metric)
      .gte('observed_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(1);
    if (existing && existing.length > 0) continue;
    await sb.from('clinical_facts').insert({
      user_id: userId,
      fact_type: 'change',
      code: change.metric,
      label: `${change.label} ${change.direction} ${change.magnitudePercent}% vs baseline`,
      value_num: change.currentValue,
      unit: change.unit ?? null,
      value_json: change as unknown as Record<string, unknown>,
      observed_at: change.observedAt,
      source_type: 'rule_engine',
      source: 'reasoning.change_detection',
      data_quality: change.dataQuality ?? null,
      review_status: 'pending_review',
      created_by: actor.id,
    });
  }

  // ---- Health Twin Layer-2 systems state -----------------------------------------
  const prevRows = await safeRows(
    sb.from('reasoning_snapshots').select('*').eq('user_id', userId).order('snapshot_number', { ascending: false }).limit(1),
    'reasoning_snapshots'
  );
  const previous = prevRows[0] ? mapRowToSnapshot(prevRows[0]) : null;
  const previousSystems = Array.isArray(prevRows[0]?.systems_state)
    ? (prevRows[0]!.systems_state as { key: string; score: number | null }[])
    : [];

  const systemsState = computeSystemsModel({
    labPoints,
    changes: detectedChanges,
    symptomRows,
    hypotheses,
    hasWearableData: biometricRows.length > 0,
    hasLabData: labPoints.length > 0,
    hasSymptomData: symptomRows.length > 0,
    previousSystems,
  });

  // ---- Snapshot + diff -------------------------------------------------------------
  const hypothesesState = hypotheses.map((h) =>
    toSnapshotEntry(h, [...(h.supportingEvidence ?? []), ...(h.contradictingEvidence ?? [])])
  );
  const diff = diffSnapshots(previous, hypothesesState, detectedChanges);

  const { data: snapRow, error: snapError } = await sb
    .from('reasoning_snapshots')
    .insert({
      user_id: userId,
      snapshot_number: (previous?.snapshotNumber ?? 0) + 1,
      trigger,
      pipeline_version: REASONING_PIPELINE_VERSION,
      inputs_summary: {
        biometricDays: biometricRows.length,
        labMarkers: labPoints.length,
        symptoms: symptomRows.length,
        hypotheses: hypotheses.length,
        aiUsed,
      },
      hypotheses_state: hypothesesState,
      detected_changes: detectedChanges,
      data_quality_issues: issues,
      missing_data: missing,
      diff_from_previous: diff,
      systems_state: systemsState,
      previous_snapshot_id: previous?.id ?? null,
      created_by: actor.id,
    })
    .select('*')
    .single();

  if (snapError || !snapRow) {
    console.log(`[Reasoning] snapshot insert failed: ${snapError?.code ?? 'unknown'}`);
    throw new Error(
      'Analysis ran but the snapshot could not be stored. Has the clinical reasoning migration been applied?'
    );
  }

  // ---- Review queue for significant changes ------------------------------------------
  for (const change of significant) {
    const { data: existingReview } = await sb
      .from('practitioner_reviews')
      .select('id')
      .eq('patient_id', userId)
      .eq('subject_type', 'snapshot_change')
      .eq('subject_id', change.metric)
      .eq('status', 'pending')
      .limit(1);
    if (existingReview && existingReview.length > 0) continue;
    await sb.from('practitioner_reviews').insert({
      patient_id: userId,
      subject_type: 'snapshot_change',
      subject_id: change.metric,
      priority: 'elevated',
      proposed_summary: `${change.label} ${change.direction} of ${change.magnitudePercent}% vs baseline (rule engine, ${change.windowDays || 'single'}-day window).`,
      context: { change, snapshotId: String(snapRow.id) },
      created_by: actor.id,
    });
  }

  // ---- Operation log + audit -----------------------------------------------------------
  await sb.from('ai_operations').insert({
    user_id: userId,
    operation: 'reasoning.pipeline',
    model: aiUsed ? 'deterministic+llm' : 'deterministic',
    model_version: REASONING_PIPELINE_VERSION,
    input_record_ids: {
      biometricDays: biometricRows.length,
      labMarkers: labPoints.length,
      symptoms: symptomRows.length,
    },
    output: {
      snapshotId: String(snapRow.id),
      changes: detectedChanges.length,
      hypothesesCreated: [...createdFromRules, ...createdFromAi],
      contradictionsRecorded,
    },
    validation_status: 'passed',
    latency_ms: Date.now() - startedAt,
    initiated_by: actor.id,
    review_status: 'not_required',
  });

  await writeAuditEvent(sb, {
    actorId: actor.id,
    action: 'reasoning.analysis.run',
    resourceType: 'reasoning_snapshot',
    resourceId: String(snapRow.id),
    patientId: userId,
    details: { trigger, changes: detectedChanges.length, aiUsed },
  });

  return {
    snapshot: mapRowToSnapshot(snapRow as Record<string, unknown>),
    aiUsed,
    hypothesesCreated: [...createdFromRules, ...createdFromAi],
    contradictionsRecorded,
  };
}
