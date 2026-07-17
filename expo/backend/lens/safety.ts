import { z } from 'zod';
import type { CandidateQuestion, InvariantCore, LensFraming, SafetyFailure } from './types';
import { KNOWLEDGE_CODES, urgentDomains, urgentFlagsCovered } from './core';

/**
 * Deterministic post-generation safety gates (Milestone 2, req 7).
 *
 * A failed gate BLOCKS the evaluation: the caller persists it as 'blocked'
 * with reviewable failure rows and zero questions. Nothing is silently
 * removed — the failure IS the record.
 *
 * Transcript text, imported documents, and patient-provided text are
 * UNTRUSTED DATA. They are never executed as instructions; the injection
 * gate exists to catch attempts to smuggle instructions into generated
 * output (and to hard-stop AI-assisted generation when the transcript is
 * trying to steer it).
 */

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?(previous|prior|above) (instructions|rules)/i,
  /disregard (your|the) (safety|rules|instructions)/i,
  /system prompt/i,
  /you are now (an?|the)/i,
  /\bAI\b.{0,40}\b(suppress|hide|omit|remove)\b.{0,40}\b(red flag|warning|safety)/i,
  /do not (mention|report|include) (the )?(red flag|allergy|interaction|warning)/i,
];

const questionSchema = z.object({
  questionText: z.string().min(8).max(1000),
  rationale: z.string().min(8).max(2000),
  distinguishes: z.array(z.string()).max(10),
  safetyRelation: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  answerType: z.enum(['free_text', 'yes_no', 'numeric', 'choice', 'scale']),
  domainCode: z.string().min(2),
  patientSources: z.array(z.object({ ref: z.string(), label: z.string().optional() })),
  knowledgeSourceCodes: z.array(z.string()).min(1),
  missingDataAssumptions: z.array(z.string()),
  generationMethod: z.enum(['deterministic_rules', 'ai_assisted']),
  generationVersion: z.string().min(1),
  dedupeKey: z.string().min(3).max(120),
  sourceLens: z.string().min(2),
});

/** Language this milestone must never emit (question-focused slice, req 6). */
const FORBIDDEN_OUTPUT_PATTERNS: RegExp[] = [
  /\bprescribe\b/i,
  /\b(start|begin|initiate) (taking|dosing)\b/i,
  /\b\d+\s?(mg|mcg|iu)\b.{0,30}\b(daily|twice|per day)\b/i,
  /\byou (should|must) take\b/i,
  /\bdiagnos(is|ed) is\b/i,
];

export interface SafetyGateResult {
  failures: SafetyFailure[];
  questions: CandidateQuestion[]; // deduplicated, schema-valid batch
  validation: Record<string, unknown>;
}

export function transcriptHasInjection(transcriptText: string): RegExp | null {
  for (const p of INJECTION_PATTERNS) if (p.test(transcriptText)) return p;
  return null;
}

export function runSafetyGates(args: {
  core: InvariantCore;
  framing: LensFraming;
  questions: CandidateQuestion[];
  transcriptText: string;
}): SafetyGateResult {
  const { core, framing, questions, transcriptText } = args;
  const failures: SafetyFailure[] = [];

  // 1. schema validation — strict structured output.
  const schemaErrors: string[] = [];
  for (const [i, question] of questions.entries()) {
    const parsed = questionSchema.safeParse(question);
    if (!parsed.success) schemaErrors.push(`question[${i}]: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  if (schemaErrors.length > 0) {
    failures.push({ ruleCode: 'schema_validation_failed', detail: { errors: schemaErrors.slice(0, 10) } });
  }

  // 2. citation validation — codes must come from the known registry set.
  const known = new Set<string>(KNOWLEDGE_CODES);
  const badCitations = questions
    .flatMap((question) => question.knowledgeSourceCodes)
    .filter((code) => !known.has(code));
  if (badCitations.length > 0) {
    failures.push({ ruleCode: 'unknown_citation', detail: { codes: Array.from(new Set(badCitations)) } });
  }

  // 3. unsupported patient claims: a question asserting patient specifics
  //    must carry at least one patient source.
  const unsupported = questions.filter(
    (question) =>
      /this (reading|value|result|report|transcript)|was reported|on record/i.test(
        `${question.questionText} ${question.rationale}`,
      ) && question.patientSources.length === 0,
  );
  if (unsupported.length > 0) {
    failures.push({
      ruleCode: 'unsupported_claim',
      detail: { dedupeKeys: unsupported.map((question) => question.dedupeKey) },
    });
  }

  // 4. question-focused boundary: no treatment/dosing/diagnosis language.
  const forbidden = questions.filter((question) =>
    FORBIDDEN_OUTPUT_PATTERNS.some((p) => p.test(`${question.questionText} ${question.rationale}`)),
  );
  if (forbidden.length > 0) {
    failures.push({
      ruleCode: 'out_of_scope_output',
      detail: { dedupeKeys: forbidden.map((question) => question.dedupeKey) },
    });
  }

  // 5. red-flag suppression: urgent domains must lead the ranking …
  const urgent = urgentDomains(core);
  const leading = framing.ranking.slice(0, urgent.length).map((r) => r.domainCode);
  const demoted = urgent.filter((d) => !leading.includes(d));
  if (demoted.length > 0) {
    failures.push({ ruleCode: 'lens_suppressed_red_flag', detail: { demotedDomains: demoted } });
  }
  // … and every urgent flag needs an urgent question in the batch.
  const uncovered = urgentFlagsCovered(core, questions);
  if (uncovered.length > 0) {
    failures.push({ ruleCode: 'urgent_question_missing', detail: { flags: uncovered } });
  }

  // 6. prompt-injection: transcripts are data. If injection language shows up
  //    INSIDE generated output, or an AI-assisted question was generated from
  //    a transcript that carries injection attempts, block.
  const injectedOutput = questions.filter((question) =>
    INJECTION_PATTERNS.some((p) => p.test(`${question.questionText} ${question.rationale}`)),
  );
  if (injectedOutput.length > 0) {
    failures.push({
      ruleCode: 'prompt_injection_in_output',
      detail: { dedupeKeys: injectedOutput.map((question) => question.dedupeKey) },
    });
  }
  const transcriptInjection = transcriptHasInjection(transcriptText);
  if (transcriptInjection && questions.some((question) => question.generationMethod === 'ai_assisted')) {
    failures.push({
      ruleCode: 'prompt_injection_in_transcript',
      detail: { note: 'AI-assisted generation refused: the transcript contains instruction-like content.' },
    });
  }

  // 7. duplicate suppression (within the batch) — a cleanup, not a failure.
  const seen = new Set<string>();
  const deduped = questions.filter((question) =>
    seen.has(question.dedupeKey) ? false : (seen.add(question.dedupeKey), true),
  );

  return {
    failures,
    questions: deduped,
    validation: {
      schemaVersion: 'lens-output-v1',
      schemaValid: schemaErrors.length === 0,
      batchSize: questions.length,
      dedupedTo: deduped.length,
      rulesRun: [
        'schema_validation_failed',
        'unknown_citation',
        'unsupported_claim',
        'out_of_scope_output',
        'lens_suppressed_red_flag',
        'urgent_question_missing',
        'prompt_injection_in_output',
        'prompt_injection_in_transcript',
      ],
    },
  };
}
