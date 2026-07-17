import type { SupabaseClient } from '@supabase/supabase-js';
import type { LensInputs, SafetyFailure } from './types';
import { buildInvariantCore, OUTPUT_SCHEMA_VERSION, RULE_SET_VERSION, sha256Canonical } from './core';
import { runLens, type Paradigm } from './lenses';
import { coreQuestions } from './questions';
import { runSafetyGates } from './safety';
import { fixtureAiQuestions, resolveLensAi, type LensAiIdentity } from './ai';

/**
 * Evaluation orchestrator (Milestone 2). Everything runs under the CALLER's
 * RLS-scoped client — the engine can only see what the practitioner can.
 *
 * gather → invariant core → lens framing (+ optional/AI questions) →
 * safety gates → run_lens_evaluation RPC (atomic persist; blocked runs
 * persist reviewable failures and ZERO questions).
 *
 * Logs carry ids and counts only — never facts, question text, or PHI.
 */

const KNOWLEDGE_VERSIONS = [
  { code: 'aha_acc_chest_pain_2021', revision: 1 },
  { code: 'acc_aha_htn_2017', revision: 1 },
  { code: 'aha_cdc_crp_2003', revision: 1 },
  { code: 'nih_nccih_sjw', revision: 1 },
  { code: 'who_tcm_terminology_2022', revision: 1 },
  { code: 'ifm_matrix_framework', revision: 1 },
  { code: 'aasm_sleep_questions', revision: 1 },
];

