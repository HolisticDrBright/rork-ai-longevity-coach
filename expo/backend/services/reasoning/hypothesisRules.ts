// Deterministic hypothesis rule registry (source_type='rule_engine').
// Rules propose PATTERNS for practitioner review — names deliberately avoid
// diagnostic language. Every rule also declares when current data contradicts
// it, powering the contradiction-detection stage.

import type { DetectedChange } from '@/types/reasoning';
import type { LabMarkerPoint } from './changeDetection';

export const TWIN_SYSTEM_KEYS = [
  'metabolic',
  'cardiovascular',
  'inflammation_immune',
  'hormonal',
  'gastrointestinal',
  'detoxification',
  'mitochondrial_energy',
  'neuro_cognitive',
  'musculoskeletal',
  'stress_autonomic',
  'sleep_circadian',
  'healthy_aging',
] as const;
export type TwinSystemKey = (typeof TWIN_SYSTEM_KEYS)[number];

export interface MarkerReading {
  name: string;
  value: number;
  unit?: string;
  low?: number | null;
  high?: number | null;
  collectedAt: string;
}

export interface SymptomReading {
  name: string;
  severity: number | null;
  loggedAt: string;
}

export interface ReasoningContext {
  markers: MarkerReading[];
  changes: DetectedChange[];
  symptoms: SymptomReading[];
}

export interface RuleEvidence {
  summary: string;
  strength: number;
  evidenceType: 'lab' | 'trend' | 'symptom';
  observedAt?: string;
}

