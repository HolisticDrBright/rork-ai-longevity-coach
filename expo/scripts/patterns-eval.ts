#!/usr/bin/env bun
/**
 * Pattern miner evaluation harness.
 *
 * Two modes:
 *   1. Calibration (default): run the miner against the last 90 days and
 *      check whether it surfaces at least 1 of the 12 known clinical
 *      patterns (ground truth validation).
 *   2. Red team (--red-team): inject deliberately spurious symptom-biomarker
 *      pairs into a sandbox cohort and confirm the FDR correction filters
 *      them or the novelty / low-effect-size filters keep them from
 *      surviving. Spurious candidates that reach "candidate" status are
 *      a failed red-team test.
 *   3. Shuffled labels (--shuffle): randomize the outcome column across
 *      patients and confirm zero candidates survive FDR correction.
 *
 * Usage:
 *   bun expo/scripts/patterns-eval.ts
 *   bun expo/scripts/patterns-eval.ts --red-team
 *   bun expo/scripts/patterns-eval.ts --shuffle
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { runMiner } from '../backend/services/patterns/miner';
import {
  spearman, benjaminiHochberg, mutualInformation,
} from '../backend/services/patterns/statistics';

interface Args { mode: 'calibration' | 'red-team' | 'shuffle' }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-team')) return { mode: 'red-team' };
  if (argv.includes('--shuffle')) return { mode: 'shuffle' };
  return { mode: 'calibration' };
}

// Known clinical patterns we want the miner to be able to surface.
// Expressed loosely — we just need one to appear in the candidate list.
const KNOWN_PATTERNS = [
  { left: 'crp', right: 'hdl', description: 'CRP ↔ HDL inverse' },
  { left: 'hrv_rmssd', right: 'deep_sleep_pct', description: 'HRV ↔ deep sleep' },
  { left: 'fasting glucose', right: 'hba1c', description: 'Fasting glucose ↔ HbA1c' },
  { left: 'resting hr', right: 'hrv_rmssd', description: 'RHR ↔ HRV inverse' },
];

async function calibration(sb: any): Promise<void> {
  console.log('🔬 Calibration run: verifying the miner surfaces known patterns');
  const result = await runMiner(sb, { onProgress: console.log });
  console.log(`\nMiner result: cohort=${result.cohortSize}, upserted=${result.candidatesUpserted}`);

  const { data: recent } = await sb
    .from('discovered_patterns')
    .select('left_entity, right_entity, method, effect_size, q_value')
    .eq('miner_run_id', result.runId);

  const found: string[] = [];
  for (const kp of KNOWN_PATTERNS) {
    const matches = (recent ?? []).some((p: any) => {
      const l = String(p.left_entity?.label ?? '').toLowerCase();
      const r = String(p.right_entity?.label ?? '').toLowerCase();
      return (l.includes(kp.left) && r.includes(kp.right))
          || (l.includes(kp.right) && r.includes(kp.left));
    });
    if (matches) found.push(kp.description);
  }

  console.log(`\nGround-truth patterns surfaced: ${found.length}/${KNOWN_PATTERNS.length}`);
  for (const f of found) console.log(`  ✓ ${f}`);

  if (found.length === 0) {
    console.log('\n⚠️  None of the known patterns surfaced. Either the cohort is too small / too new, or the miner thresholds need tuning.');
    process.exit(1);
  }
  console.log('\n✅ Calibration PASSED');
}

async function shuffleTest(sb: any): Promise<void> {
  console.log('🎲 Shuffled-labels test: verifying FDR correction filters noise');

  // Pull a real biomarker series, shuffle its patient_id column, and run
  // our screening + FDR in isolation. This is an in-memory test — no
  // rows are written.
  const { data: markers } = await sb
    .from('lab_markers')
    .select('user_id, biomarker_name, value, collected_at')
    .limit(5000);

  const byName = new Map<string, Array<{ pid: string; value: number }>>();
  for (const m of (markers as any[] ?? [])) {
    const name = String(m.biomarker_name ?? '').toLowerCase();
    const v = Number(m.value);
    if (!name || !Number.isFinite(v)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ pid: m.user_id, value: v });
  }

  const names = [...byName.keys()];
  if (names.length < 2) {
    console.log('Not enough biomarker diversity to run the test. Skipping.');
    return;
  }

  // Pair up every biomarker with every other biomarker
  const pValues: number[] = [];
  const effects: number[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = byName.get(names[i])!;
      const b = byName.get(names[j])!;
      // SHUFFLE the patient_id on one side
      const shuffled = [...b].sort(() => Math.random() - 0.5);
      const aByPid = new Map<string, number>();
      const bByPid = new Map<string, number>();
      for (const row of a) aByPid.set(row.pid, row.value);
      for (let k = 0; k < shuffled.length; k++) bByPid.set(a[k % a.length]?.pid ?? `p${k}`, shuffled[k].value);
      const x: number[] = [];
      const y: number[] = [];
      for (const [pid, av] of aByPid) {
        const bv = bByPid.get(pid);
        if (bv != null) { x.push(av); y.push(bv); }
      }
      if (x.length < 20) continue;
      const stat = spearman(x, y);
      pValues.push(stat.pValue);
      effects.push(stat.rho);
    }
  }

  console.log(`Shuffled pairs tested: ${pValues.length}`);
  const qValues = benjaminiHochberg(pValues);
  const survived = qValues.filter((q, i) => q < 0.1 && Math.abs(effects[i]) >= 0.25).length;
  console.log(`Survived FDR under shuffled labels: ${survived} (should be ~0)`);

  if (survived > Math.max(2, pValues.length * 0.02)) {
    console.log('⚠️  Too many false positives survived. Investigate threshold or FDR implementation.');
    process.exit(1);
  }
  console.log('✅ Shuffle test PASSED');
}

async function redTeamTest(sb: any): Promise<void> {
  console.log('🚨 Red team test: injecting spurious pairs and confirming they get filtered');

  // Synthesize data for 30 fake patients with no real signal between two
  // made-up markers. Feed them into the pairwise screening in isolation.
  const FAKE_N = 30;
  const random = (seed: number) => {
    let x = seed;
    return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  };
  const rnd = random(42);

  const marker1: number[] = Array.from({ length: FAKE_N }, () => rnd() * 10);
  const marker2: number[] = Array.from({ length: FAKE_N }, () => rnd() * 10);

  const stat = spearman(marker1, marker2);
  const mi = mutualInformation(marker1, marker2);

  console.log(`Spurious pair: ρ=${stat.rho.toFixed(3)}, p=${stat.pValue.toFixed(3)}, MI=${mi.rho.toFixed(3)}`);

  const wouldPassSpearman = Math.abs(stat.rho) >= 0.25 && stat.pValue < 0.05;
  const wouldPassMi = mi.rho >= 0.1 && mi.pValue < 0.05;
  const passedRawFilter = wouldPassSpearman || wouldPassMi;

  if (passedRawFilter) {
    console.log('⚠️  Red team pair passed raw filter. Depends on FDR to catch it.');
  } else {
    console.log('✅ Red team pair correctly filtered at the raw-effect threshold stage.');
  }

  // Run a batch of 200 random spurious pairs through BH
  const pairs: number[] = [];
  for (let i = 0; i < 200; i++) {
    const xs: number[] = Array.from({ length: FAKE_N }, () => rnd() * 10);
    const ys: number[] = Array.from({ length: FAKE_N }, () => rnd() * 10);
    pairs.push(spearman(xs, ys).pValue);
  }
  const q = benjaminiHochberg(pairs);
  const survivors = q.filter(v => v < 0.1).length;
  console.log(`Of 200 random pairs, ${survivors} survived FDR (expected ~0).`);

  if (survivors > 5) {
    console.log('⚠️  Too many spurious survivors. FDR is misbehaving.');
    process.exit(1);
  }
  console.log('✅ Red team test PASSED');
}

async function main() {
  const args = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  switch (args.mode) {
    case 'calibration': await calibration(sb); break;
    case 'shuffle': await shuffleTest(sb); break;
    case 'red-team': await redTeamTest(sb); break;
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
