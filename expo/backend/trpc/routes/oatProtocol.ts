import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { sanitizeSearchInput } from "../sanitize";

const DirectionSchema = z.enum(["high", "low"]);

const CategorySchema = z.enum([
  "energy_metabolism",
  "nutrition_oxalates",
  "detoxification_oxidative_stress",
  "amino_acids",
  "neurotransmitters",
  "microbial",
]);

const MicrobialClassificationSchema = z.enum([
  "mold",
  "fungal",
  "bacterial",
  "clostridia",
]);

export const oatProtocolRouter = createTRPCRouter({
  /**
   * Get a single OAT biomarker interpretation by name and direction.
   */
  getInterpretation: protectedProcedure
    .input(
      z.object({
        biomarkerName: z.string().min(1),
        direction: DirectionSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("oat_biomarker_interpretations")
        .select("*")
        .eq("biomarker_name", input.biomarkerName)
        .eq("direction", input.direction)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No interpretation found for ${input.biomarkerName} (${input.direction})`,
        });
      }

      return data;
    }),

  /**
   * Get all OAT biomarker interpretations for a given category.
   */
  getByCategory: protectedProcedure
    .input(
      z.object({
        category: CategorySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("oat_biomarker_interpretations")
        .select("*")
        .eq("category", input.category)
        .eq("is_active", true)
        .order("biomarker_name");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch OAT interpretations by category",
        });
      }

      return data ?? [];
    }),

  /**
   * Get all active OAT biomarker interpretations grouped by category.
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data, error } = await sb
      .from("oat_biomarker_interpretations")
      .select("*")
      .eq("is_active", true)
      .order("category")
      .order("biomarker_name");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch OAT interpretations",
      });
    }

    const rows = data ?? [];

    // Group by category
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const cat = row.category as string;
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push(row);
    }

    return grouped;
  }),

  /**
   * Search OAT biomarker interpretations by name (ilike).
   */
  search: protectedProcedure
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
        .from("oat_biomarker_interpretations")
        .select("*")
        .ilike("biomarker_name", `%${sanitized}%`)
        .eq("is_active", true)
        .order("biomarker_name");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search OAT interpretations",
        });
      }

      return data ?? [];
    }),

  /**
   * Get all microbial OAT biomarker interpretations grouped by classification.
   */
  getMicrobialClassification: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data, error } = await sb
      .from("oat_biomarker_interpretations")
      .select("*")
      .eq("category", "microbial")
      .eq("is_active", true)
      .not("microbial_classification", "is", null)
      .order("microbial_classification")
      .order("biomarker_name");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch microbial classifications",
      });
    }

    const rows = data ?? [];

    // Group by microbial_classification
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const cls = row.microbial_classification as string;
      if (!grouped[cls]) {
        grouped[cls] = [];
      }
      grouped[cls].push(row);
    }

    return grouped;
  }),
});
