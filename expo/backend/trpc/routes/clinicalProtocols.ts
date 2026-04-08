import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { sanitizeSearchInput } from "../sanitize";

/**
 * Clinical Protocol Decision Engine Router
 *
 * Provides the 4-level supplement progression logic and
 * 15 condition-specific treatment protocols with decision trees.
 */
export const clinicalProtocolsRouter = createTRPCRouter({
  /** Get all 4 protocol levels */
  getLevels: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('protocol_levels')
        .select('*')
        .order('level');
      return (data ?? []).map((row: Record<string, unknown>) => ({
        level: row.level as number,
        levelName: row.level_name as string,
        description: row.description as string,
        prerequisites: row.prerequisites as string | null,
      }));
    }),

  /** Get all anchor products (which product leads for which concern) */
  getAnchorProducts: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('anchor_products')
        .select('*');
      return (data ?? []).map((row: Record<string, unknown>) => ({
        concern: row.concern as string,
        anchorProduct: row.anchor_product as string,
        description: row.description as string,
      }));
    }),

  /** Get all clinical protocols */
  getAll: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('clinical_protocols')
        .select('protocol_name, display_name, use_when, sort_order')
        .eq('is_active', true)
        .order('sort_order');
      return (data ?? []).map((row: Record<string, unknown>) => ({
        protocolName: row.protocol_name as string,
        displayName: row.display_name as string,
        useWhen: row.use_when as string,
        sortOrder: row.sort_order as number,
      }));
    }),

  /** Get a specific protocol with full products and decision logic */
  getProtocol: protectedProcedure
    .input(z.object({ protocolName: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('clinical_protocols')
        .select('*')
        .eq('protocol_name', input.protocolName)
        .single();

      if (error || !data) return null;

      return {
        protocolName: data.protocol_name as string,
        displayName: data.display_name as string,
        useWhen: data.use_when as string,
        products: data.products as Array<{ name: string; role: string; level: number }>,
        decisionLogic: data.decision_logic as Array<Record<string, unknown>>,
        notes: data.notes as string | null,
      };
    }),

  /** Search protocols by symptoms/keywords */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const safe = sanitizeSearchInput(input.query);

      const { data } = await sb
        .from('clinical_protocols')
        .select('protocol_name, display_name, use_when')
        .eq('is_active', true)
        .or(`display_name.ilike.%${safe}%,use_when.ilike.%${safe}%`)
        .order('sort_order');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        protocolName: row.protocol_name as string,
        displayName: row.display_name as string,
        useWhen: row.use_when as string,
      }));
    }),

  /** Match protocols by symptoms — returns ranked matches */
  matchBySymptoms: protectedProcedure
    .input(z.object({
      symptoms: z.array(z.string()).min(1).max(20),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data: protocols } = await sb
        .from('clinical_protocols')
        .select('protocol_name, display_name, use_when, products, decision_logic')
        .eq('is_active', true);

      if (!protocols || protocols.length === 0) return [];

      // Score each protocol by keyword overlap with use_when text
      const scored = protocols.map((p: Record<string, unknown>) => {
        const useWhen = (p.use_when as string).toLowerCase();
        let matchCount = 0;
        for (const symptom of input.symptoms) {
          if (useWhen.includes(symptom.toLowerCase())) {
            matchCount++;
          }
        }
        return {
          protocolName: p.protocol_name as string,
          displayName: p.display_name as string,
          useWhen: p.use_when as string,
          matchScore: matchCount,
          products: p.products as Array<{ name: string; role: string; level: number }>,
          decisionLogic: p.decision_logic as Array<Record<string, unknown>>,
        };
      });

      return scored
        .filter((s) => s.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore);
    }),

  /** Get the foundational stack (Level 1 products across all protocols) */
  getFoundationalStack: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('clinical_protocols')
        .select('products')
        .eq('is_active', true);

      // Extract unique Level 1 products
      const level1Products = new Map<string, string>();
      (data ?? []).forEach((row: Record<string, unknown>) => {
        const products = row.products as Array<{ name: string; role: string; level: number }>;
        products
          .filter((p) => p.level === 1)
          .forEach((p) => {
            if (!level1Products.has(p.name)) {
              level1Products.set(p.name, p.role);
            }
          });
      });

      return Array.from(level1Products.entries()).map(([name, role]) => ({
        name,
        role,
        level: 1,
      }));
    }),
});
