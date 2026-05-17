/**
 * visualDiagnostics tRPC router — typed surface for the patient UI and
 * practitioner review queue.
 *
 * Patient endpoints:
 *   - listSessions / getSession / getSignedAssetUrl
 *
 * Practitioner endpoints (protectedProcedure — full clinician role gating
 * still lives in the underlying RLS, this just exposes the typed shape):
 *   - listReviewQueue / signOffSession / acknowledgeRedFlag
 *   - listRecommendationRenders / addCopyOverride
 *
 * The actual analysis/correlation work runs in edge functions (see
 * expo/supabase/functions/visual-analysis + visual-correlator) and is
 * triggered from the client via supabase.functions.invoke. This router
 * is read-mostly + final practitioner actions.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, createTRPCRouter } from '../../create-context';
import { createServerSupabaseClient } from '../../../supabase-server';

const STORAGE_BUCKET = 'visual-diagnostics';
const SIGNED_URL_TTL_SECONDS = 5 * 60;

const sessionStatusSchema = z.enum([
  'pending', 'analyzing', 'correlating', 'rendering',
  'review_pending', 'signed_off', 'render_failed', 'failed',
]);

const modalitySchema = z.enum(['skin', 'tcm_face', 'tongue', 'nails', 'iris']);

export const visualDiagnosticsRouter = createTRPCRouter({
  // ─── Patient endpoints ───────────────────────────────────────

  listSessions: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('visual_sessions')
        .select('id, captured_at, status, visual_health_index, is_baseline')
        .eq('user_id', ctx.user.id)
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list sessions' });
      }
      return data ?? [];
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const [sessionRes, findingsRes, convergentRes, divergentRes, redFlagsRes, imagesRes] =
        await Promise.all([
          sb.from('visual_sessions')
            .select('id, user_id, captured_at, status, visual_health_index, is_baseline, session_inputs_json, notes')
            .eq('id', input.sessionId).maybeSingle(),
          sb.from('visual_findings')
            .select('modality, structured_findings, cross_modality_tags, red_flags, confidence, prompt_version, model_version, created_at')
            .eq('session_id', input.sessionId),
          sb.from('visual_convergent_findings')
            .select('tag, contributing_modalities, combined_confidence, trend')
            .eq('session_id', input.sessionId),
          sb.from('visual_divergent_findings')
            .select('tag_a, tag_b, note')
            .eq('session_id', input.sessionId),
          sb.from('visual_red_flag_alerts')
            .select('id, modality, severity, observation, recommended_action, acknowledged_at, clinic_alert_event_id')
            .eq('session_id', input.sessionId)
            .order('severity'),
          sb.from('visual_session_images')
            .select('id, modality, angle, storage_key, mime_type, captured_at')
            .eq('session_id', input.sessionId),
        ]);

      if (!sessionRes.data) return null;
      // RLS already enforces ownership, but double-check for clarity
      if (sessionRes.data.user_id !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your session' });
      }
      return {
        session: sessionRes.data,
        findings: findingsRes.data ?? [],
        convergent: convergentRes.data ?? [],
        divergent: divergentRes.data ?? [],
        redFlags: redFlagsRes.data ?? [],
        images: imagesRes.data ?? [],
      };
    }),

  /**
   * Returns a short-lived signed URL for an image or sidecar artifact.
   * Storage RLS already restricts to the owning user, but signed URLs
   * are how the RN <Image> tag actually loads the asset.
   */
  getSignedAssetUrl: protectedProcedure
    .input(z.object({ storageKey: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      // Defense-in-depth: storage RLS already gates this, but verify
      // the key starts with the user's UUID prefix.
      if (!input.storageKey.startsWith(`${ctx.user.id}/`)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Asset not yours' });
      }
      const { data, error } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(input.storageKey, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Sign failed: ${error?.message}` });
      }
      return { url: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
    }),

  // ─── Practitioner endpoints ─────────────────────────────────

  /**
   * Returns sessions awaiting practitioner review, ordered by red-flag
   * severity then capture date. RLS on visual_sessions still applies —
   * the practitioner role grant + clinician-scope policy must permit
   * cross-user reads. (Current RLS is owner-only; the practitioner
   * role-based policy is a Phase 2 expansion.)
   */
  listReviewQueue: protectedProcedure
    .input(z.object({
      status: sessionStatusSchema.default('review_pending'),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const status = input?.status ?? 'review_pending';
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('visual_sessions')
        .select('id, user_id, captured_at, status, visual_health_index, is_baseline')
        .eq('status', status)
        .order('captured_at', { ascending: false })
        .limit(limit);
      if (error) {
        // Distinguish RLS denials from other errors
        if ((error as { code?: string }).code === 'PGRST301') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized for review queue (clinician role required)' });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list review queue' });
      }
      if (!data) return [];

      const sessionIds = data.map(s => s.id);
      if (sessionIds.length === 0) return [];

      const { data: redFlagCounts } = await sb
        .from('visual_red_flag_alerts')
        .select('session_id, severity')
        .in('session_id', sessionIds);

      const countsBySession = new Map<string, { critical: number; high: number; total: number }>();
      for (const rf of redFlagCounts ?? []) {
        const sid = rf.session_id as string;
        const sev = rf.severity as string;
        const c = countsBySession.get(sid) ?? { critical: 0, high: 0, total: 0 };
        if (sev === 'critical') c.critical += 1;
        if (sev === 'high') c.high += 1;
        c.total += 1;
        countsBySession.set(sid, c);
      }
      return data.map(s => ({
        ...s,
        redFlagCounts: countsBySession.get(s.id) ?? { critical: 0, high: 0, total: 0 },
      }));
    }),

  signOffSession: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      reviewerNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('visual_sessions')
        .update({
          status: 'signed_off',
          notes: input.reviewerNotes ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.sessionId)
        .select('id, status')
        .single();
      if (error || !data) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Sign-off failed: ${error?.message}` });
      }
      return data;
    }),

  acknowledgeRedFlag: protectedProcedure
    .input(z.object({ redFlagId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('visual_red_flag_alerts')
        .update({
          acknowledged_by: ctx.user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq('id', input.redFlagId)
        .select('id, acknowledged_at')
        .single();
      if (error || !data) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Acknowledge failed: ${error?.message}` });
      }
      return data;
    }),

  /**
   * Returns recommendation renders for a session — used by the
   * practitioner "Why this product?" drill-down.
   */
  listRecommendationRenders: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('recommendation_renders')
        .select('id, finding_tags, exclusions, db_version_used, products_returned, copy_generated, created_at')
        .eq('session_id', input.sessionId)
        .order('created_at', { ascending: false });
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list renders' });
      }
      return data ?? [];
    }),

  // ─── Product DB read (used by the practitioner admin screen) ─

  listApprovedProducts: protectedProcedure
    .input(z.object({
      verificationLevel: z.enum(['pending', 'verified', 'official']).optional(),
      categoryName: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb
        .from('approved_products')
        .select(`
          id, product_name, product_type, actives_positioning, when_to_use,
          routine_slot, verification_level, source_url, exclusion_flags,
          finding_tags, best_skin_types, priority, db_version,
          approved_brands ( brand_name ),
          recommendation_categories ( category_name )
        `)
        .order('priority')
        .limit(input?.limit ?? 100);
      if (input?.verificationLevel) {
        query = query.eq('verification_level', input.verificationLevel);
      }
      const { data, error } = await query;
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list products' });
      }
      // Optional category filter (post-fetch because category is a joined column)
      const filtered = input?.categoryName
        ? (data ?? []).filter((p: Record<string, unknown>) => {
            const cat = p.recommendation_categories as { category_name?: string } | { category_name?: string }[] | null;
            const catName = Array.isArray(cat) ? cat[0]?.category_name : cat?.category_name;
            return catName === input.categoryName;
          })
        : (data ?? []);
      return filtered;
    }),
});
