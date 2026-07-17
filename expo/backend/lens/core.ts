import { createHash } from 'node:crypto';
import type {
  CandidateQuestion,
  InvariantCore,
  LensInputs,
  RedFlag,
  SourceRef,
} from './types';

/**
 * Invariant clinical core (Milestone 2, req 2) — DETERMINISTIC and
 * paradigm-independent by construction: this module never receives a
 * paradigm. Identical inputs always produce an identical core (the vitest
 * suite hashes it across every paradigm run to prove invariance).
 *
 * Everything here states facts, gaps, conflicts and safety observations —
 * never diagnoses, treatment, or dosing. Transcript text is UNTRUSTED DATA:
 * it is scanned with fixed word lists, never interpreted as instructions.
 */

export const RULE_SET_VERSION = 'lens-rules-v1';
export const OUTPUT_SCHEMA_VERSION = 'lens-output-v1';

export const KNOWLEDGE_CODES = [
  'aha_acc_chest_pain_2021',
  'acc_aha_htn_2017',
  'aha_cdc_crp_2003',
  'nih_nccih_sjw',
  'who_tcm_terminology_2022',
  'ifm_matrix_framework',
  'aasm_sleep_questions',
] as const;

const ref = (kind: SourceRef['kind'], id: string) => `${kind}:${id}`;

const CHEST_PAIN_WORDS = ['chest pain', 'chest pressure', 'chest tightness', 'pain radiating to my arm', 'pain in my chest'];
const STROKE_WORDS = ['face is drooping', 'facial droop', 'slurred speech', 'one side is weak', 'weakness on one side', 'sudden numbness on one side'];
const SUICIDALITY_WORDS = ['suicide', 'kill myself', 'end my life', 'self-harm', 'hurt myself', 'not want to be alive'];
const PREGNANCY_WORDS = ['pregnant', 'pregnancy', 'expecting a baby', 'weeks along'];
const SLEEP_WORDS = ['sleeping poorly', 'insomnia', 'trouble sleeping', 'snoring', 'wake up gasping', 'poor sleep'];

const SEROTONERGIC = ['sertraline', 'fluoxetine', 'escitalopram', 'paroxetine', 'venlafaxine', 'duloxetine'];
const ANTICOAGULANTS = ['warfarin', 'apixaban', 'rivaroxaban'];
const BLEEDING_RISK_SUPPLEMENTS = ['fish oil', 'ginkgo', 'vitamin e', 'high-dose omega'];
const SJW = ['st. john', 'st john', 'hypericum'];

function ageFromDob(dob: string | null, cutoff: string): number | null {
  if (!dob) return null;
  const born = Date.parse(dob);
  const at = Date.parse(cutoff);
  if (!Number.isFinite(born) || !Number.isFinite(at)) return null;
  return Math.floor((at - born) / (365.25 * 24 * 3600 * 1000));
}

function transcriptHits(transcript: LensInputs['transcript'], words: string[]) {
  const hits: { segmentId: string; word: string }[] = [];
  for (const seg of transcript) {
    const lower = seg.text.toLowerCase();
    for (const w of words) if (lower.includes(w)) hits.push({ segmentId: seg.segmentId, word: w });
  }
  return hits;
}

function biomarker(inputs: LensInputs, namePart: string) {
  return inputs.biomarkers.filter((b) => b.name.toLowerCase().includes(namePart));
}

