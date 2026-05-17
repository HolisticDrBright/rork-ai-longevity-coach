/**
 * Cross-modality correlator — the integration brain.
 *
 * Per part 3 §7.2 algorithm:
 *   1. Pull tags_with_confidence from each per-modality finding row.
 *   2. Aggregate into tag_map: { tag -> [(modality, confidence), ...] }
 *   3. Convergent = count_modalities >= 2 AND combined_conf >= 0.7
 *      (noisy-OR fusion: combined = 1 - product(1 - c_i))
 *   4. Divergent = any contradiction_pair where both halves appear in tag_map
 *   5. Trend vs prior session's convergent findings.
 *   6. Visual Health Index = weighted average across modalities the patient
 *      actually ran (NOT divided by sum of all possible weights — that
 *      would penalize partial sessions; part 4 #5 critical note).
 *
 * Symptom check-ins count as evidence sources per part 3 §8.6. The
 * correlator can optionally accept a `symptomEvidence` map that gets
 * mixed into the noisy-OR fusion alongside the visual modalities.
 *
 * This service is pure (no Supabase calls) — caller fetches rows + passes
 * them in, caller persists the convergent / divergent rows.
 */

import { isValidObservationTag, Modality } from '../ai/prompts/visual-diagnostics/shared/observation-taxonomy';

const CONVERGENCE_MIN_MODALITIES = 2;
const CONVERGENCE_MIN_COMBINED_CONF = 0.7;

export interface ModalityFindingInput {
  modality: Modality;
  tagsWithConfidence: Record<string, number>;
}

export interface ConvergentFinding {
  tag: string;
  contributingModalities: string[];
  combinedConfidence: number;
}

export interface DivergentFinding {
  tagA: string;
  tagB: string;
  contributingModalities: Record<string, string[]>; // tag -> modalities
  note: string;
}

export interface CorrelatorInput {
  findings: ModalityFindingInput[];
  contradictionPairs: Array<{ tagA: string; tagB: string; note: string | null }>;
  // Optional symptom evidence: tag -> confidence
  // Treated as a virtual modality named "symptom_rollup" in the fusion.
  symptomEvidence?: Record<string, number>;
  // Modality weights (modality -> weight); pulled from
  // visual_health_index_modality_weights.
  modalityWeights: Record<string, number>;
  // Optional: previous session's convergent findings, for trend computation
  previousConvergent?: ConvergentFinding[];
  // Optional: per-modality 0-100 "session score" from the analyzer's
  // top-level confidence * some health proxy. If absent we fall back
  // to average tag confidence per modality.
  modalitySessionScores?: Partial<Record<Modality, number>>;
}

export interface CorrelatorOutput {
  convergent: Array<ConvergentFinding & { trend: 'improving' | 'worsening' | 'stable' | null; prevConfidence: number | null }>;
  divergent: DivergentFinding[];
  visualHealthIndex: number | null;
}

/**
 * Noisy-OR fusion of independent evidence sources.
 *   combined = 1 - (1-c1)(1-c2)...(1-cn)
 */
function noisyOr(confidences: number[]): number {
  if (confidences.length === 0) return 0;
  let invProduct = 1;
  for (const c of confidences) {
    const clamped = Math.max(0, Math.min(1, c));
    invProduct *= 1 - clamped;
  }
  return 1 - invProduct;
}

