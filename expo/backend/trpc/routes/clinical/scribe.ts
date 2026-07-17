import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter } from '../../create-context';
import {
  adminProcedure,
  clinicalAuthenticatedProcedure,
  organizationProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';
import { resolveProvider, scribeMode, ScribeConfigError } from '../../../scribe/config';
import { ProviderDisabledError } from '../../../scribe/providers';
import { getScribeWorkerDeps } from '../../../scribe/runtime';
import { runDeletionWorkerOnce, runTranscriptionWorkerOnce } from '../../../scribe/workers';

/**
 * clinical.scribe.* — consent-gated encounter recording + AI scribe
 * (Milestone 1). Every user-facing procedure runs through the CALLER's
 * RLS-scoped client; the 0022 SECURITY DEFINER RPCs are the enforcement of
 * record (consent scopes, active revocation, bound tokens, state machine,
 * provider enablement, deletion workflow). This layer adds: strict
 * provider-mode resolution (the client NEVER chooses the provider), typed
 * error translation, DTO mapping, and opportunistic worker ticks so fixture
 * jobs complete promptly in development.
 *
 * The scribe output is DRAFT-ONLY by construction: generate_scribe_draft
 * creates a new proposed note; signing stays in clinical.notes.*.
 */

const uuid = z.string().uuid();

const SCOPES = ['recording', 'transcription', 'ai_drafting'] as const;
const METHODS = ['verbal_attested', 'written', 'electronic_signature'] as const;
const NOTE_TYPES = ['soap', 'narrative', 'follow_up', 'adime', 'patient_instructions'] as const;
const REP_BASES = ['minor_guardian', 'legal_authorized_representative', 'surrogate_unable_to_consent'] as const;
const CONTENT_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg'] as const;

function preconditionFromConfig(e: unknown): never {
  if (e instanceof ScribeConfigError || e instanceof ProviderDisabledError) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message });
  }
  throw e;
}

/** Fire one worker tick without failing the calling mutation. */
async function tickWorkersSafely(kind: 'transcription' | 'deletion'): Promise<void> {
  try {
    const deps = getScribeWorkerDeps();
    if (!deps) return; // live mode without config, or workers disabled — interval/redelivery handles it
    if (kind === 'transcription') await runTranscriptionWorkerOnce(deps);
    else await runDeletionWorkerOnce(deps);
  } catch (e) {
    console.log(`[scribe] worker tick failed kind=${kind} code=${(e as { code?: string }).code ?? 'unknown'}`);
  }
}

