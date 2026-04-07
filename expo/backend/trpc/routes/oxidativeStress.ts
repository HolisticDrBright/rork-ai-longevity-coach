import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { sanitizeSearchInput } from "../sanitize";

export const oxidativeStressRouter = createTRPCRouter({
  /**
   * Get all active oxidative stress biomarkers.
   */
  getBiomarkers: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data, error } = await sb
      .from("oxidative_stress_biomarkers")
      .select("*")
      .eq("is_active", true)
      .order("biomarker_name");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch oxidative stress biomarkers",
      });
    }

    return data ?? [];
  }),

  /**
   * Get a single oxidative stress biomarker by name.
   */
  getBiomarker: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("oxidative_stress_biomarkers")
        .select("*")
        .eq("biomarker_name", input.name)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No oxidative stress biomarker found for "${input.name}"`,
        });
      }

      return data;
    }),

  /**
   * Get all active oxidative stress SNPs.
   */
  getSnps: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data, error } = await sb
      .from("oxidative_stress_snps")
      .select("*")
      .eq("is_active", true)
      .order("gene_name");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch oxidative stress SNPs",
      });
    }

    return data ?? [];
  }),

  /**
   * Get a single oxidative stress SNP by gene name.
   */
  getSnp: protectedProcedure
    .input(
      z.object({
        geneName: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("oxidative_stress_snps")
        .select("*")
        .eq("gene_name", input.geneName)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No oxidative stress SNP found for gene "${input.geneName}"`,
        });
      }

      return data;
    }),

  /**
   * Search oxidative stress biomarkers by name (ilike).
   */
  searchBiomarkers: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const sanitized = sanitizeSearchInput(input.query);

      if (!sanitized) {
        return [];
      }

      const { data, error } = await sb
        .from("oxidative_stress_biomarkers")
        .select("*")
        .ilike("biomarker_name", `%${sanitized}%`)
        .eq("is_active", true)
        .order("biomarker_name");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search oxidative stress biomarkers",
        });
      }

      return data ?? [];
    }),

  /**
   * Get supplement recommendations for a list of biomarker names.
   * Returns matched biomarkers with their supplement protocols.
   */
  getSupplementRecommendations: protectedProcedure
    .input(
      z.object({
        biomarkerNames: z.array(z.string().min(1)).min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("oxidative_stress_biomarkers")
        .select(
          "biomarker_name, what_it_measures, nutrient_supplement_support, recommended_dosing, supportive_tests, lifestyle_factors",
        )
        .in("biomarker_name", input.biomarkerNames)
        .eq("is_active", true)
        .order("biomarker_name");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch supplement recommendations",
        });
      }

      return data ?? [];
    }),
});