export function runCorrelator(input: CorrelatorInput): CorrelatorOutput {
  const {
    findings, contradictionPairs, symptomEvidence,
    modalityWeights, previousConvergent, modalitySessionScores,
  } = input;

  // ── Step 1: aggregate tags across modalities ──
  // tag -> Map<modality, confidence>
  const tagMap = new Map<string, Map<string, number>>();

  for (const f of findings) {
    for (const [rawTag, rawConf] of Object.entries(f.tagsWithConfidence)) {
      if (!isValidObservationTag(rawTag)) continue;
      const conf = Math.max(0, Math.min(1, Number(rawConf) || 0));
      if (conf <= 0) continue;
      if (!tagMap.has(rawTag)) tagMap.set(rawTag, new Map());
      tagMap.get(rawTag)!.set(f.modality, conf);
    }
  }

  // Symptom evidence as a virtual modality
  if (symptomEvidence) {
    for (const [rawTag, rawConf] of Object.entries(symptomEvidence)) {
      if (!isValidObservationTag(rawTag)) continue;
      const conf = Math.max(0, Math.min(1, Number(rawConf) || 0));
      if (conf <= 0) continue;
      if (!tagMap.has(rawTag)) tagMap.set(rawTag, new Map());
      tagMap.get(rawTag)!.set('symptom_rollup', conf);
    }
  }

  // ── Step 2: convergence pass ──
  // Convergence requires ≥CONVERGENCE_MIN_MODALITIES *visual* modalities.
  // The 'symptom_rollup' virtual modality contributes confidence to the
  // noisy-OR fusion when present, but does NOT count toward the
  // modality-count threshold — otherwise a single visual modality plus
  // matching symptoms would trigger a false "cross-modality" convergence
  // (audit bug #7).
  const convergent: ConvergentFinding[] = [];
  for (const [tag, modalityConfs] of tagMap.entries()) {
    const visualModalityCount = Array.from(modalityConfs.keys())
      .filter(k => k !== 'symptom_rollup').length;
    if (visualModalityCount < CONVERGENCE_MIN_MODALITIES) continue;
    const combined = noisyOr(Array.from(modalityConfs.values()));
    if (combined < CONVERGENCE_MIN_COMBINED_CONF) continue;
    convergent.push({
      tag,
      contributingModalities: Array.from(modalityConfs.keys()),
      combinedConfidence: combined,
    });
  }

  // ── Step 3: divergence (contradiction pairs) ──
  const divergent: DivergentFinding[] = [];
  for (const pair of contradictionPairs) {
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

  // ── Step 4: trend vs prior ──
  const previousByTag = new Map<string, number>(
    (previousConvergent ?? []).map(p => [p.tag, p.combinedConfidence]),
  );
  const convergentWithTrend = convergent.map(c => {
    const prev = previousByTag.get(c.tag) ?? null;
    let trend: 'improving' | 'worsening' | 'stable' | null = null;
    if (prev != null) {
      const delta = c.combinedConfidence - prev;
      if (Math.abs(delta) < 0.05) trend = 'stable';
      else if (delta < 0) trend = 'improving';   // less convergence on a pattern = improving
      else trend = 'worsening';
    }
    return { ...c, trend, prevConfidence: prev };
  });

  // ── Step 5: Visual Health Index ──
  // Score per modality = modalitySessionScores override, OR avg tag
  // confidence * 100 as a proxy. Weighted average across modalities the
  // patient actually ran, normalized by the sum of those modalities'
  // weights (per part 4 #5 critical normalization note).
  const presentModalities = findings.map(f => f.modality);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const m of presentModalities) {
    const w = modalityWeights[m] ?? 1.0;
    let modalityScore: number;
    if (modalitySessionScores?.[m] != null) {
      modalityScore = modalitySessionScores[m] as number;
    } else {
      const finding = findings.find(f => f.modality === m);
      if (!finding) continue;
      const confs = Object.values(finding.tagsWithConfidence).map(v => Number(v) || 0);
      const avgConf = confs.length > 0 ? confs.reduce((s, v) => s + v, 0) / confs.length : 0;
      // Higher concern confidence = lower health score
      modalityScore = Math.round(100 * (1 - avgConf));
    }
    weightedSum += modalityScore * w;
    weightTotal += w;
  }
  const visualHealthIndex = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

  return {
    convergent: convergentWithTrend,
    divergent,
    visualHealthIndex,
  };
}
