import type { CandidateQuestion, InvariantCore, LensFraming, LensInputs } from './types';
import { RULE_SET_VERSION, urgentDomains } from './core';

/**
 * Paradigm lenses (Milestone 2, req 1/2/6).
 *
 * A lens receives the ALREADY-BUILT invariant core and may only produce
 * FRAMING (domain ranking, terminology, notes) and OPTIONAL questions. The
 * core object is never passed back out of a lens — the evaluator persists
 * the original, and the safety gates verify no lens demoted an urgent
 * domain. TCM patterns and other paradigm concepts are labeled as
 * paradigm-specific considerations, never biomedical diagnoses.
 *
 * 'synergistic' is a TRANSPARENT composition: every ranked item carries the
 * lens it came from, disagreements are recorded as compositionConflicts with
 * an explicit resolution, and urgent (red-flag) domains always rank first
 * regardless of any member lens.
 */

export const BASE_PARADIGMS = [
  'western_conventional',
  'functional',
  'naturopathic',
  'tcm',
  'biohacking',
] as const;
export type BaseParadigm = (typeof BASE_PARADIGMS)[number];
export type Paradigm = BaseParadigm | 'synergistic';

const ALL_DOMAINS = [
  'cardiometabolic',
  'inflammatory_immune',
  'sleep',
  'gastrointestinal',
  'endocrine',
  'neurologic',
  'reproductive',
  'toxicologic_environmental',
  'medication_supplement_safety',
];

/** Non-urgent preference order per lens (urgent domains are pinned first). */
const LENS_PREFERENCE: Record<BaseParadigm, string[]> = {
  western_conventional: [
    'cardiometabolic', 'medication_supplement_safety', 'inflammatory_immune', 'endocrine',
    'neurologic', 'sleep', 'gastrointestinal', 'reproductive', 'toxicologic_environmental',
  ],
  functional: [
    'gastrointestinal', 'inflammatory_immune', 'endocrine', 'sleep',
    'toxicologic_environmental', 'cardiometabolic', 'medication_supplement_safety', 'neurologic', 'reproductive',
  ],
  naturopathic: [
    'sleep', 'gastrointestinal', 'toxicologic_environmental', 'inflammatory_immune',
    'endocrine', 'cardiometabolic', 'medication_supplement_safety', 'neurologic', 'reproductive',
  ],
  tcm: [
    'sleep', 'gastrointestinal', 'endocrine', 'inflammatory_immune',
    'neurologic', 'cardiometabolic', 'medication_supplement_safety', 'reproductive', 'toxicologic_environmental',
  ],
  biohacking: [
    'sleep', 'cardiometabolic', 'endocrine', 'inflammatory_immune',
    'gastrointestinal', 'neurologic', 'medication_supplement_safety', 'reproductive', 'toxicologic_environmental',
  ],
};

function rankingFor(lens: BaseParadigm, core: InvariantCore): LensFraming['ranking'] {
  const urgent = urgentDomains(core);
  const rest = LENS_PREFERENCE[lens].filter((d) => !urgent.includes(d));
  return [
    ...urgent.map((domainCode) => ({
      domainCode,
      sourceLens: 'invariant-core',
      note: 'Pinned first: carries an urgent red flag. No lens may demote it.',
    })),
    ...rest.map((domainCode) => ({ domainCode, sourceLens: lens })),
  ];
}

