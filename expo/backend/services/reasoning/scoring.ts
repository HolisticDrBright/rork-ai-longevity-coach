// Deterministic hypothesis support scoring and snapshot diffing.
// The score is a bounded evidence-weight heuristic labeled "support level" —
// it is NOT a validated medical probability and the UI must not present it as one.

import type {
  ClinicalHypothesis,
  DetectedChange,
  EvidenceItem,
  HypothesisSnapshotEntry,
  ReasoningSnapshot,
  SnapshotDiff,
} from '@/types/reasoning';

/**
 * Support level 0–100 from the evidence ledger.
 * Base 50 (uncertain) + weighted supports − weighted contradictions, with
 * diminishing returns per item; missing evidence caps the ceiling.
 */
export function computeSupportScore(
  evidence: Pick<EvidenceItem, 'direction' | 'strength'>[],
  missingEvidenceCount = 0
): number {
  let score = 50;
  let supportGain = 0;
  let contradictLoss = 0;
  let supportsSeen = 0;
  let contradictsSeen = 0;

  for (const e of evidence) {
    const weight = clamp01(e.strength ?? 0.5);
    if (e.direction === 'supports') {
      supportGain += weight * 12 * Math.pow(0.85, supportsSeen);
      supportsSeen += 1;
    } else if (e.direction === 'contradicts') {
      contradictLoss += weight * 14 * Math.pow(0.85, contradictsSeen);
      contradictsSeen += 1;
    }
  }

  score += supportGain - contradictLoss;
  // Unresolved missing evidence keeps certainty bounded.
  const ceiling = 100 - Math.min(30, missingEvidenceCount * 6);
  return Math.round(Math.max(0, Math.min(ceiling, score)));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function statusFromScore(
  score: number,
  evidenceCount: number
): 'proposed' | 'supported' | 'weakened' | 'unresolved' {
  if (evidenceCount === 0) return 'proposed';
  if (score >= 65) return 'supported';
  if (score <= 35) return 'weakened';
  return 'unresolved';
}

export function toSnapshotEntry(
  h: ClinicalHypothesis,
  evidence: EvidenceItem[]
): HypothesisSnapshotEntry {
  return {
    hypothesisId: h.id,
    name: h.name,
    status: h.status,
    supportScore: h.supportScore,
    supportingCount: evidence.filter((e) => e.direction === 'supports').length,
    contradictingCount: evidence.filter((e) => e.direction === 'contradicts').length,
    sourceType: h.sourceType,
    reviewStatus: h.reviewStatus,
  };
}

export function diffSnapshots(
  previous: Pick<ReasoningSnapshot, 'hypothesesState' | 'detectedChanges'> | null,
  currentHypotheses: HypothesisSnapshotEntry[],
  currentChanges: DetectedChange[]
): SnapshotDiff {
  const prevHyp = new Map((previous?.hypothesesState ?? []).map((h) => [h.hypothesisId, h]));
  const currHyp = new Map(currentHypotheses.map((h) => [h.hypothesisId, h]));
  const prevChanges = new Set((previous?.detectedChanges ?? []).map((c) => c.metric));
  const currChanges = new Set(currentChanges.map((c) => c.metric));

  const hypothesesAdded = currentHypotheses
    .filter((h) => !prevHyp.has(h.hypothesisId))
    .map((h) => h.name);
  const hypothesesRemoved = [...prevHyp.values()]
    .filter((h) => !currHyp.has(h.hypothesisId))
    .map((h) => h.name);

  const scoreChanges = currentHypotheses
    .filter((h) => {
      const p = prevHyp.get(h.hypothesisId);
      return p !== undefined && p.supportScore !== h.supportScore;
    })
    .map((h) => ({
      hypothesisId: h.hypothesisId,
      name: h.name,
      from: prevHyp.get(h.hypothesisId)!.supportScore,
      to: h.supportScore,
    }));

  const newChanges = currentChanges.filter((c) => !prevChanges.has(c.metric)).map((c) => c.label);
  const resolvedChanges = (previous?.detectedChanges ?? [])
    .filter((c) => !currChanges.has(c.metric))
    .map((c) => c.label);

  const parts: string[] = [];
  if (newChanges.length) parts.push(`${newChanges.length} new change${newChanges.length === 1 ? '' : 's'} detected`);
  if (resolvedChanges.length) parts.push(`${resolvedChanges.length} resolved`);
  if (hypothesesAdded.length) parts.push(`${hypothesesAdded.length} hypothesis(es) added`);
  if (scoreChanges.length) parts.push(`${scoreChanges.length} support level(s) shifted`);
  const summary = parts.length ? parts.join('; ') : 'No material change since the previous analysis.';

  return { newChanges, resolvedChanges, hypothesesAdded, hypothesesRemoved, scoreChanges, summary };
}