export function buildInvariantCore(inputs: LensInputs): InvariantCore {
  const provenance: SourceRef[] = [
    { kind: 'patient_profile', id: inputs.patientId, version: inputs.cutoffAt },
    ...inputs.biomarkers.map((b) => ({ kind: 'biomarker_observation' as const, id: b.id, version: b.version, label: b.name })),
    ...inputs.medications.map((m) => ({ kind: 'medication' as const, id: m.id, version: m.version, label: m.name })),
    ...inputs.allergies.map((a) => ({ kind: 'allergy' as const, id: a.id, version: a.version, label: a.allergen })),
    ...inputs.supplements.map((s) => ({ kind: 'supplement' as const, id: s.id, version: s.version, label: s.name })),
    ...inputs.transcript.map((t) => ({ kind: 'transcript_segment' as const, id: t.segmentId, version: t.version })),
  ];

  const objectiveFacts = [
    ...inputs.biomarkers.map((b) => ({
      fact: `${b.name}: ${b.valueText ?? b.value ?? 'value unavailable'}${b.unit ? ` ${b.unit}` : ''}`,
      sourceRef: ref('biomarker_observation', b.id),
    })),
    ...inputs.medications.map((m) => ({
      fact: `Medication on record: ${m.name} (${m.status})`,
      sourceRef: ref('medication', m.id),
    })),
    ...inputs.supplements.map((s) => ({
      fact: `Supplement on record: ${s.name}`,
      sourceRef: ref('supplement', s.id),
    })),
  ];

  const missingInformation: string[] = [];
  const age = ageFromDob(inputs.demographics.dateOfBirth, inputs.cutoffAt);
  if (inputs.demographics.dateOfBirth === null) missingInformation.push('Date of birth is not recorded — age-dependent framing is unavailable.');
  if (inputs.demographics.sex === null) missingInformation.push('Sex is not recorded — sex-specific reference framing is unavailable.');
  if (inputs.allergies.length === 0) missingInformation.push('Allergy status is undocumented (an empty list is not the same as "no known allergies").');
  if (inputs.biomarkers.length === 0) missingInformation.push('No laboratory observations are on record for this patient.');
  if (inputs.transcript.length === 0) missingInformation.push('No encounter transcript is available.');

  // conflicts: a recorded medication that matches a recorded allergen.
  const conflicts = [] as InvariantCore['conflicts'];
  for (const m of inputs.medications) {
    for (const a of inputs.allergies) {
      if (a.allergen && m.name.toLowerCase().includes(a.allergen.toLowerCase())) {
        conflicts.push({
          description: `Recorded medication "${m.name}" matches recorded allergy "${a.allergen}".`,
          sourceRefs: [ref('medication', m.id), ref('allergy', a.id)],
        });
      }
    }
  }

  // interactions: fixed deterministic pairs (never dosing advice).
  const interactions = [] as InvariantCore['interactions'];
  const agents = [
    ...inputs.medications.map((m) => ({ name: m.name.toLowerCase(), ref: ref('medication', m.id), display: m.name })),
    ...inputs.supplements.map((s) => ({ name: s.name.toLowerCase(), ref: ref('supplement', s.id), display: s.name })),
  ];
  const has = (needles: string[]) => agents.filter((a) => needles.some((n) => a.name.includes(n)));
  const sjw = has(SJW);
  if (sjw.length > 0) {
    for (const partner of has(SEROTONERGIC)) {
      interactions.push({
        pair: [sjw[0].display, partner.display],
        concern: 'St. John\'s Wort with a serotonergic antidepressant — interaction caution documented by NIH/NCCIH.',
        knowledgeSourceCodes: ['nih_nccih_sjw'],
        sourceRefs: [sjw[0].ref, partner.ref],
      });
    }
    for (const partner of has(ANTICOAGULANTS)) {
      interactions.push({
        pair: [sjw[0].display, partner.display],
        concern: 'St. John\'s Wort with an anticoagulant — interaction caution documented by NIH/NCCIH.',
        knowledgeSourceCodes: ['nih_nccih_sjw'],
        sourceRefs: [sjw[0].ref, partner.ref],
      });
    }
  }
  for (const anticoag of has(ANTICOAGULANTS)) {
    for (const supp of has(BLEEDING_RISK_SUPPLEMENTS)) {
      interactions.push({
        pair: [anticoag.display, supp.display],
        concern: 'Anticoagulant with a bleeding-risk supplement — combined bleeding-risk caution.',
        knowledgeSourceCodes: ['nih_nccih_sjw'],
        sourceRefs: [anticoag.ref, supp.ref],
      });
    }
  }

  // critical labs — fixed thresholds; observations only.
  const criticalLabs = [] as InvariantCore['criticalLabs'];
  for (const k of biomarker(inputs, 'potassium')) {
    if (k.value !== null && (k.value >= 6.0 || k.value <= 2.5)) {
      criticalLabs.push({
        name: k.name, value: `${k.value}${k.unit ? ` ${k.unit}` : ''}`,
        concern: 'Potassium in a critical range — immediate confirmation and clinical evaluation pathways apply.',
        sourceRef: ref('biomarker_observation', k.id), knowledgeSourceCodes: ['acc_aha_htn_2017'],
      });
    }
  }
  for (const g of biomarker(inputs, 'glucose')) {
    if (g.value !== null && (g.value >= 400 || g.value <= 50)) {
      criticalLabs.push({
        name: g.name, value: `${g.value}${g.unit ? ` ${g.unit}` : ''}`,
        concern: 'Glucose in a critical range — immediate confirmation and clinical evaluation pathways apply.',
        sourceRef: ref('biomarker_observation', g.id), knowledgeSourceCodes: ['acc_aha_htn_2017'],
      });
    }
  }
  for (const c of biomarker(inputs, 'crp')) {
    if (c.value !== null && c.value > 10) {
      criticalLabs.push({
        name: c.name, value: `${c.value}${c.unit ? ` ${c.unit}` : ''}`,
        concern: 'hs-CRP above 10 mg/L suggests an acute non-cardiovascular inflammatory source per the CDC/AHA statement; repeat testing framing applies.',
        sourceRef: ref('biomarker_observation', c.id), knowledgeSourceCodes: ['aha_cdc_crp_2003'],
      });
    }
  }

  // red flags — transcript word lists + measured values. Urgent = invariant.
  const redFlags: RedFlag[] = [];
  const chest = transcriptHits(inputs.transcript, CHEST_PAIN_WORDS);
  if (chest.length > 0) {
    redFlags.push({
      code: 'chest_pain', label: 'Chest pain reported in the encounter', urgent: true,
      domainCode: 'cardiometabolic',
      sourceRefs: chest.map((h) => ref('transcript_segment', h.segmentId)),
      knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
    });
  }
  const stroke = transcriptHits(inputs.transcript, STROKE_WORDS);
  if (stroke.length > 0) {
    redFlags.push({
      code: 'stroke_symptoms', label: 'Possible stroke symptoms reported', urgent: true,
      domainCode: 'neurologic',
      sourceRefs: stroke.map((h) => ref('transcript_segment', h.segmentId)),
      knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
    });
  }
  const suicidal = transcriptHits(inputs.transcript, SUICIDALITY_WORDS);
  if (suicidal.length > 0) {
    redFlags.push({
      code: 'suicidality', label: 'Self-harm or suicidality language in the encounter', urgent: true,
      domainCode: 'neurologic',
      sourceRefs: suicidal.map((h) => ref('transcript_segment', h.segmentId)),
      knowledgeSourceCodes: ['aha_acc_chest_pain_2021'],
    });
  }
  const pregnancy = transcriptHits(inputs.transcript, PREGNANCY_WORDS);
  if (pregnancy.length > 0) {
    redFlags.push({
      code: 'pregnancy_context', label: 'Pregnancy context mentioned — safety framing applies to all considerations', urgent: false,
      domainCode: 'reproductive',
      sourceRefs: pregnancy.map((h) => ref('transcript_segment', h.segmentId)),
      knowledgeSourceCodes: ['acc_aha_htn_2017'],
    });
  }
  if (age !== null && age < 18) {
    redFlags.push({
      code: 'pediatric_context', label: `Patient is a minor (age ${age}) — adult thresholds and framing do not directly apply`, urgent: false,
      domainCode: 'reproductive',
      sourceRefs: [ref('patient_profile', inputs.patientId)],
      knowledgeSourceCodes: ['acc_aha_htn_2017'],
    });
  }
  for (const sys of biomarker(inputs, 'systolic')) {
    if (sys.value !== null && sys.value >= 180) {
      redFlags.push({
        code: 'severe_hypertension', label: `Systolic blood pressure ${sys.value} — severe elevation`, urgent: true,
        domainCode: 'cardiometabolic',
        sourceRefs: [ref('biomarker_observation', sys.id)],
        knowledgeSourceCodes: ['acc_aha_htn_2017'],
      });
    }
  }
  if (criticalLabs.length > 0) {
    redFlags.push({
      code: 'critical_lab_values', label: 'One or more laboratory values in a critical range', urgent: true,
      domainCode: 'cardiometabolic',
      sourceRefs: criticalLabs.map((c) => c.sourceRef),
      knowledgeSourceCodes: Array.from(new Set(criticalLabs.flatMap((c) => c.knowledgeSourceCodes))),
    });
  }
  if (conflicts.length > 0 || interactions.length > 0) {
    redFlags.push({
      code: 'medication_safety', label: 'Medication/allergy conflict or interaction caution on record', urgent: true,
      domainCode: 'medication_supplement_safety',
      sourceRefs: [...conflicts.flatMap((c) => c.sourceRefs), ...interactions.flatMap((i) => i.sourceRefs)],
      knowledgeSourceCodes: ['nih_nccih_sjw'],
    });
  }

  const emergencyConsiderations = redFlags
    .filter((f) => f.urgent)
    .map((f) => `${f.label} — apply the corresponding urgent evaluation pathway before any non-urgent consideration.`);

  const evidenceQuality: Record<string, string> = {};
  if (inputs.biomarkers.length > 0) evidenceQuality.labs = 'lab-reported observations (source documents retained)';
  if (inputs.medications.length > 0) evidenceQuality.medications = 'practitioner-entered medication list';
  if (inputs.allergies.length > 0) evidenceQuality.allergies = 'practitioner-entered allergy list';
  if (inputs.transcript.length > 0) {
    evidenceQuality.transcript = inputs.transcript.some((t) => t.source === 'corrected')
      ? 'encounter transcript (practitioner-corrected overlay in use)'
      : 'encounter transcript (raw ASR — uncorrected)';
  }

  const limitations = [
    'Deterministic rule output: fixed triggers over recorded data. It is not a diagnosis, risk score, or treatment recommendation.',
    'Transcript-derived signals depend on speech recognition quality and are treated as untrusted data.',
    ...(age === null ? ['Age-dependent rules were skipped (no date of birth).'] : []),
  ];

  return {
    objectiveFacts,
    provenance,
    missingInformation,
    conflicts,
    allergies: inputs.allergies.map((a) => ({
      allergen: a.allergen, reaction: a.reaction, severity: a.severity, sourceRef: ref('allergy', a.id),
    })),
    interactions,
    criticalLabs,
    redFlags,
    emergencyConsiderations,
    evidenceQuality,
    limitations,
  };
}

/** Canonical, key-sorted JSON — the hash base for invariance checks. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Domains that carry urgent red flags — every lens must rank them first. */
export function urgentDomains(core: InvariantCore): string[] {
  return Array.from(new Set(core.redFlags.filter((f) => f.urgent).map((f) => f.domainCode)));
}

/** True when the question batch covers every urgent red flag. */
export function urgentFlagsCovered(core: InvariantCore, questions: CandidateQuestion[]): string[] {
  const missing: string[] = [];
  for (const flag of core.redFlags.filter((f) => f.urgent)) {
    const covered = questions.some((q) => q.safetyRelation === flag.code && q.priority === 'urgent');
    if (!covered) missing.push(flag.code);
  }
  return missing;
}
