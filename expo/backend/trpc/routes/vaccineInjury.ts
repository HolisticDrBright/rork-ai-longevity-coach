import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { sanitizeSearchInput } from "../sanitize";

/**
 * Vaccine Injury Protocols Router
 * 8 mechanism-based + 6 phenotype-based treatment protocols.
 */
export const vaccineInjuryRouter = createTRPCRouter({
  /** Get all protocols */
  getProtocols: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('vaccine_injury_protocols')
        .select('protocol_type, protocol_name, description')
        .eq('is_active', true)
        .order('protocol_type')
        .order('protocol_name');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        protocolType: row.protocol_type as string,
        protocolName: row.protocol_name as string,
        description: row.description as string,
      }));
    }),

  /** Get protocols by type (mechanism or phenotype) */
  getByType: protectedProcedure
    .input(z.object({ type: z.enum(['mechanism', 'phenotype']) }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('vaccine_injury_protocols')
        .select('*')
        .eq('protocol_type', input.type)
        .eq('is_active', true)
        .order('protocol_name');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        protocolType: row.protocol_type as string,
        protocolName: row.protocol_name as string,
        description: row.description as string,
        nutrients: row.nutrients as Array<{ name: string; mechanism: string; dose: string }>,
        peptides: row.peptides as Array<{ name: string; mechanism: string; dose: string }>,
        lifestyle: row.lifestyle as Array<{ name: string; mechanism: string; dose: string }>,
        testing: row.testing as Array<{ name: string; rationale: string }>,
      }));
    }),

  /** Get a specific protocol by name */
  getProtocol: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('vaccine_injury_protocols')
        .select('*')
        .eq('protocol_name', input.name)
        .single();

      if (!data) return null;

      return {
        protocolType: data.protocol_type as string,
        protocolName: data.protocol_name as string,
        description: data.description as string,
        nutrients: data.nutrients as Array<{ name: string; mechanism: string; dose: string }>,
        peptides: data.peptides as Array<{ name: string; mechanism: string; dose: string }>,
        lifestyle: data.lifestyle as Array<{ name: string; mechanism: string; dose: string }>,
        testing: data.testing as Array<{ name: string; rationale: string }>,
      };
    }),

  /** Search protocols */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const safe = sanitizeSearchInput(input.query);

      const { data } = await sb
        .from('vaccine_injury_protocols')
        .select('protocol_type, protocol_name, description')
        .eq('is_active', true)
        .or(`protocol_name.ilike.%${safe}%,description.ilike.%${safe}%`);

      return (data ?? []).map((row: Record<string, unknown>) => ({
        protocolType: row.protocol_type as string,
        protocolName: row.protocol_name as string,
        description: row.description as string,
      }));
    }),
});
