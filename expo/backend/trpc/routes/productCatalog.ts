import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { sanitizeSearchInput } from "../sanitize";

/**
 * Product Catalog Router
 * Dr. Bright's recommended supplements with affiliate links.
 * Supports keyword matching for the recommendation engine.
 */
export const productCatalogRouter = createTRPCRouter({
  /** Get all active products grouped by category */
  getAll: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('recommended_products')
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('priority');

      const grouped: Record<string, Array<Record<string, unknown>>> = {};
      (data ?? []).forEach((row: Record<string, unknown>) => {
        const cat = row.category as string;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({
          id: row.id,
          productName: row.product_name,
          company: row.company,
          bestFor: row.best_for,
          affiliateUrl: row.affiliate_url,
          orderCode: row.order_code,
          priority: row.priority,
        });
      });
      return grouped;
    }),

  /** Get products by category */
  getByCategory: protectedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('recommended_products')
        .select('*')
        .eq('category', input.category)
        .eq('is_active', true)
        .order('priority');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        productName: row.product_name as string,
        company: row.company as string,
        bestFor: row.best_for as string,
        broadMatchKeywords: row.broad_match_keywords as string[],
        affiliateUrl: row.affiliate_url as string,
        orderCode: row.order_code as string | null,
        priority: row.priority as number,
      }));
    }),

  /** Search products by name, best_for, or keywords */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const safe = sanitizeSearchInput(input.query);

      const { data } = await sb
        .from('recommended_products')
        .select('*')
        .eq('is_active', true)
        .or(`product_name.ilike.%${safe}%,best_for.ilike.%${safe}%`)
        .order('priority');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        productName: row.product_name as string,
        company: row.company as string,
        category: row.category as string,
        bestFor: row.best_for as string,
        affiliateUrl: row.affiliate_url as string,
        orderCode: row.order_code as string | null,
        priority: row.priority as number,
      }));
    }),

  /**
   * Match products by supplement keywords.
   * This is the key endpoint: when a protocol recommends "curcumin",
   * this returns Resolve+ by Healthgevity with the affiliate link.
   */
  matchByKeywords: protectedProcedure
    .input(z.object({ keywords: z.array(z.string()).min(1).max(20) }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('recommended_products')
        .select('*')
        .eq('is_active', true);

      if (!data) return [];

      // Score each product by keyword overlap
      const lowerKeywords = input.keywords.map((k) => k.toLowerCase());
      const scored = data
        .map((row: Record<string, unknown>) => {
          const productKeywords = (row.broad_match_keywords as string[] ?? []).map((k) => k.toLowerCase());
          const matchCount = lowerKeywords.filter((k) =>
            productKeywords.some((pk) => pk.includes(k) || k.includes(pk))
          ).length;
          return {
            id: row.id as string,
            productName: row.product_name as string,
            company: row.company as string,
            category: row.category as string,
            bestFor: row.best_for as string,
            affiliateUrl: row.affiliate_url as string,
            orderCode: row.order_code as string | null,
            priority: row.priority as number,
            matchScore: matchCount,
          };
        })
        .filter((p) => p.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore || a.priority - b.priority);

      return scored;
    }),

  /** Get all unique categories */
  getCategories: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('recommended_products')
        .select('category')
        .eq('is_active', true);

      const categories = new Set<string>();
      (data ?? []).forEach((row: Record<string, unknown>) => {
        categories.add(row.category as string);
      });
      return Array.from(categories).sort();
    }),
});
