import type { CandidateQuestion, InvariantCore, LensInputs } from './types';
import { RULE_SET_VERSION } from './core';

/**
 * Deterministic differential-question generators (Milestone 2, req 3/6).
 *
 * Every question: practitioner-facing rationale, what it helps distinguish,
 * safety relationship where one exists, patient-specific sources, registry
 * citations, missing-data assumptions, and a stable dedupe key. Outputs are
 * QUESTIONS and considerations only — never diagnoses, treatment, dosing,
 * or patient-facing recommendations.
 *
 * Urgent red flags each get an URGENT question (the safety gate verifies
 * coverage — a lens cannot drop them).
 */

function q(partial: Omit<CandidateQuestion, 'generationMethod' | 'generationVersion' | 'sourceLens'>): CandidateQuestion {
  return {
    ...partial,
    generationMethod: 'deterministic_rules',
    generationVersion: RULE_SET_VERSION,
    sourceLens: 'invariant-core',
  };
}

export function coreQuestions(core: InvariantCore, inputs: LensInputs): CandidateQuestion[] {
  const out: CandidateQuestion[] = [];

  // ---- urgent red-flag coverage (one urgent question per flag) ----
  for (const flag of core.redFlags.filter((f) => f.urgent)) {
    if (flag.code === 'chest_pain') {
      out.push(q({
        questionText: 'Characterize the chest pain: onset, exertional relationship, radiation, and associated symptoms (shortness of breath, diaphoresis, nausea)?',
        rationale: 'Chest pain was reported in the encounter; guideline evaluation framing distinguishes presentations that need immediate escalation.',
        distinguishes: ['presentations needing emergency evaluation', 'stable presentations for structured work-up'],
        safetyRelation: 'chest_pain',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'cardiometabolic',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
        missingDataAssumptions: ['Assumes no ECG or troponin result is already on record for this presentation.'],
        dedupeKey: 'urgent-chest-pain-characterization',
      }));
    } else if (flag.code === 'stroke_symptoms') {
      out.push(q({
        questionText: 'When exactly did the neurologic symptoms start, and are they present right now?',
        rationale: 'Possible stroke symptoms were reported; symptom timing is the pivotal fact for emergency pathways.',
        distinguishes: ['active neurologic emergency', 'resolved transient event needing urgent work-up'],
        safetyRelation: 'stroke_symptoms',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'neurologic',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
        missingDataAssumptions: [],
        dedupeKey: 'urgent-stroke-symptom-timing',
      }));
    } else if (flag.code === 'suicidality') {
      out.push(q({
        questionText: 'Ask directly about current safety: thoughts of self-harm now, access to means, and immediate support available.',
        rationale: 'Self-harm language appeared in the encounter; direct safety assessment precedes every other consideration.',
        distinguishes: ['active risk requiring immediate intervention', 'passive ideation needing structured follow-up'],
        safetyRelation: 'suicidality',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'neurologic',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
        missingDataAssumptions: [],
        dedupeKey: 'urgent-safety-assessment',
      }));
    } else if (flag.code === 'severe_hypertension') {
      out.push(q({
        questionText: 'Recheck the blood pressure now with correct technique, and ask about headache, visual changes, or chest symptoms.',
        rationale: 'A severely elevated reading needs confirmation and symptom screening to distinguish urgency tiers.',
        distinguishes: ['hypertensive emergency framing', 'severe asymptomatic elevation framing'],
        safetyRelation: 'severe_hypertension',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'cardiometabolic',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
        missingDataAssumptions: [],
        dedupeKey: 'urgent-bp-recheck',
      }));
    } else if (flag.code === 'critical_lab_values') {
      out.push(q({
        questionText: 'Confirm the critical laboratory value: was it repeated, when was it drawn, and are there symptoms consistent with it?',
        rationale: 'A critical-range value requires confirmation and symptom correlation before any other framing applies.',
        distinguishes: ['true critical value', 'pre-analytical error'],
        safetyRelation: 'critical_lab_values',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'cardiometabolic',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: flag.knowledgeSourceCodes,
        missingDataAssumptions: [],
        dedupeKey: 'urgent-critical-lab-confirmation',
      }));
    } else if (flag.code === 'medication_safety') {
      out.push(q({
        questionText: 'Review the flagged medication/supplement combination with the patient: current use, timing, and any symptoms attributable to it.',
        rationale: 'A recorded conflict or interaction caution exists; usage confirmation distinguishes a chart artifact from an active safety issue.',
        distinguishes: ['active interaction exposure', 'outdated chart entry'],
        safetyRelation: 'medication_safety',
        priority: 'urgent',
        answerType: 'free_text',
        domainCode: 'medication_supplement_safety',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['nih_nccih_sjw'],
        missingDataAssumptions: [],
        dedupeKey: 'urgent-interaction-review',
      }));
    }
  }

  // ---- non-urgent deterministic generators ----
  const systolic = inputs.biomarkers.filter((b) => b.name.toLowerCase().includes('systolic'));
  for (const s of systolic) {
    if (s.value !== null && s.value >= 130 && s.value < 180) {
      out.push(q({
        questionText: 'How was this blood pressure measured (cuff size, seated rest, arm position)?',
        rationale: `A reading of ${s.value} falls in an elevated guideline category; measurement technique materially affects classification.`,
        distinguishes: ['technique artifact', 'sustained elevation'],
        priority: 'high',
        answerType: 'free_text',
        domainCode: 'cardiometabolic',
        patientSources: [{ ref: `biomarker_observation:${s.id}`, label: s.name }],
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
        missingDataAssumptions: ['Assumes no technique metadata was recorded with the observation.'],
        dedupeKey: 'bp-measurement-technique',
      }));
      out.push(q({
        questionText: 'Are any home or out-of-office blood pressure readings available?',
        rationale: 'Out-of-office confirmation distinguishes sustained hypertension from office-only elevation.',
        distinguishes: ['white-coat pattern', 'sustained hypertension'],
        priority: 'medium',
        answerType: 'yes_no',
        domainCode: 'cardiometabolic',
        patientSources: [{ ref: `biomarker_observation:${s.id}`, label: s.name }],
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
        missingDataAssumptions: [],
        dedupeKey: 'bp-out-of-office',
      }));
    }
  }

  for (const c of inputs.biomarkers.filter((b) => b.name.toLowerCase().includes('crp'))) {
    if (c.value !== null && c.value >= 1 && c.value <= 10) {
      out.push(q({
        questionText: 'Any recent infection, injury, dental work, or intense exercise in the two weeks before this hs-CRP draw?',
        rationale: `hs-CRP of ${c.value} sits in an interpretable band; transient inflammatory triggers confound single measurements per the CDC/AHA statement.`,
        distinguishes: ['transient inflammatory trigger', 'persistent low-grade inflammation'],
        priority: 'medium',
        answerType: 'free_text',
        domainCode: 'inflammatory_immune',
        patientSources: [{ ref: `biomarker_observation:${c.id}`, label: c.name }],
        knowledgeSourceCodes: ['aha_cdc_crp_2003'],
        missingDataAssumptions: ['Assumes no repeat hs-CRP is already on record.'],
        dedupeKey: 'crp-transient-triggers',
      }));
    }
  }

  if (inputs.transcript.some((t) => /sleep|insomnia|snor|wake up gasping/i.test(t.text))) {
    out.push(q({
      questionText: 'Structured sleep history: loud snoring, witnessed pauses in breathing, and daytime sleepiness?',
      rationale: 'A sleep complaint appears in the encounter; AASM framing structures the history that distinguishes primary sleep disorders.',
      distinguishes: ['sleep-disordered breathing signals', 'behavioral insomnia pattern'],
      priority: 'medium',
      answerType: 'free_text',
      domainCode: 'sleep',
      patientSources: inputs.transcript
        .filter((t) => /sleep|insomnia|snor|wake up gasping/i.test(t.text))
        .map((t) => ({ ref: `transcript_segment:${t.segmentId}` })),
      knowledgeSourceCodes: ['aasm_sleep_questions'],
      missingDataAssumptions: [],
      dedupeKey: 'sleep-structured-history',
    }));
  }

  for (const flag of core.redFlags.filter((f) => !f.urgent)) {
    if (flag.code === 'pregnancy_context') {
      out.push(q({
        questionText: 'Confirm pregnancy status and gestational timing — it changes the safety framing of every consideration in this visit.',
        rationale: 'Pregnancy was mentioned in the encounter; documented status must anchor all further framing.',
        distinguishes: ['pregnancy-adjusted framing', 'standard adult framing'],
        safetyRelation: 'pregnancy_context',
        priority: 'high',
        answerType: 'free_text',
        domainCode: 'reproductive',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
        missingDataAssumptions: ['Assumes pregnancy status is not already documented in the chart.'],
        dedupeKey: 'pregnancy-status-confirmation',
      }));
    }
    if (flag.code === 'pediatric_context') {
      out.push(q({
        questionText: 'Confirm age and growth context — adult thresholds used elsewhere in this evaluation do not directly apply to a minor.',
        rationale: 'The recorded date of birth indicates a minor; adult-calibrated rules must be reinterpreted.',
        distinguishes: ['pediatric-appropriate framing', 'adult framing'],
        safetyRelation: 'pediatric_context',
        priority: 'high',
        answerType: 'free_text',
        domainCode: 'reproductive',
        patientSources: flag.sourceRefs.map((ref) => ({ ref })),
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
        missingDataAssumptions: [],
        dedupeKey: 'pediatric-context-confirmation',
      }));
    }
  }

  return out;
}
