/**
 * Deterministic Markdown generator for the per-modality `ai_summary.md`
 * sidecar and the cross-modality `cross_modality_summary.md`.
 *
 * Every downstream AI integration (daily-coach, future Pattern Discovery
 * miner, future Outcome Report engine) reads these .md files instead of
 * OCR'ing the rendered PDF or re-parsing the findings.json. That keeps
 * the integration cheap and reproducible.
 *
 * Templates per modality. The shape of the rendered summary is fixed by
 * the build prompt §9. Bumping the template requires bumping the
 * renderer_version constant and noting the migration in the spec.
 */

import { SkinAnalysisV1 } from '../ai/prompts/visual-diagnostics/skin-analysis-v1';
import { TcmTongueV1 } from '../ai/prompts/visual-diagnostics/tcm-tongue-v1';
import { ConvergentFinding, DivergentFinding } from './correlator-service';

export const RENDERER_VERSION = 'visual_summary_v1_2026-05-05';

interface ContextHeader {
  age: number | null;
  sex: string | null;
  cycleDay: number | null;
  activeProtocolsCsv: string;
  daysSinceLast: number | null;
  paradigmPreferencesCsv: string;
}

export function renderSkinSummaryMd(args: {
  findings: SkinAnalysisV1;
  capturedDate: string;
  context: ContextHeader;
}): string {
  const { findings, capturedDate, context } = args;
  const ages = `${context.age ?? '?'}${(context.sex ?? '?').charAt(0).toUpperCase()}`;

  if (!findings.image_usable) {
    return `# Skin Session Summary — ${ages}, ${capturedDate}\n\n## Headline\nImage was not usable for analysis.\n\n## Reason\n${findings.unusable_reason ?? 'unknown'}\n`;
  }

  const flagged = Object.entries(findings.facial_zones)
    .filter(([, v]) => v && (v as { score: number }).score < 70)
    .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${(v as { score: number; note: string }).score}/100 — ${(v as { score: number; note: string }).note}`);

  const headline = (() => {
    if (findings.red_flags.length > 0) {
      return findings.red_flags[0].observation;
    }
    if (findings.skin_age_delta_years > 3) {
      return `Skin appears ~${findings.skin_age_delta_years} years older than chronological age — ${findings.skin_age_rationale}`;
    }
    const lowestScore = Object.entries(findings.longevity_scores)
      .reduce<[string, number]>((acc, [k, v]) => v < acc[1] ? [k, v] : acc, ['', 100]);
    return `Lowest longevity score: ${lowestScore[0].replace(/_/g, ' ')} at ${lowestScore[1]}/100.`;
  })();

  return `# Skin Session Summary — ${ages}, ${capturedDate}

## Headline
${headline}

## Scores
- Skin Longevity: ${findings.longevity_scores.skin_longevity_score}/100
- Barrier Strength: ${findings.longevity_scores.barrier_strength_score}/100
- Hydration: ${findings.longevity_scores.hydration_score}/100
- Collagen Support: ${findings.longevity_scores.collagen_support_score}/100
- Inflammation (lower = less): ${findings.longevity_scores.inflammation_score}/100
- Recovery Capacity: ${findings.longevity_scores.recovery_capacity_score}/100
- Skin Age Delta: ${findings.skin_age_delta_years >= 0 ? '+' : ''}${findings.skin_age_delta_years} years

## Key Findings
${flagged.length > 0 ? flagged.join('\n') : '- All zones scoring 70+/100.'}

## Skin Type Tendencies
${findings.skin_type_tendencies.length > 0 ? findings.skin_type_tendencies.map(t => `- ${t}`).join('\n') : '- (none emitted)'}

## Cross-modality tags emitted
${findings.cross_modality_tags.length > 0 ? findings.cross_modality_tags.join(', ') : 'none'}

## Red flags
${findings.red_flags.length === 0 ? 'None' : findings.red_flags.map(rf => `- [${rf.severity}] ${rf.observation} — ${rf.recommended_action}`).join('\n')}

## Recommendation finding tags
${findings.recommendation_finding_tags.length > 0 ? findings.recommendation_finding_tags.map(t => `- ${t}`).join('\n') : '- (none emitted)'}

## In-clinic categories surfaced
${findings.in_clinic_categories.length > 0 ? findings.in_clinic_categories.map(c => `- ${c}`).join('\n') : '- (none)'}

## Systemic categories surfaced
${findings.systemic_categories.length > 0 ? findings.systemic_categories.map(c => `- ${c}`).join('\n') : '- (none)'}

## Context the analyzer received
- Age: ${context.age ?? '?'}
- Sex: ${context.sex ?? '?'}
- Cycle day: ${context.cycleDay ?? 'n/a'}
- Active protocols: ${context.activeProtocolsCsv}
- Days since last session: ${context.daysSinceLast ?? 'n/a'}
- Paradigm preferences: ${context.paradigmPreferencesCsv}
`;
}

export function renderTongueSummaryMd(args: {
  findings: TcmTongueV1;
  capturedDate: string;
  context: ContextHeader;
}): string {
  const { findings, capturedDate, context } = args;
  const ages = `${context.age ?? '?'}${(context.sex ?? '?').charAt(0).toUpperCase()}`;

  if (!findings.image_usable) {
    return `# Tongue Session Summary — ${ages}, ${capturedDate}\n\n## Headline\nImage was not usable for analysis.\n\n## Reason\n${findings.unusable_reason ?? 'unknown'}\n`;
  }

  const headline = (() => {
    if (findings.red_flags.length > 0) return findings.red_flags[0].observation;
    return `Primary pattern: ${findings.constitution_primary} (confidence ${(findings.constitution_confidence * 100).toFixed(0)}%)`;
  })();

  // Score block: emit the top-3 most-elevated pattern scores
  const topPatterns = Object.entries(findings.pattern_scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .filter(([, v]) => v > 3)
    .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}/10`);

  return `# Tongue Session Summary — ${ages}, ${capturedDate}

