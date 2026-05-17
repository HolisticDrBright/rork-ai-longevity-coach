#!/usr/bin/env tsx
/**
 * ingest-product-db.ts — bulk-loads Dr. Bright's
 * Longevity_Skincare_AI_Product_Database_v2.xlsx into Supabase.
 *
 * The MVP demo runs off the seed migration
 * (20260517000001_visual_diagnostics_product_seed.sql) which covers
 * ~20 hand-curated products. This script does the full ingest when we
 * have the Excel converted to CSV.
 *
 * Usage:
 *   tsx scripts/ingest-product-db.ts <products.csv>
 *
 * Required env:
 *   SUPABASE_URL              — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (write access)
 *
 * Expected CSV columns (header row required):
 *   brand_name, product_name, product_type, category_name,
 *   actives_positioning, when_to_use, routine_slot, source_url,
 *   exclusion_flags (pipe-separated), finding_tags (pipe-separated),
 *   best_skin_types (pipe-separated), priority, verification_level
 *
 * The script is idempotent: it upserts on (brand_id, lower(product_name))
 * for products, on brand_name for brands, on category_name for
 * categories. Re-running with the same CSV will update existing rows
 * with the latest data and bump db_version.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface ProductRow {
  brand_name: string;
  product_name: string;
  product_type: string;
  category_name: string;
  actives_positioning: string;
  when_to_use: string;
  routine_slot: string;
  source_url: string;
  exclusion_flags: string[];
  finding_tags: string[];
  best_skin_types: string[];
  priority: number;
  verification_level: 'pending' | 'verified' | 'official';
}

function parseCsv(text: string): ProductRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('CSV is empty or has no data rows.');
  }
  const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());

  const required = [
    'brand_name', 'product_name', 'product_type', 'category_name',
    'actives_positioning', 'when_to_use', 'routine_slot', 'source_url',
    'exclusion_flags', 'finding_tags', 'best_skin_types',
    'priority', 'verification_level',
  ];
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`Missing required column: ${col}`);
  }
  const colIdx = (name: string) => header.indexOf(name);

  const rows: ProductRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length === 0 || cells.every(c => c === '')) continue;
    const get = (name: string): string => cells[colIdx(name)] ?? '';
    const splitPipes = (s: string): string[] => s.split('|').map(p => p.trim()).filter(Boolean);

    rows.push({
      brand_name: get('brand_name').trim(),
      product_name: get('product_name').trim(),
      product_type: get('product_type').trim(),
      category_name: get('category_name').trim(),
      actives_positioning: get('actives_positioning').trim(),
      when_to_use: get('when_to_use').trim(),
      routine_slot: get('routine_slot').trim(),
      source_url: get('source_url').trim(),
      exclusion_flags: splitPipes(get('exclusion_flags')),
      finding_tags: splitPipes(get('finding_tags')),
      best_skin_types: splitPipes(get('best_skin_types')),
      priority: parseInt(get('priority'), 10) || 5,
      verification_level: (get('verification_level').trim() || 'pending') as ProductRow['verification_level'],
    });
  }
  return rows;
}

// RFC 4180-ish: handles quoted fields with embedded commas/quotes.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else buf += c;
    } else {
      if (c === ',') { cells.push(buf); buf = ''; }
      else if (c === '"') inQuotes = true;
      else buf += c;
    }
  }
  cells.push(buf);
  return cells;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: tsx scripts/ingest-product-db.ts <products.csv>');
    process.exit(1);
  }
  const csvPath = resolve(args[0]);
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const csv = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csv);
  console.log(`[ingest] Parsed ${rows.length} product rows from ${csvPath}`);

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Upsert distinct brands
  const distinctBrands = Array.from(new Set(rows.map(r => r.brand_name).filter(Boolean)));
  for (const brand of distinctBrands) {
    const { error } = await sb
      .from('approved_brands')
      .upsert({ brand_name: brand, status: 'verified' }, { onConflict: 'brand_name' });
    if (error) console.warn(`[ingest] brand "${brand}" upsert: ${error.message}`);
  }

  // 2. Upsert distinct categories
  const distinctCategories = Array.from(new Set(rows.map(r => r.category_name).filter(Boolean)));
  for (const cat of distinctCategories) {
    const { error } = await sb
      .from('recommendation_categories')
      .upsert({ category_name: cat }, { onConflict: 'category_name' });
    if (error) console.warn(`[ingest] category "${cat}" upsert: ${error.message}`);
  }

  // 3. Build brand_name → brand_id and category_name → category_id maps
  const [{ data: brandsData }, { data: catData }] = await Promise.all([
    sb.from('approved_brands').select('id, brand_name'),
    sb.from('recommendation_categories').select('id, category_name'),
  ]);
  const brandIdByName = new Map<string, string>(
    (brandsData ?? []).map((b: { id: string; brand_name: string }) => [b.brand_name, b.id]),
  );
  const catIdByName = new Map<string, string>(
    (catData ?? []).map((c: { id: string; category_name: string }) => [c.category_name, c.id]),
  );

  // 4. Upsert products (chunked to avoid request-size limits)
  const CHUNK = 50;
  let written = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const records = slice
      .map(r => {
        const brand_id = brandIdByName.get(r.brand_name);
        if (!brand_id) {
          console.warn(`[ingest] skipping "${r.product_name}" — brand "${r.brand_name}" not found`);
          skipped += 1;
          return null;
        }
        const category_id = catIdByName.get(r.category_name) ?? null;
        return {
          brand_id,
          product_name: r.product_name,
          product_type: r.product_type || null,
          recommendation_category_id: category_id,
          actives_positioning: r.actives_positioning || null,
          when_to_use: r.when_to_use || null,
          routine_slot: r.routine_slot || null,
          verification_level: r.verification_level,
          source_url: r.source_url || null,
          exclusion_flags: r.exclusion_flags,
          finding_tags: r.finding_tags,
          best_skin_types: r.best_skin_types,
          priority: r.priority,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (records.length === 0) continue;
    const { error } = await sb
      .from('approved_products')
      .upsert(records, { onConflict: 'brand_id,lower(product_name)' });
    if (error) {
      console.error(`[ingest] chunk starting at ${i} failed: ${error.message}`);
      continue;
    }
    written += records.length;
  }

  console.log(`[ingest] Done. wrote=${written}, skipped=${skipped}`);
}

main().catch(err => {
  console.error('[ingest] fatal:', err);
  process.exit(1);
});
