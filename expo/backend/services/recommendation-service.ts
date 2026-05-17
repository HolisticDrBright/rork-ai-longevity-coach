/**
 * Recommendation Service — the deterministic layer that prevents the
 * LLM from hallucinating products.
 *
 * Per the build prompt's three-step architecture:
 *   1. Analyzer LLM emits findings + tags (NEVER product names).
 *   2. This service queries approved_products joined to recommendation_rules
 *      using those tags + the patient's exclusion flags + skin types.
 *      Pure SQL. No LLM in this step.
 *   3. Copy Generator (narrow LLM call) receives ONLY the chosen products
 *      and writes personalized copy from the recommendation_rules
 *      example_copy_template.
 *
 * Every call writes a recommendation_renders row for audit. Practitioner
 * portal's "Why this product?" drill-down reads from that table joined
 * to product_sources.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface RecommendationInput {
  userId: string;
  sessionId?: string;
  // From the analyzer's recommendation_finding_tags output
  findingTags: string[];
  // Pregnancy / lactation / isotretinoin / rosacea_active / eczema_active /
  // recent_procedure / etc. - emitted by the analyzer as
  // medical_history_exclusions, augmented server-side from the user's
  // contraindications row (we never trust the LLM-emitted set alone).
  exclusions: string[];
  // From the analyzer's skin_type_tendencies output
  skinTypes: string[];
  // How many products per category to return
  maxPerCategory?: number;
}

export interface RecommendedProduct {
  id: string;
  brand_id: string;
  brand_name: string;
  product_name: string;
  product_type: string | null;
  recommendation_category_id: string | null;
  category_name: string | null;
  actives_positioning: string | null;
  when_to_use: string | null;
  routine_slot: string | null;
  verification_level: string;
  source_url: string | null;
  matched_tags: string[];
  tag_match_count: number;
  priority: number;
}

export interface RecommendationResult {
  products: RecommendedProduct[];
  dbVersion: number;
  recommendationRenderId: string | null;
}

/**
 * Core query — runs against approved_products joined to recommendation_rules.
 *
 * Logic:
 *   1. Eligible = products whose exclusion_flags don't intersect with the
 *      user's exclusion set, AND verification_level is 'verified' or
 *      'official' (NEVER 'pending'), AND best_skin_types either overlaps
 *      with the user's skin types or contains 'all'.
 *   2. Matched = eligible joined to recommendation_rules where the rule's
 *      finding_tag intersects the input findingTags, with tag_match_count
 *      (size of intersection).
 *   3. Ranked = matched windowed by category, ordered by
 *      (priority ASC, tag_match_count DESC, verification_level
 *      preference). Top N per category.
 *
 * RLS bypass: this service runs server-side with the service-role key so
 * it can read approved_products (which is also readable by authenticated
 * users — the bypass is just to keep the SQL plan predictable).
 */