## Headline
${headline}

${findings.confidence_warning ? `## Confidence warning\n${findings.confidence_warning}\n` : ''}
## Tongue Observations
- Body color: ${findings.body_color ?? 'unobserved'}
- Shape: ${findings.shape ?? 'unobserved'}
- Size: ${findings.size ?? 'unobserved'}
- Moisture: ${findings.moisture ?? 'unobserved'}
- Coating thickness: ${findings.coating.thickness ?? 'unobserved'}; color: ${findings.coating.color ?? 'unobserved'}
- Teeth marks: ${findings.teeth_marks.present ? `present (${findings.teeth_marks.severity})` : 'none'}
- Red tip: ${findings.red_tip.present ? `present (${findings.red_tip.severity})` : 'none'}
- Purple tones: ${findings.purple_tones.present ? `present at ${findings.purple_tones.locations.join(', ')}` : 'none'}
- Sublingual veins engorged: ${findings.sublingual_veins_engorged == null ? 'not visible' : findings.sublingual_veins_engorged ? 'yes' : 'no'}

## Constitution
- Primary: ${findings.constitution_primary}
- Secondary: ${findings.constitution_secondary ?? 'none'}
- Confidence: ${(findings.constitution_confidence * 100).toFixed(0)}%

## Top Pattern Scores
${topPatterns.length > 0 ? topPatterns.join('\n') : '- (no patterns elevated above 3/10)'}

## Zone Observations
- Tip (Heart/Lungs): ${findings.zone_observations.tip ?? '—'}
- Center (Spleen/Stomach): ${findings.zone_observations.center ?? '—'}
- Sides (Liver/GB): ${findings.zone_observations.sides ?? '—'}
- Root (Kidneys): ${findings.zone_observations.root ?? '—'}

## Cross-modality tags emitted
${findings.cross_modality_tags.length > 0 ? findings.cross_modality_tags.join(', ') : 'none'}

## Red flags
${findings.red_flags.length === 0 ? 'None' : findings.red_flags.map(rf => `- [${rf.severity}] ${rf.observation} — ${rf.recommended_action}`).join('\n')}

## Balancing categories (no specific herbs / points until tcm_formulary table exists)
- Foods: ${findings.balancing_suggestions.foods.join(', ') || '(none)'}
- Teas: ${findings.balancing_suggestions.teas.join(', ') || '(none)'}
- Herb families: ${findings.balancing_suggestions.herb_families.join(', ') || '(none)'}
- Acupuncture channels: ${findings.balancing_suggestions.acupuncture_channels.join(', ') || '(none)'}
- Sleep: ${findings.balancing_suggestions.sleep ?? '—'}
- Hydration: ${findings.balancing_suggestions.hydration ?? '—'}
- Stress: ${findings.balancing_suggestions.stress ?? '—'}

## Context the analyzer received
- Age: ${context.age ?? '?'}
- Sex: ${context.sex ?? '?'}
- Cycle day: ${context.cycleDay ?? 'n/a'}
- Active protocols: ${context.activeProtocolsCsv}
- Days since last session: ${context.daysSinceLast ?? 'n/a'}
- Paradigm preferences: ${context.paradigmPreferencesCsv}
`;
}

export function renderCrossModalitySummaryMd(args: {
  convergent: Array<ConvergentFinding & { trend: 'improving' | 'worsening' | 'stable' | null }>;
  divergent: DivergentFinding[];
  visualHealthIndex: number | null;
  modalitiesRun: string[];
  capturedDate: string;
  context: ContextHeader;
}): string {
  const { convergent, divergent, visualHealthIndex, modalitiesRun, capturedDate, context } = args;
  const ages = `${context.age ?? '?'}${(context.sex ?? '?').charAt(0).toUpperCase()}`;

  return `# Cross-Modality Session Summary — ${ages}, ${capturedDate}

## Visual Health Index
${visualHealthIndex != null ? `${visualHealthIndex}/100` : 'not computed'}

## Modalities Run
${modalitiesRun.length > 0 ? modalitiesRun.map(m => `- ${m}`).join('\n') : '- (none)'}

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

## Context
- Age: ${context.age ?? '?'}
- Sex: ${context.sex ?? '?'}
- Cycle day: ${context.cycleDay ?? 'n/a'}
- Active protocols: ${context.activeProtocolsCsv}
- Days since last session: ${context.daysSinceLast ?? 'n/a'}
- Paradigm preferences: ${context.paradigmPreferencesCsv}
`;
}