function baseFraming(lens: BaseParadigm, core: InvariantCore): LensFraming {
  const framing: LensFraming = {
    paradigm: lens,
    ranking: rankingFor(lens, core),
    terminology: [],
    framingNotes: [
      'The conventional/guideline-oriented view is always shown alongside this lens.',
      'Lens output re-frames and re-ranks non-urgent considerations only; the invariant safety core is identical under every paradigm.',
    ],
    compositionConflicts: [],
  };
  if (lens === 'tcm') {
    framing.terminology.push({
      term: 'pattern (TCM)',
      framedAs: 'paradigm-specific consideration',
      note: 'TCM patterns are expressed with WHO standard terminology and are NOT equivalent to biomedical diagnoses.',
      knowledgeSourceCodes: ['who_tcm_terminology_2022'],
    });
    framing.framingNotes.push('TCM patterns are paradigm-specific concepts, never biomedical diagnoses.');
  }
  if (lens === 'functional') {
    framing.terminology.push({
      term: 'antecedents / triggers / mediators',
      framedAs: 'organizing framework for non-urgent considerations',
      note: 'IFM Matrix framing organizes exploration; it is a conceptual framework, not a validated decision instrument.',
      knowledgeSourceCodes: ['ifm_matrix_framework'],
    });
  }
  if (lens === 'biohacking') {
    framing.framingNotes.push('Performance framing uses the same objective data; it adds no new claims.');
  }
  return framing;
}

/** Optional, lens-specific questions — only when the data supports them. */
function lensOptionalQuestions(lens: BaseParadigm, core: InvariantCore, inputs: LensInputs): CandidateQuestion[] {
  const out: CandidateQuestion[] = [];
  const hasSleepSignal = inputs.transcript.some((t) => /sleep|insomnia|snor/i.test(t.text));
  if (lens === 'functional' && hasSleepSignal) {
    out.push({
      questionText: 'Walk me through a typical evening: meals, screens, and wind-down before bed.',
      rationale: 'Functional framing explores routine antecedents behind the reported sleep complaint.',
      distinguishes: ['behavioral sleep pressure', 'circadian timing factors'],
      priority: 'low',
      answerType: 'free_text',
      domainCode: 'sleep',
      patientSources: inputs.transcript
        .filter((t) => /sleep|insomnia|snor/i.test(t.text))
        .map((t) => ({ ref: `transcript_segment:${t.segmentId}` })),
      knowledgeSourceCodes: ['ifm_matrix_framework', 'aasm_sleep_questions'],
      missingDataAssumptions: [],
      generationMethod: 'deterministic_rules',
      generationVersion: RULE_SET_VERSION,
      dedupeKey: 'functional-evening-routine',
      sourceLens: lens,
    });
  }
  if (lens === 'tcm' && hasSleepSignal) {
    out.push({
      questionText: 'Is the sleep difficulty mainly falling asleep, staying asleep, or waking unrefreshed? (Observation for TCM pattern framing — a paradigm-specific consideration, not a diagnosis.)',
      rationale: 'Differentiates sleep-pattern presentations used in TCM framing, expressed with WHO standard terminology.',
      distinguishes: ['onset vs maintenance insomnia framing'],
      priority: 'low',
      answerType: 'choice',
      domainCode: 'sleep',
      patientSources: inputs.transcript
        .filter((t) => /sleep|insomnia|snor/i.test(t.text))
        .map((t) => ({ ref: `transcript_segment:${t.segmentId}` })),
      knowledgeSourceCodes: ['who_tcm_terminology_2022', 'aasm_sleep_questions'],
      missingDataAssumptions: [],
      generationMethod: 'deterministic_rules',
      generationVersion: RULE_SET_VERSION,
      dedupeKey: 'tcm-sleep-pattern-observation',
      sourceLens: lens,
    });
  }
  if (lens === 'biohacking' && core.objectiveFacts.some((f) => /crp|glucose|systolic/i.test(f.fact))) {
    out.push({
      questionText: 'Any recent intense training blocks, saunas, or acute illness in the week before these labs?',
      rationale: 'Recent exertion or acute illness can transiently shift inflammatory and metabolic markers; timing context aids interpretation.',
      distinguishes: ['transient training effect', 'sustained baseline shift'],
      priority: 'low',
      answerType: 'free_text',
      domainCode: 'inflammatory_immune',
      patientSources: core.objectiveFacts
        .filter((f) => /crp|glucose|systolic/i.test(f.fact))
        .map((f) => ({ ref: f.sourceRef })),
      knowledgeSourceCodes: ['aha_cdc_crp_2003'],
      missingDataAssumptions: ['Assumes training/illness history is not already documented.'],
      generationMethod: 'deterministic_rules',
      generationVersion: RULE_SET_VERSION,
      dedupeKey: 'biohacking-training-context',
      sourceLens: lens,
    });
  }
  return out;
}