export async function recommendProducts(
  sb: SupabaseClient,
  input: RecommendationInput,
): Promise<RecommendationResult> {
  const { userId, sessionId, findingTags, exclusions, skinTypes } = input;
  const maxPerCat = input.maxPerCategory ?? 2;

  if (findingTags.length === 0) {
    return { products: [], dbVersion: 0, recommendationRenderId: null };
  }

  // We can't do all the WITH / window-function logic via supabase-js
  // directly without a stored procedure. The simpler path: pull eligible
  // products that have any finding_tag intersection, then rank in JS.
  // For 81 products in v1 this is fine (the entire table fits in memory).
  // When the catalog grows we'll move to a Postgres function.
  const { data: productsData, error: productsErr } = await sb
    .from('approved_products')
    .select(`
      id, brand_id, product_name, product_type, recommendation_category_id,
      actives_positioning, when_to_use, routine_slot, verification_level,
      source_url, exclusion_flags, finding_tags, best_skin_types, priority,
      db_version,
      approved_brands ( brand_name ),
      recommendation_categories ( category_name )
    `)
    .in('verification_level', ['verified', 'official'])
    .overlaps('finding_tags', findingTags);

  if (productsErr) throw new Error(`Recommendation query failed: ${productsErr.message}`);
  // supabase-js types nested-select results as arrays even for to-one joins.
  // Cast through unknown to express the shape we actually expect at runtime.
  const products = (productsData as unknown as Array<{
    id: string;
    brand_id: string;
    product_name: string;
    product_type: string | null;
    recommendation_category_id: string | null;
    actives_positioning: string | null;
    when_to_use: string | null;
    routine_slot: string | null;
    verification_level: string;
    source_url: string | null;
    exclusion_flags: string[];
    finding_tags: string[];
    best_skin_types: string[];
    priority: number;
    db_version: number;
    approved_brands: { brand_name: string } | { brand_name: string }[] | null;
    recommendation_categories: { category_name: string } | { category_name: string }[] | null;
  }>) ?? [];

  const flatten = <T,>(maybeArray: T | T[] | null | undefined): T | null => {
    if (Array.isArray(maybeArray)) return maybeArray[0] ?? null;
    return maybeArray ?? null;
  };

  if (products.length === 0) {
    return { products: [], dbVersion: 0, recommendationRenderId: null };
  }

  // In-JS filtering + ranking
  const exclusionSet = new Set(exclusions.map(e => e.toLowerCase()));
  const skinTypeSet = new Set(skinTypes.map(s => s.toLowerCase()));
  const findingTagSet = new Set(findingTags);

  const eligible: RecommendedProduct[] = [];
  for (const p of products) {
    // Exclusion filter
    if (p.exclusion_flags.some(f => exclusionSet.has(f.toLowerCase()))) continue;

    // Skin-type filter
    if (p.best_skin_types.length > 0) {
      const hasAll = p.best_skin_types.includes('all');
      const overlap = p.best_skin_types.some(t => skinTypeSet.has(t.toLowerCase()));
      if (!hasAll && skinTypeSet.size > 0 && !overlap) continue;
    }

    // Compute matched tags
    const matched = p.finding_tags.filter(t => findingTagSet.has(t));
    if (matched.length === 0) continue;

    const brand = flatten(p.approved_brands);
    const category = flatten(p.recommendation_categories);
    eligible.push({
      id: p.id,
      brand_id: p.brand_id,
      brand_name: brand?.brand_name ?? '(unknown)',
      product_name: p.product_name,
      product_type: p.product_type,
      recommendation_category_id: p.recommendation_category_id,
      category_name: category?.category_name ?? null,
      actives_positioning: p.actives_positioning,
      when_to_use: p.when_to_use,
      routine_slot: p.routine_slot,
      verification_level: p.verification_level,
      source_url: p.source_url,
      matched_tags: matched,
      tag_match_count: matched.length,
      priority: p.priority,
    });
  }

  // Rank: lower priority number wins (1 = highest), then more tag matches
  // wins, then 'official' verification wins over 'verified'.
  const verificationRank = (v: string) => (v === 'official' ? 0 : v === 'verified' ? 1 : 2);
  eligible.sort((a, b) => {
    const byPriority = a.priority - b.priority;
    if (byPriority !== 0) return byPriority;
    const byTags = b.tag_match_count - a.tag_match_count;
    if (byTags !== 0) return byTags;
    return verificationRank(a.verification_level) - verificationRank(b.verification_level);
  });

  // Cap per category
  const byCategory = new Map<string, RecommendedProduct[]>();
  for (const p of eligible) {
    const key = p.recommendation_category_id ?? '__no_category__';
    const list = byCategory.get(key) ?? [];
    if (list.length < maxPerCat) list.push(p);
    byCategory.set(key, list);
  }
  const finalProducts = Array.from(byCategory.values()).flat();

  // db_version: the highest db_version across the returned products is
  // what we record on the recommendation_renders row.
  const dbVersion = products.reduce((m, p) => Math.max(m, p.db_version ?? 0), 0);

  // Audit write
  let recommendationRenderId: string | null = null;
  const { data: renderRow, error: renderErr } = await sb
    .from('recommendation_renders')
    .insert({
      session_id: sessionId ?? null,
      user_id: userId,
      finding_tags: findingTags,
      exclusions,
      db_version_used: dbVersion,
      products_returned: finalProducts as unknown as Record<string, unknown>[],
      copy_generated: null,
    })
    .select('id')
    .maybeSingle();
  if (renderErr) {
    console.error('[recommendation-service] audit write failed (non-blocking):', renderErr.message);
  } else {
    recommendationRenderId = (renderRow as { id: string } | null)?.id ?? null;
  }

  return {
    products: finalProducts,
    dbVersion,
    recommendationRenderId,
  };
}

/**
 * Fetches the per-finding-tag example copy templates from
 * recommendation_rules. Used by the Copy Generator to build personalized
 * recommendation paragraphs grounded in Dr. Bright's template language.
 */
export async function fetchCopyTemplates(
  sb: SupabaseClient,
  findingTags: string[],
): Promise<Array<{ finding_tag: string; example_copy_template: string | null; avoid_caution: string | null; primary_category: string | null }>> {
  if (findingTags.length === 0) return [];
  const { data, error } = await sb
    .from('recommendation_rules')
    .select('finding_tag, example_copy_template, avoid_caution, primary_category')
    .in('finding_tag', findingTags);
  if (error) {
    console.error('[recommendation-service] copy template fetch failed:', error.message);
    return [];
  }
  return (data as Array<{ finding_tag: string; example_copy_template: string | null; avoid_caution: string | null; primary_category: string | null }>) ?? [];
}

/**
 * Convenience constructor for the service-role client. Hono / edge
 * function entry points use this so they don't all need the same
 * boilerplate.
 */
export function createServiceRoleClient(supabaseUrl: string, serviceKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}
