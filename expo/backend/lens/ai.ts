import type { CandidateQuestion, InvariantCore, LensInputs } from './types';
import { isDeployedEnvironment } from '../deployment';
import { transcriptHasInjection } from './safety';

/**
 * Lens AI providers (Milestone 2, req 7).
 *
 * The FIXTURE provider is deterministic and runs through the SAME schema,
 * citation, and safety gates as everything else — it exists to exercise the
 * ai_assisted path end to end. The PRODUCTION provider is DISABLED: enabling
 * it requires external approval plus full configuration, live mode refuses
 * when only the fixture is configured, and the fixture can never serve live
 * mode. No environment flag is treated as approval.
 */

export type LensAiMode = 'fixture' | 'live' | 'disabled';

export class LensAiConfigError extends Error {
  readonly code = 'LENS_AI_CONFIG';
  constructor(message: string) {
    super(message);
    this.name = 'LensAiConfigError';
  }
}

export function lensAiMode(env: NodeJS.ProcessEnv = process.env): LensAiMode {
  const raw = (env.LENS_AI_MODE ?? 'fixture').trim().toLowerCase();
  if (raw === 'live') return 'live';
  if (raw === 'disabled') return 'disabled';
  if (raw === 'fixture' || raw === '') return 'fixture';
  throw new LensAiConfigError(`LENS_AI_MODE must be 'fixture', 'live', or 'disabled' (got '${raw}')`);
}

export function liveLensAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.LENS_AI_PROVIDER?.trim() &&
    env.LENS_AI_MODEL?.trim() &&
    env.LENS_AI_APPROVAL_REF?.trim() // external approval record reference — required, never implied
  );
}

export interface LensAiIdentity {
  provider: string;
  model: string;
  promptTemplateVersion: string;
}

/**
 * Resolve the AI identity for ai_assisted question generation, or null when
 * AI assistance is unavailable (deterministic rules still run either way).
 * Live mode with only the fixture configured REFUSES rather than degrading.
 */
export function resolveLensAi(env: NodeJS.ProcessEnv = process.env): LensAiIdentity | null {
  const mode = lensAiMode(env);
  if (mode === 'disabled') {
    // The honest deployed default: AI assistance is simply off. The
    // deterministic lens engine runs regardless — this is not an error.
    return null;
  }
  if (mode === 'live') {
    if (!liveLensAiConfigured(env)) {
      throw new LensAiConfigError(
        'LENS_AI_MODE=live requires a fully configured, externally approved production provider ' +
          '(LENS_AI_PROVIDER, LENS_AI_MODEL, LENS_AI_APPROVAL_REF). The fixture cannot serve live mode.',
      );
    }
    throw new LensAiConfigError(
      'The production lens AI provider is disabled in this build pending external approval and configuration review.',
    );
  }
  if (isDeployedEnvironment(env)) {
    throw new LensAiConfigError(
      'The fixture lens AI provider is not permitted in a deployed environment. ' +
        'Set LENS_AI_MODE=live — AI-assisted generation stays off (the deterministic engine is unaffected).',
    );
  }
  return { provider: 'fixture', model: 'fixture-lens-1', promptTemplateVersion: 'm2-lens-tmpl-v1' };
}

/**
 * Fixture AI question generation — deterministic, transcript-aware, and
 * refuses outright when the transcript carries instruction-like content
 * (defense in depth; the safety gates would also block it).
 */
export function fixtureAiQuestions(
  core: InvariantCore,
  inputs: LensInputs,
  identity: LensAiIdentity,
): CandidateQuestion[] {
  const transcriptText = inputs.transcript.map((t) => t.text).join('\n');
  if (transcriptHasInjection(transcriptText)) return [];
  if (inputs.transcript.length === 0) return [];
  // One conservative, clearly-attributed AI-assisted question, only when the
  // deterministic core found something to anchor it to.
  if (core.objectiveFacts.length === 0) return [];
  return [
    {
      questionText:
        'Is there anything discussed today that you feel has not been captured in your chart yet?',
      rationale:
        'AI-assisted catch-all grounded in the encounter transcript: surfaces patient-reported context the structured record may be missing.',
      distinguishes: ['undocumented patient-reported context'],
      priority: 'low',
      answerType: 'free_text',
      domainCode: 'gastrointestinal',
      patientSources: inputs.transcript.slice(0, 1).map((t) => ({ ref: `transcript_segment:${t.segmentId}` })),
      knowledgeSourceCodes: ['ifm_matrix_framework'],
      missingDataAssumptions: ['Assumes the chart may lag the conversation.'],
      generationMethod: 'ai_assisted',
      generationVersion: identity.model,
      dedupeKey: 'ai-uncaptured-context',
      sourceLens: 'ai_assisted',
    },
  ];
}