export interface LensResult {
  framing: LensFraming;
  optionalQuestions: CandidateQuestion[];
}

export function applyLens(lens: BaseParadigm, core: InvariantCore, inputs: LensInputs): LensResult {
  return { framing: baseFraming(lens, core), optionalQuestions: lensOptionalQuestions(lens, core, inputs) };
}

/** Transparent composition of every base lens (req 6). */
export function composeSynergistic(core: InvariantCore, inputs: LensInputs): LensResult {
  const members = BASE_PARADIGMS.map((lens) => ({ lens, result: applyLens(lens, core, inputs) }));
  const urgent = urgentDomains(core);

  // Average member positions per non-urgent domain; record disagreements.
  const positions = new Map<string, { lens: string; rank: number }[]>();
  for (const { lens, result } of members) {
    result.framing.ranking
      .filter((r) => !urgent.includes(r.domainCode))
      .forEach((r, i) => {
        const list = positions.get(r.domainCode) ?? [];
        list.push({ lens, rank: i });
        positions.set(r.domainCode, list);
      });
  }
  const compositionConflicts: LensFraming['compositionConflicts'] = [];
  const averaged = ALL_DOMAINS.filter((d) => !urgent.includes(d))
    .map((domainCode) => {
      const list = positions.get(domainCode) ?? [];
      const avg = list.length ? list.reduce((s, p) => s + p.rank, 0) / list.length : 99;
      const ranks = list.map((p) => p.rank);
      const spread = ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0;
      if (spread >= 5) {
        compositionConflicts.push({
          domainCode,
          positions: list,
          resolution: 'Member lenses disagree strongly; ranked by average position with every member position shown. No position is hidden.',
        });
      }
      const strongest = list.slice().sort((a, b) => a.rank - b.rank)[0];
      return { domainCode, avg, sourceLens: strongest ? strongest.lens : 'composition' };
    })
    .sort((a, b) => a.avg - b.avg);

  const framing: LensFraming = {
    paradigm: 'synergistic',
    ranking: [
      ...urgent.map((domainCode) => ({
        domainCode,
        sourceLens: 'invariant-core',
        note: 'Pinned first: carries an urgent red flag. Urgent biomedical concerns always outrank every member lens.',
      })),
      ...averaged.map((a) => ({
        domainCode: a.domainCode,
        sourceLens: a.sourceLens,
        note: 'Composed by average member-lens position (transparent; see compositionConflicts for disagreements).',
      })),
    ],
    terminology: members.flatMap((m) => m.result.framing.terminology),
    framingNotes: [
      'Best-synergistic-mix is a transparent composition of the five member lenses — per-item source attribution, open conflict resolution, never a hidden blended model.',
      'Urgent red-flag material ranks first regardless of any member lens.',
    ],
    compositionConflicts,
  };

  // Optional questions: union of member questions, tagged by their source
  // lens; duplicates collapse by dedupe key.
  const seen = new Set<string>();
  const optionalQuestions = members
    .flatMap((m) => m.result.optionalQuestions)
    .filter((q) => (seen.has(q.dedupeKey) ? false : (seen.add(q.dedupeKey), true)));

  return { framing, optionalQuestions };
}

export function runLens(paradigm: Paradigm, core: InvariantCore, inputs: LensInputs): LensResult {
  if (paradigm === 'synergistic') return composeSynergistic(core, inputs);
  return applyLens(paradigm, core, inputs);
}