export async function gatherInputs(db: SupabaseClient, encounterId: string): Promise<LensInputs | null> {
  const enc = await db
    .from('encounters')
    .select('id, organization_id, patient_id')
    .eq('id', encounterId)
    .maybeSingle();
  if (enc.error || !enc.data) return null;
  const patientId = enc.data.patient_id as string;

  const [profile, biomarkers, medications, allergies, transcripts] = await Promise.all([
    db.from('patient_profiles').select('id, date_of_birth, sex').eq('id', patientId).maybeSingle(),
    db
      .from('biomarker_observations')
      .select('id, original_name, value_numeric, value_text, unit, observed_at, updated_at')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('observed_at', { ascending: false })
      .limit(50),
    db
      .from('medications')
      .select('id, name, status, updated_at')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .eq('status', 'active'),
    db
      .from('allergies')
      .select('id, allergen, reaction, severity, updated_at')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .neq('status', 'entered_in_error'),
    db
      .from('encounter_transcripts')
      .select('id, revision')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  // Supplements are optional context; absence of the tables is tolerated.
  // Scoped to THIS patient — RLS bounds visibility to the caller, but the
  // patient filter is what keeps another chart's supplements out of this
  // patient's lens inputs.
  let supplements: LensInputs['supplements'] = [];
  try {
    const supp = await db
      .from('supplement_protocol_items')
      .select('id, updated_at, supplement_products(name)')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .limit(25);
    if (!supp.error && supp.data) {
      supplements = (supp.data as Array<Record<string, unknown>>).map((s) => ({
        id: s.id as string,
        name: ((s.supplement_products as { name?: string } | null)?.name ?? 'supplement') as string,
        version: (s.updated_at as string | null) ?? 'unversioned',
      }));
    }
  } catch {
    supplements = [];
  }

  let transcript: LensInputs['transcript'] = [];
  const t = (transcripts.data ?? [])[0] as { id: string; revision: number } | undefined;
  if (t) {
    const [segments, corrections] = await Promise.all([
      db
        .from('transcript_segments')
        .select('id, seq, text')
        .eq('transcript_id', t.id)
        .order('seq', { ascending: true }),
      db
        .from('transcript_corrections')
        .select('segment_id, version, corrected_text')
        .eq('transcript_id', t.id)
        .order('version', { ascending: true }),
    ]);
    const corrRows = corrections.data ?? [];
    transcript = (segments.data ?? []).map((s) => {
      const latest = corrRows.filter((c) => c.segment_id === s.id).pop();
      return {
        segmentId: s.id as string,
        text: (latest?.corrected_text as string | undefined) ?? (s.text as string),
        source: latest ? ('corrected' as const) : ('raw' as const),
        version: `r${t.revision}`,
      };
    });
  }

  return {
    encounterId,
    organizationId: enc.data.organization_id as string,
    patientId,
    demographics: {
      dateOfBirth: (profile.data?.date_of_birth as string | null) ?? null,
      sex: (profile.data?.sex as string | null) ?? null,
    },
    biomarkers: (biomarkers.data ?? []).map((b) => ({
      id: b.id as string,
      name: (b.original_name as string | null) ?? 'unnamed observation',
      value: (b.value_numeric as number | null) ?? null,
      valueText: (b.value_text as string | null) ?? null,
      unit: (b.unit as string | null) ?? null,
      observedAt: (b.observed_at as string | null) ?? null,
      version: (b.updated_at as string | null) ?? 'unversioned',
    })),
    medications: (medications.data ?? []).map((m) => ({
      id: m.id as string,
      name: m.name as string,
      status: m.status as string,
      version: (m.updated_at as string | null) ?? 'unversioned',
    })),
    allergies: (allergies.data ?? []).map((a) => ({
      id: a.id as string,
      allergen: a.allergen as string,
      reaction: (a.reaction as string | null) ?? null,
      severity: (a.severity as string | null) ?? null,
      version: (a.updated_at as string | null) ?? 'unversioned',
    })),
    supplements,
    transcript,
    cutoffAt: new Date().toISOString(),
  };
}

export interface EvaluateResult {
  evaluationId: string;
  status: 'complete' | 'blocked';
  questionsInserted?: number;
  questionsDeduped?: number;
  blockedRules?: number;
}

export async function evaluateEncounter(
  db: SupabaseClient,
  encounterId: string,
  paradigm: Paradigm,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ result: EvaluateResult | null; error: { code?: string | null } | null }> {
  const inputs = await gatherInputs(db, encounterId);
  if (!inputs) return { result: null, error: { code: 'P0002' } };

  const core = buildInvariantCore(inputs);
  const lens = runLens(paradigm, core, inputs);
  const questions = [...coreQuestions(core, inputs), ...lens.optionalQuestions];

  // AI assistance: available in fixture mode; a live misconfiguration refuses
  // the AI leg but never the deterministic evaluation.
  let ai: LensAiIdentity | null = null;
  let aiRefusal: SafetyFailure | null = null;
  try {
    ai = resolveLensAi(env);
    if (ai) questions.push(...fixtureAiQuestions(core, inputs, ai));
  } catch (e) {
    ai = null;
    aiRefusal = null; // config refusal is a posture, not a safety failure
    console.log(`[lens] ai unavailable code=${(e as { code?: string }).code ?? 'unknown'}`);
  }

  const transcriptText = inputs.transcript.map((t) => t.text).join('\n');
  const gates = runSafetyGates({ core, framing: lens.framing, questions, transcriptText });
  if (aiRefusal) gates.failures.push(aiRefusal);

  const output = {
    core,
    framing: lens.framing,
    questions: gates.questions.map((q) => ({ ...q })),
  };

  const { data, error } = await db.rpc('run_lens_evaluation', {
    _encounter_id: encounterId,
    _paradigm: paradigm,
    _input_snapshot: {
      counts: {
        biomarkers: inputs.biomarkers.length,
        medications: inputs.medications.length,
        allergies: inputs.allergies.length,
        supplements: inputs.supplements.length,
        transcriptSegments: inputs.transcript.length,
      },
      demographicsPresent: {
        dateOfBirth: inputs.demographics.dateOfBirth !== null,
        sex: inputs.demographics.sex !== null,
      },
    },
    _input_cutoff: inputs.cutoffAt,
    _source_versions: core.provenance,
    _rule_set_version: RULE_SET_VERSION,
    _knowledge_versions: KNOWLEDGE_VERSIONS,
    _model: ai?.model ?? null,
    _provider: ai?.provider ?? null,
    _prompt_template_version: ai?.promptTemplateVersion ?? null,
    _output_schema_version: OUTPUT_SCHEMA_VERSION,
    _output_sha256: sha256Canonical(output),
    _invariant_core: core,
    _lens_framing: lens.framing,
    _questions: gates.questions.map((q) => ({
      questionText: q.questionText,
      rationale: q.rationale,
      distinguishes: q.distinguishes,
      safetyRelation: q.safetyRelation ?? '',
      priority: q.priority,
      answerType: q.answerType,
      domainCode: q.domainCode,
      patientSources: q.patientSources,
      knowledgeSourceCodes: q.knowledgeSourceCodes,
      missingDataAssumptions: q.missingDataAssumptions,
      generationMethod: q.generationMethod,
      generationVersion: q.generationVersion,
      dedupeKey: q.dedupeKey,
    })),
    _safety_failures: gates.failures,
    _validation_result: gates.validation,
  });

  if (error) return { result: null, error };
  const r = data as Record<string, unknown>;
  console.log(
    `[lens] evaluation encounter=${encounterId} paradigm=${paradigm} status=${r.status} inserted=${r.questionsInserted ?? 0} blocked=${r.blockedRules ?? 0}`,
  );
  return {
    result: {
      evaluationId: r.evaluationId as string,
      status: r.status as 'complete' | 'blocked',
      questionsInserted: (r.questionsInserted as number | undefined) ?? undefined,
      questionsDeduped: (r.questionsDeduped as number | undefined) ?? undefined,
      blockedRules: (r.blockedRules as number | undefined) ?? undefined,
    },
    error: null,
  };
}