export interface RuleHypothesis {
  code: string;
  name: string;
  description: string;
  systems: TwinSystemKey[];
  supporting: RuleEvidence[];
  missingEvidence: string[];
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const MARKER_ALIASES: Record<string, string[]> = {
  ferritin: ['ferritin'],
  vitamin_d: ['vitamind', '25oh', '25hydroxy'],
  hba1c: ['hba1c', 'hemoglobina1c', 'a1c'],
  glucose: ['fastingglucose', 'glucose'],
  insulin: ['fastinginsulin', 'insulin'],
  tsh: ['tsh', 'thyroidstimulating'],
  crp: ['hscrp', 'crp', 'creactive'],
  homocysteine: ['homocysteine'],
  b12: ['b12', 'cobalamin'],
  ldl: ['ldl'],
  triglycerides: ['triglyceride'],
  alt: ['alt', 'alanineamino', 'sgpt'],
  ast: ['ast', 'aspartateamino', 'sgot'],
};

export function findMarker(ctx: ReasoningContext, key: keyof typeof MARKER_ALIASES): MarkerReading | null {
  const aliases = MARKER_ALIASES[key];
  let best: MarkerReading | null = null;
  for (const m of ctx.markers) {
    const n = normalize(m.name);
    if (aliases.some((a) => n.includes(a))) {
      if (!best || m.collectedAt > best.collectedAt) best = m;
    }
  }
  return best;
}

function belowRange(m: MarkerReading | null, fallbackLow?: number): boolean {
  if (!m) return false;
  if (m.low != null) return m.value < m.low;
  return fallbackLow !== undefined && m.value < fallbackLow;
}

function aboveRange(m: MarkerReading | null, fallbackHigh?: number): boolean {
  if (!m) return false;
  if (m.high != null) return m.value > m.high;
  return fallbackHigh !== undefined && m.value > fallbackHigh;
}

function comfortablyInRange(m: MarkerReading | null, fallbackLow?: number, fallbackHigh?: number): boolean {
  if (!m) return false;
  const low = m.low ?? fallbackLow;
  const high = m.high ?? fallbackHigh;
  if (low != null && m.value < low * 1.05) return false;
  if (high != null && m.value > high * 0.95) return false;
  return low != null || high != null;
}

function labEvidence(m: MarkerReading, note: string, strength: number): RuleEvidence {
  return {
    summary: `${m.name} ${m.value}${m.unit ? ` ${m.unit}` : ''} (${note})`,
    strength,
    evidenceType: 'lab',
    observedAt: m.collectedAt,
  };
}

function hasSymptom(ctx: ReasoningContext, names: string[], minSeverity = 5): SymptomReading | null {
  const wanted = names.map(normalize);
  for (const s of ctx.symptoms) {
    if (wanted.some((w) => normalize(s.name).includes(w)) && (s.severity ?? 0) >= minSeverity) {
      return s;
    }
  }
  return null;
}

function findChange(ctx: ReasoningContext, metric: string, direction?: 'increase' | 'decrease'): DetectedChange | null {
  return (
    ctx.changes.find(
      (c) => c.metric === metric && c.severity !== 'info' && (!direction || c.direction === direction)
    ) ?? null
  );
}

export interface HypothesisRule {
  code: string;
  evaluate(ctx: ReasoningContext): RuleHypothesis | null;
  /** Returns a contradiction summary when current data argues AGAINST the hypothesis. */
  contradictedWhen(ctx: ReasoningContext): string | null;
}

export const HYPOTHESIS_RULES: HypothesisRule[] = [
  {
    code: 'rule:iron_insufficiency',
    evaluate(ctx) {
      const ferritin = findMarker(ctx, 'ferritin');
      if (!belowRange(ferritin, 30)) return null;
      const supporting: RuleEvidence[] = [labEvidence(ferritin!, 'below reference range', 0.8)];
      const fatigue = hasSymptom(ctx, ['fatigue', 'energy', 'tired'], 5);
      if (fatigue) {
        supporting.push({
          summary: `Patient-reported ${fatigue.name} severity ${fatigue.severity}/10`,
          strength: 0.5,
          evidenceType: 'symptom',
          observedAt: fatigue.loggedAt,
        });
      }
      return {
        code: this.code,
        name: 'Low iron stores pattern',
        description:
          'Ferritin below the reference range suggests depleted iron stores, which can contribute to fatigue, reduced exercise capacity and cognitive complaints.',
        systems: ['mitochondrial_energy', 'metabolic'],
        supporting,
        missingEvidence: ['Iron panel (serum iron, TIBC, transferrin saturation)', 'CBC with indices', 'Menstrual/GI blood-loss history'],
      };
    },
    contradictedWhen(ctx) {
      const ferritin = findMarker(ctx, 'ferritin');
      return comfortablyInRange(ferritin, 30)
        ? `Latest ferritin ${ferritin!.value}${ferritin!.unit ? ` ${ferritin!.unit}` : ''} is within range`
        : null;
    },
  },
  {
    code: 'rule:insulin_resistance',
    evaluate(ctx) {
      const glucose = findMarker(ctx, 'glucose');
      const hba1c = findMarker(ctx, 'hba1c');
      const insulin = findMarker(ctx, 'insulin');
      const supporting: RuleEvidence[] = [];
      if (aboveRange(glucose, 100)) supporting.push(labEvidence(glucose!, 'above optimal fasting range', 0.7));
      if (aboveRange(hba1c, 5.7)) supporting.push(labEvidence(hba1c!, 'above optimal range', 0.85));
      if (aboveRange(insulin, 15)) supporting.push(labEvidence(insulin!, 'elevated fasting level', 0.75));
      if (supporting.length === 0) return null;
      return {
        code: this.code,
        name: 'Insulin resistance pattern',
        description:
          'Glycemic markers above optimal ranges suggest reduced insulin sensitivity — an early, modifiable driver of metabolic and cardiovascular risk.',
        systems: ['metabolic', 'cardiovascular', 'healthy_aging'],
        supporting,
        missingEvidence: [
          ...(insulin ? [] : ['Fasting insulin (HOMA-IR)']),
          ...(hba1c ? [] : ['HbA1c']),
          'Continuous glucose or post-prandial data',
        ],
      };
    },
    contradictedWhen(ctx) {
      const glucose = findMarker(ctx, 'glucose');
      const hba1c = findMarker(ctx, 'hba1c');
      const present = [glucose, hba1c].filter(Boolean) as MarkerReading[];
      if (present.length === 0) return null;
      const glucoseOk = !glucose || (glucose.value < 100 && !aboveRange(glucose));
      const hba1cOk = !hba1c || (hba1c.value < 5.7 && !aboveRange(hba1c));
      return glucoseOk && hba1cOk
        ? `Latest glycemic markers (${present.map((m) => `${m.name} ${m.value}`).join(', ')}) are within optimal ranges`
        : null;
    },
  },
  {
    code: 'rule:thyroid_dysregulation',
    evaluate(ctx) {
      const tsh = findMarker(ctx, 'tsh');
      if (!tsh || (!aboveRange(tsh) && !belowRange(tsh))) return null;
      const direction = aboveRange(tsh) ? 'above' : 'below';
      return {
        code: this.code,
        name: 'Thyroid axis dysregulation pattern',
        description: `TSH ${direction} the reference range suggests the thyroid axis deserves a closer look before symptoms are attributed elsewhere.`,
        systems: ['hormonal', 'metabolic', 'mitochondrial_energy'],
        supporting: [labEvidence(tsh, `${direction} reference range`, 0.8)],
        missingEvidence: ['Free T4', 'Free T3', 'TPO/TG antibodies', 'Repeat TSH to confirm'],
      };
    },
    contradictedWhen(ctx) {
      const tsh = findMarker(ctx, 'tsh');
      return comfortablyInRange(tsh) ? `Latest TSH ${tsh!.value} is within range` : null;
    },
  },
  {
    code: 'rule:vitamin_d_insufficiency',
    evaluate(ctx) {
      const d = findMarker(ctx, 'vitamin_d');
      if (!belowRange(d, 30)) return null;
      return {
        code: this.code,
        name: 'Vitamin D insufficiency pattern',
        description: '25-OH vitamin D below 30 ng/mL is associated with impaired immune regulation, bone health and mood.',
        systems: ['inflammation_immune', 'musculoskeletal', 'healthy_aging'],
        supporting: [labEvidence(d!, 'below optimal range', 0.8)],
        missingEvidence: ['Sun exposure and supplementation history', 'Calcium status if supplementing high-dose D'],
      };
    },
    contradictedWhen(ctx) {
      const d = findMarker(ctx, 'vitamin_d');
      return d && d.value >= 30 ? `Latest vitamin D ${d.value}${d.unit ? ` ${d.unit}` : ''} is at or above 30` : null;
    },
  },
  {
    code: 'rule:systemic_inflammation',
    evaluate(ctx) {
      const crp = findMarker(ctx, 'crp');
      const hcy = findMarker(ctx, 'homocysteine');
      const supporting: RuleEvidence[] = [];
      if (aboveRange(crp, 3)) supporting.push(labEvidence(crp!, 'elevated', 0.8));
      if (aboveRange(hcy, 15)) supporting.push(labEvidence(hcy!, 'elevated', 0.6));
      if (supporting.length === 0) return null;
      return {
        code: this.code,
        name: 'Systemic inflammation pattern',
        description: 'Inflammatory markers are elevated; identifying the driver (metabolic, gut, infection, lifestyle) matters more than the number itself.',
        systems: ['inflammation_immune', 'cardiovascular', 'healthy_aging'],
        supporting,
        missingEvidence: ['Repeat hs-CRP (rule out acute illness)', 'Fasting insulin / metabolic panel', 'Sleep and training-load review'],
      };
    },
    contradictedWhen(ctx) {
      const crp = findMarker(ctx, 'crp');
      return crp && crp.value < 1 ? `Latest hs-CRP ${crp.value} is low` : null;
    },
  },
  {
    code: 'rule:autonomic_strain',
    evaluate(ctx) {
      const hrvDrop = findChange(ctx, 'hrv', 'decrease');
      if (!hrvDrop) return null;
      const supporting: RuleEvidence[] = [
        {
          summary: `HRV down ${hrvDrop.magnitudePercent}% vs baseline over ${hrvDrop.windowDays} days`,
          strength: hrvDrop.severity === 'significant' ? 0.7 : 0.5,
          evidenceType: 'trend',
          observedAt: hrvDrop.observedAt,
        },
      ];
      const rhrUp = findChange(ctx, 'resting_hr', 'increase');
      if (rhrUp) {
        supporting.push({
          summary: `Resting HR up ${rhrUp.magnitudePercent}% vs baseline`,
          strength: 0.5,
          evidenceType: 'trend',
          observedAt: rhrUp.observedAt,
        });
      }
      const stress = hasSymptom(ctx, ['stress', 'anxiety'], 6);
      if (stress) {
        supporting.push({
          summary: `Patient-reported ${stress.name} severity ${stress.severity}/10`,
          strength: 0.4,
          evidenceType: 'symptom',
          observedAt: stress.loggedAt,
        });
      }
      return {
        code: this.code,
        name: 'Autonomic strain / under-recovery pattern',
        description:
          'Sustained HRV suppression (with or without resting-HR elevation) suggests accumulated stress load or incomplete recovery rather than a single bad night.',
        systems: ['stress_autonomic', 'sleep_circadian', 'mitochondrial_energy'],
        supporting,
        missingEvidence: ['Training load and alcohol log for the window', 'Illness/infection screen', 'Sleep-stage quality data'],
      };
    },
    contradictedWhen(ctx) {
      const hrvUp = ctx.changes.find((c) => c.metric === 'hrv' && c.direction === 'increase');
      return hrvUp ? `HRV is trending up ${hrvUp.magnitudePercent}% vs baseline` : null;
    },
  },
  {
    code: 'rule:sleep_insufficiency',
    evaluate(ctx) {
      const sleepDrop = findChange(ctx, 'sleep_duration_minutes', 'decrease');
      if (!sleepDrop || sleepDrop.currentValue > 420) return null;
      return {
        code: this.code,
        name: 'Sleep insufficiency pattern',
        description: 'Average sleep duration has fallen meaningfully below baseline; short sleep degrades glycemic control, recovery and mood within days.',
        systems: ['sleep_circadian', 'metabolic', 'neuro_cognitive'],
        supporting: [
          {
            summary: `Sleep down ${sleepDrop.magnitudePercent}% vs baseline (avg ${Math.round(sleepDrop.currentValue)} min)`,
            strength: sleepDrop.severity === 'significant' ? 0.7 : 0.5,
            evidenceType: 'trend',
            observedAt: sleepDrop.observedAt,
          },
        ],
        missingEvidence: ['Bedtime consistency data', 'Evening caffeine/alcohol log', 'Subjective sleep quality ratings'],
      };
    },
    contradictedWhen(ctx) {
      const sleepUp = ctx.changes.find((c) => c.metric === 'sleep_duration_minutes' && c.direction === 'increase');
      return sleepUp ? `Sleep duration is trending up vs baseline` : null;
    },
  },
  {
    code: 'rule:b12_insufficiency',
    evaluate(ctx) {
      const b12 = findMarker(ctx, 'b12');
      if (!belowRange(b12, 300)) return null;
      return {
        code: this.code,
        name: 'B12 insufficiency pattern',
        description: 'B12 in the low range can contribute to fatigue, neuropathy and cognitive complaints, and is cheap to correct once confirmed.',
        systems: ['neuro_cognitive', 'mitochondrial_energy'],
        supporting: [labEvidence(b12!, 'low', 0.7)],
        missingEvidence: ['Methylmalonic acid (confirms functional deficiency)', 'Homocysteine', 'Dietary/medication review (metformin, PPIs)'],
      };
    },
    contradictedWhen(ctx) {
      const b12 = findMarker(ctx, 'b12');
      return comfortablyInRange(b12, 300) ? `Latest B12 ${b12!.value} is within range` : null;
    },
  },
  {
    code: 'rule:lipid_pattern',
    evaluate(ctx) {
      const ldl = findMarker(ctx, 'ldl');
      const trig = findMarker(ctx, 'triglycerides');
      const supporting: RuleEvidence[] = [];
      if (aboveRange(ldl)) supporting.push(labEvidence(ldl!, 'above reference range', 0.6));
      if (aboveRange(trig, 150)) supporting.push(labEvidence(trig!, 'above optimal range', 0.65));
      if (supporting.length === 0) return null;
      return {
        code: this.code,
        name: 'Lipid pattern outside optimal range',
        description: 'Lipids are outside optimal ranges; pairing with metabolic markers and ApoB clarifies actual cardiovascular relevance.',
        systems: ['cardiovascular', 'metabolic'],
        supporting,
        missingEvidence: ['ApoB or LDL particle number', 'Lp(a) at least once', 'Fasting status confirmation'],
      };
    },
    contradictedWhen(ctx) {
      const ldl = findMarker(ctx, 'ldl');
      const trig = findMarker(ctx, 'triglycerides');
      if (!ldl && !trig) return null;
      const ldlOk = !ldl || !aboveRange(ldl);
      const trigOk = !trig || (!aboveRange(trig, 150) && trig.value < 150);
      return ldlOk && trigOk ? 'Latest lipid values are within range' : null;
    },
  },
  {
    code: 'rule:hepatic_stress',
    evaluate(ctx) {
      const alt = findMarker(ctx, 'alt');
      const ast = findMarker(ctx, 'ast');
      const supporting: RuleEvidence[] = [];
      if (aboveRange(alt)) supporting.push(labEvidence(alt!, 'above reference range', 0.7));
      if (aboveRange(ast)) supporting.push(labEvidence(ast!, 'above reference range', 0.65));
      if (supporting.length === 0) return null;
      return {
        code: this.code,
        name: 'Hepatic enzyme elevation pattern',
        description: 'Elevated transaminases warrant a look at metabolic load, alcohol, medications and supplements before anything else.',
        systems: ['detoxification', 'metabolic'],
        supporting,
        missingEvidence: ['GGT', 'Repeat panel in 4–6 weeks', 'Alcohol, medication and supplement review'],
      };
    },
    contradictedWhen(ctx) {
      const alt = findMarker(ctx, 'alt');
      const ast = findMarker(ctx, 'ast');
      if (!alt && !ast) return null;
      const altOk = !alt || !aboveRange(alt);
      const astOk = !ast || !aboveRange(ast);
      return altOk && astOk ? 'Latest liver enzymes are within range' : null;
    },
  },
];

/** Runs every rule; returns proposed hypotheses (deduping is the caller's job). */
export function generateRuleHypotheses(ctx: ReasoningContext): RuleHypothesis[] {
  const results: RuleHypothesis[] = [];
  for (const rule of HYPOTHESIS_RULES) {
    try {
      const r = rule.evaluate(ctx);
      if (r) results.push(r);
    } catch {
      console.log(`[Reasoning] rule ${rule.code} failed to evaluate`);
    }
  }
  return results;
}

export interface ContradictionFinding {
  code: string;
  summary: string;
}

/** For active hypotheses with known codes, checks whether current data contradicts them. */
export function detectContradictions(
  ctx: ReasoningContext,
  activeCodes: string[]
): ContradictionFinding[] {
  const findings: ContradictionFinding[] = [];
  for (const rule of HYPOTHESIS_RULES) {
    if (!activeCodes.includes(rule.code)) continue;
    try {
      const summary = rule.contradictedWhen(ctx);
      if (summary) findings.push({ code: rule.code, summary });
    } catch {
      console.log(`[Reasoning] contradiction check ${rule.code} failed`);
    }
  }
  return findings;
}

/** Builds the rule-engine context from raw table rows. */
export function buildReasoningContext(input: {
  labPoints: LabMarkerPoint[];
  changes: DetectedChange[];
  symptomRows: Record<string, unknown>[];
}): ReasoningContext {
  return {
    markers: input.labPoints.map((p) => ({
      name: p.markerName,
      value: p.value,
      unit: p.unit,
      low: p.referenceLow ?? null,
      high: p.referenceHigh ?? null,
      collectedAt: p.collectedAt,
    })),
    changes: input.changes,
    symptoms: input.symptomRows.map((r) => ({
      name: String(r.symptom_name ?? ''),
      severity: typeof r.severity === 'number' ? r.severity : null,
      loggedAt: String(r.logged_at ?? ''),
    })),
  };
}