export const clinicalScribeRouter = createTRPCRouter({
  /** Mode + provider posture — the desktop shows this, it never chooses. */
  providerStatus: clinicalAuthenticatedProcedure.query(() => {
    const mode = scribeMode();
    let provider: string | null = null;
    let reason: string | null = null;
    try {
      provider = resolveProvider(undefined);
    } catch (e) {
      reason = (e as Error).message;
    }
    return { mode, provider, available: provider !== null, reason };
  }),

  /** Active consent documents (org templates + shared), per scope. */
  consentDocuments: organizationProcedure.query(async ({ ctx, input }) => {
    const orgId = (input as { organizationId: string }).organizationId;
    const { data, error } = await ctx.clinicalDb
      .from('consent_documents')
      .select('id, organization_id, scope, version, locale, jurisdiction, title, body, presentation_format, content_sha256, effective_date')
      .eq('is_active', true)
      .or(`organization_id.eq.${orgId},organization_id.is.null`)
      .order('scope', { ascending: true })
      .order('version', { ascending: false });
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load consent documents' });
    return (data ?? []).map((d) => ({
      id: d.id as string,
      scope: d.scope as (typeof SCOPES)[number],
      version: d.version as number,
      locale: d.locale as string,
      jurisdiction: (d.jurisdiction as string | null) ?? null,
      title: d.title as string,
      body: d.body as string,
      presentationFormat: d.presentation_format as string,
      contentSha256: d.content_sha256 as string,
      effectiveDate: d.effective_date as string,
      shared: d.organization_id === null,
    }));
  }),

  /** Participants + their per-scope consent state for one encounter. */
  participants: clinicalAuthenticatedProcedure
    .input(z.object({ encounterId: uuid }))
    .query(async ({ ctx, input }) => {
      const [participants, consents] = await Promise.all([
        ctx.clinicalDb
          .from('encounter_recording_participants')
          .select('id, participant_kind, display_name, relationship, can_self_consent, joined_at, left_at')
          .eq('encounter_id', input.encounterId)
          .order('joined_at', { ascending: true }),
        ctx.clinicalDb
          .from('encounter_consents')
          .select('id, participant_id, scope, status, method, granted_at, withdrawn_at, representative_basis, consent_document_id')
          .eq('encounter_id', input.encounterId),
      ]);
      if (participants.error || consents.error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load participants' });
      }
      const consentRows = consents.data ?? [];
      return (participants.data ?? []).map((p) => ({
        id: p.id as string,
        kind: p.participant_kind as string,
        displayName: p.display_name as string,
        relationship: (p.relationship as string | null) ?? null,
        canSelfConsent: p.can_self_consent as boolean,
        joinedAt: p.joined_at as string,
        leftAt: (p.left_at as string | null) ?? null,
        consents: consentRows
          .filter((c) => c.participant_id === p.id)
          .map((c) => ({
            id: c.id as string,
            scope: c.scope as (typeof SCOPES)[number],
            status: c.status as 'granted' | 'withdrawn',
            method: c.method as string,
            grantedAt: c.granted_at as string,
            withdrawnAt: (c.withdrawn_at as string | null) ?? null,
            representative: c.representative_basis !== null,
            consentDocumentId: c.consent_document_id as string,
          })),
      }));
    }),

  addParticipant: clinicalAuthenticatedProcedure
    .input(
      z.object({
        encounterId: uuid,
        kind: z.enum(['patient', 'caregiver', 'practitioner', 'other']),
        displayName: z.string().min(1).max(200),
        relationship: z.string().max(120).optional(),
        userId: uuid.optional(),
        canSelfConsent: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('add_recording_participant', {
        _encounter_id: input.encounterId,
        _participant_kind: input.kind,
        _display_name: input.displayName,
        _relationship: input.relationship ?? null,
        _user_id: input.userId ?? null,
        _can_self_consent: input.canSelfConsent,
      });
      if (error) throwFromRpcError(error, 'add participant');
      return { participantId: data as string };
    }),

  recordConsent: clinicalAuthenticatedProcedure
    .input(
      z.object({
        participantId: uuid,
        scope: z.enum(SCOPES),
        consentDocumentId: uuid,
        method: z.enum(METHODS),
        signerAcknowledgment: z.string().min(1).max(2000),
        jurisdiction: z.string().max(60).optional(),
        representative: z
          .object({
            name: z.string().min(1).max(200),
            relationship: z.string().max(120).optional(),
            basis: z.enum(REP_BASES),
            authority: z.string().min(1).max(500),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('record_consent', {
        _participant_id: input.participantId,
        _scope: input.scope,
        _consent_document_id: input.consentDocumentId,
        _method: input.method,
        _signer_acknowledgment: input.signerAcknowledgment,
        _jurisdiction: input.jurisdiction ?? null,
        _representative_name: input.representative?.name ?? null,
        _representative_relationship: input.representative?.relationship ?? null,
        _representative_basis: input.representative?.basis ?? null,
        _representative_authority: input.representative?.authority ?? null,
      });
      if (error) throwFromRpcError(error, 'record consent');
      return { consentId: data as string };
    }),

  withdrawConsent: clinicalAuthenticatedProcedure
    .input(z.object({ consentId: uuid, reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('withdraw_consent', {
        _consent_id: input.consentId,
        _reason: input.reason ?? null,
      });
      if (error) throwFromRpcError(error, 'withdraw consent');
      return { ok: true as const };
    }),

  /**
   * Begin a recording. The PROVIDER IS SERVER-RESOLVED from SCRIBE_MODE —
   * client input never selects it, and live mode refuses outright when only
   * the fixture is configured. Returns the one-time raw chunk token.
   */
  beginRecording: clinicalAuthenticatedProcedure
    .input(
      z.object({
        encounterId: uuid,
        contentType: z.enum(CONTENT_TYPES),
        maxBytes: z.number().int().positive().max(2_147_483_648).default(256 * 1024 * 1024),
        ttlSeconds: z.number().int().min(30).max(600).default(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let provider: string;
      try {
        provider = resolveProvider(undefined);
      } catch (e) {
        preconditionFromConfig(e);
      }
      const { data, error } = await ctx.clinicalDb.rpc('begin_recording', {
        _encounter_id: input.encounterId,
        _provider: provider!,
        _content_type: input.contentType,
        _max_bytes: input.maxBytes,
        _ttl_seconds: input.ttlSeconds,
      });
      if (error) throwFromRpcError(error, 'begin recording');
      const r = data as Record<string, unknown>;
      return {
        recordingId: r.recording_id as string,
        sessionId: r.session_id as string,
        captureToken: r.token as string,
        expiresAt: r.expires_at as string,
        contentType: r.content_type as string,
        maxBytes: r.max_bytes as number,
        provider,
      };
    }),

  /** Heartbeat: consent revalidation + chunk-token rotation. */
  heartbeat: clinicalAuthenticatedProcedure
    .input(z.object({ sessionId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('heartbeat_capture', { _session_id: input.sessionId });
      if (error) throwFromRpcError(error, 'heartbeat');
      const r = data as Record<string, unknown>;
      return {
        ok: Boolean(r.ok),
        status: r.status as string,
        captureToken: (r.token as string | undefined) ?? null,
        expiresAt: (r.expires_at as string | undefined) ?? null,
      };
    }),

  resume: clinicalAuthenticatedProcedure
    .input(z.object({ sessionId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('resume_capture', { _session_id: input.sessionId });
      if (error) throwFromRpcError(error, 'resume capture');
      return { ok: true as const };
    }),

  issueCompletionAuthorization: clinicalAuthenticatedProcedure
    .input(z.object({ sessionId: uuid, ttlSeconds: z.number().int().min(30).max(600).default(120) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('issue_completion_authorization', {
        _session_id: input.sessionId,
        _ttl_seconds: input.ttlSeconds,
      });
      if (error) throwFromRpcError(error, 'authorize completion');
      const r = data as Record<string, unknown>;
      return { completionToken: r.token as string, expiresAt: r.expires_at as string };
    }),

  queueTranscription: clinicalAuthenticatedProcedure
    .input(z.object({ recordingId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('queue_transcription', { _recording_id: input.recordingId });
      if (error) throwFromRpcError(error, 'queue transcription');
      await tickWorkersSafely('transcription');
      return { ok: true as const };
    }),

  /** Recording status + its full transition history. */
  recording: clinicalAuthenticatedProcedure
    .input(z.object({ recordingId: uuid }))
    .query(async ({ ctx, input }) => {
      const rec = await ctx.clinicalDb
        .from('encounter_recordings')
        .select(
          'id, encounter_id, patient_id, provider, status, content_type, audio_bytes, duration_ms, legal_hold, deletion_deadline, audio_deleted_at, deletion_proof, failure_reason, validation_result, created_at',
        )
        .eq('id', input.recordingId)
        .maybeSingle();
      if (rec.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load recording' });
      if (!rec.data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found or not accessible' });
      const transitions = await ctx.clinicalDb
        .from('recording_state_transitions')
        .select('from_status, to_status, reason, created_at')
        .eq('recording_id', input.recordingId)
        .order('created_at', { ascending: true });
      const r = rec.data as Record<string, unknown>;
      return {
        id: r.id as string,
        encounterId: r.encounter_id as string,
        patientId: r.patient_id as string,
        provider: r.provider as string,
        status: r.status as string,
        contentType: (r.content_type as string | null) ?? null,
        audioBytes: (r.audio_bytes as number | null) ?? null,
        durationMs: (r.duration_ms as number | null) ?? null,
        legalHold: Boolean(r.legal_hold),
        deletionDeadline: r.deletion_deadline as string,
        audioDeletedAt: (r.audio_deleted_at as string | null) ?? null,
        deletionProof: (r.deletion_proof as string | null) ?? null,
        failureReason: (r.failure_reason as string | null) ?? null,
        validationResult: (r.validation_result as Record<string, unknown> | null) ?? null,
        createdAt: r.created_at as string,
        transitions: (transitions.data ?? []).map((t) => ({
          from: (t.from_status as string | null) ?? null,
          to: t.to_status as string,
          reason: (t.reason as string | null) ?? null,
          at: t.created_at as string,
        })),
      };
    }),

  /** Layered transcript: raw ASR + provider revisions + corrections. */
  transcript: clinicalAuthenticatedProcedure
    .input(z.object({ recordingId: uuid }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.clinicalDb
        .from('encounter_transcripts')
        .select('id, encounter_id, provider, revision, status, created_at, finalized_at')
        .eq('recording_id', input.recordingId)
        .maybeSingle();
      if (t.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load transcript' });
      if (!t.data) return null;
      const transcriptId = t.data.id as string;
      const [segments, revisions, corrections] = await Promise.all([
        ctx.clinicalDb
          .from('transcript_segments')
          .select('id, seq, speaker_label, start_ms, end_ms, text, confidence')
          .eq('transcript_id', transcriptId)
          .order('seq', { ascending: true }),
        ctx.clinicalDb
          .from('transcript_segment_revisions')
          .select('segment_id, revision, text, confidence')
          .order('revision', { ascending: true }),
        ctx.clinicalDb
          .from('transcript_corrections')
          .select('segment_id, version, source_revision, corrected_text, reason, created_at')
          .eq('transcript_id', transcriptId)
          .order('version', { ascending: true }),
      ]);
      if (segments.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load segments' });
      const revRows = revisions.data ?? [];
      const corrRows = corrections.data ?? [];
      return {
        transcriptId,
        encounterId: t.data.encounter_id as string,
        provider: t.data.provider as string,
        revision: t.data.revision as number,
        status: t.data.status as 'accepted' | 'corrected' | 'finalized',
        finalizedAt: (t.data.finalized_at as string | null) ?? null,
        segments: (segments.data ?? []).map((s) => {
          const segRevisions = revRows
            .filter((r) => r.segment_id === s.id)
            .map((r) => ({ revision: r.revision as number, text: r.text as string, confidence: (r.confidence as number | null) ?? null }));
          const segCorrections = corrRows
            .filter((c) => c.segment_id === s.id)
            .map((c) => ({
              version: c.version as number,
              sourceRevision: c.source_revision as number,
              text: c.corrected_text as string,
              reason: (c.reason as string | null) ?? null,
            }));
          const latestCorrection = segCorrections[segCorrections.length - 1] ?? null;
          const latestRevision = segRevisions[segRevisions.length - 1] ?? null;
          return {
            id: s.id as string,
            seq: s.seq as number,
            speaker: (s.speaker_label as string | null) ?? null,
            startMs: (s.start_ms as number | null) ?? null,
            endMs: (s.end_ms as number | null) ?? null,
            rawText: s.text as string,
            confidence: (s.confidence as number | null) ?? null,
            providerRevisions: segRevisions,
            corrections: segCorrections,
            effectiveText: latestCorrection?.text ?? latestRevision?.text ?? (s.text as string),
            effectiveSource: latestCorrection ? ('correction' as const) : latestRevision ? ('provider_revision' as const) : ('raw' as const),
          };
        }),
      };
    }),

  correctSegment: clinicalAuthenticatedProcedure
    .input(z.object({ segmentId: uuid, correctedText: z.string().min(1).max(8000), reason: z.string().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('correct_transcript_segment', {
        _segment_id: input.segmentId,
        _corrected_text: input.correctedText,
        _reason: input.reason ?? null,
      });
      if (error) throwFromRpcError(error, 'correct segment');
      return { version: data as number };
    }),

  setReview: clinicalAuthenticatedProcedure
    .input(z.object({ transcriptId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('set_transcript_review', { _transcript_id: input.transcriptId });
      if (error) throwFromRpcError(error, 'set transcript review');
      return { ok: true as const };
    }),

  finalizeTranscript: clinicalAuthenticatedProcedure
    .input(z.object({ transcriptId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('finalize_transcript', { _transcript_id: input.transcriptId });
      if (error) throwFromRpcError(error, 'finalize transcript');
      return { ok: true as const };
    }),

  /**
   * Generate a PROPOSED draft note from the transcript. Always a NEW note —
   * the database guarantees an existing practitioner draft is never touched.
   * Model/template identifiers are server-owned.
   */
  generateDraft: clinicalAuthenticatedProcedure
    .input(z.object({ transcriptId: uuid, noteType: z.enum(NOTE_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      let provider: string;
      try {
        provider = resolveProvider(undefined);
      } catch (e) {
        preconditionFromConfig(e);
      }
      const model = provider! === 'fixture' ? 'fixture-scribe-1' : 'healthscribe-clinical-1';
      const { data, error } = await ctx.clinicalDb.rpc('generate_scribe_draft', {
        _transcript_id: input.transcriptId,
        _note_type: input.noteType,
        _model: model,
        _provider: provider!,
        _prompt_template_version: 'm1-scribe-tmpl-v1',
      });
      if (error) throwFromRpcError(error, 'generate scribe draft');
      const r = data as Record<string, unknown>;
      return {
        noteId: r.note_id as string,
        generationId: r.generation_id as string,
        idempotent: Boolean(r.idempotent),
      };
    }),

  requestDeletion: clinicalAuthenticatedProcedure
    .input(z.object({ recordingId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('request_recording_deletion', { _recording_id: input.recordingId });
      if (error) throwFromRpcError(error, 'request deletion');
      await tickWorkersSafely('deletion');
      return { ok: true as const };
    }),

  deletionStatus: clinicalAuthenticatedProcedure
    .input(z.object({ recordingId: uuid }))
    .query(async ({ ctx, input }) => {
      const [rec, jobs] = await Promise.all([
        ctx.clinicalDb
          .from('encounter_recordings')
          .select('status, audio_deleted_at, deletion_proof, legal_hold')
          .eq('id', input.recordingId)
          .maybeSingle(),
        ctx.clinicalDb
          .from('recording_deletion_jobs')
          .select('id, target, status, attempts, last_error, next_attempt_at, dead_lettered_at, confirmation_ref')
          .eq('recording_id', input.recordingId)
          .order('target', { ascending: true }),
      ]);
      if (rec.error || !rec.data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found or not accessible' });
      return {
        recordingStatus: rec.data.status as string,
        audioDeletedAt: (rec.data.audio_deleted_at as string | null) ?? null,
        deletionProof: (rec.data.deletion_proof as string | null) ?? null,
        legalHold: Boolean(rec.data.legal_hold),
        jobs: (jobs.data ?? []).map((j) => ({
          id: j.id as string,
          target: j.target as 'local' | 'provider',
          status: j.status as string,
          attempts: j.attempts as number,
          lastError: (j.last_error as string | null) ?? null,
          nextAttemptAt: j.next_attempt_at as string,
          deadLetteredAt: (j.dead_lettered_at as string | null) ?? null,
          confirmationRef: (j.confirmation_ref as string | null) ?? null,
        })),
      };
    }),

  /** Admin review: quarantined recordings for one organization. */
  quarantined: adminProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('encounter_recordings')
      .select('id, encounter_id, patient_id, status, validation_result, created_at')
      .eq('organization_id', ctx.membership.organizationId)
      .eq('status', 'quarantined')
      .order('created_at', { ascending: false });
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load quarantined recordings' });
    return (data ?? []).map((r) => ({
      id: r.id as string,
      encounterId: r.encounter_id as string,
      patientId: r.patient_id as string,
      validationResult: (r.validation_result as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at as string,
    }));
  }),

  /** Admin review: dead-lettered deletion jobs for one organization. */
  deadLetterJobs: adminProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('recording_deletion_jobs')
      .select('id, target, status, attempts, last_error, dead_lettered_at, encounter_recordings!inner(id, organization_id, patient_id, status)')
      .eq('encounter_recordings.organization_id', ctx.membership.organizationId)
      .not('dead_lettered_at', 'is', null)
      .order('dead_lettered_at', { ascending: false });
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load dead-letter jobs' });
    return (data ?? []).map((j) => {
      const rec = j.encounter_recordings as unknown as { id: string; patient_id: string; status: string };
      return {
        id: j.id as string,
        target: j.target as 'local' | 'provider',
        attempts: j.attempts as number,
        lastError: (j.last_error as string | null) ?? null,
        deadLetteredAt: j.dead_lettered_at as string,
        recordingId: rec.id,
        recordingStatus: rec.status,
      };
    });
  }),

  /** Admin: reset a dead-lettered deletion job for retry (audited). */
  retryDeadLetterJob: clinicalAuthenticatedProcedure
    .input(z.object({ jobId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('retry_dead_letter_deletion_job', { _job_id: input.jobId });
      if (error) throwFromRpcError(error, 'retry deletion job');
      await tickWorkersSafely('deletion');
      return { ok: true as const };
    }),

  /** Access/export events → security access log (never audit_events). */
  logAccess: clinicalAuthenticatedProcedure
    .input(z.object({ transcriptId: uuid, kind: z.enum(['accessed', 'exported']) }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('log_transcript_access', {
        _transcript_id: input.transcriptId,
        _kind: input.kind,
      });
      if (error) throwFromRpcError(error, 'log transcript access');
      return { ok: true as const };
    }),
});
