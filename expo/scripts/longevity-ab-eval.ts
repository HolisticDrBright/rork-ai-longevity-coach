#!/usr/bin/env bun
/**
 * A/B evaluation harness for the longevity protocol generator.
 *
 * For each synthetic test patient in __tests__/longevity/fixtures/patients.ts
 * this script runs BOTH the deterministic engine and the Claude generator,
 * then persists the side-by-side pair to `longevity_ab_evaluations` for
 * Dr. Bright to score in the clinic review screen.
 *
 * Usage:
 *   bun expo/scripts/longevity-ab-eval.ts
 *   bun expo/scripts/longevity-ab-eval.ts --fixture tp01-female-premeno-mthfr
 *   bun expo/scripts/longevity-ab-eval.ts --only deterministic   (skip Claude)
 *
 * Env required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (writes need RLS bypass)
 */

import { createClient } from '@supabase/supabase-js';
import { TEST_PATIENTS } from '../__tests__/longevity/fixtures/patients';
import { generateProtocolFromIntake } from '../backend/trpc/routes/longevity/generator';
import {
  generateProtocolWithClaude,
  CLAUDE_MODEL,
} from '../backend/services/longevity/claudeGenerator';
import { SYSTEM_PROMPT_VERSION } from '../backend/services/longevity/systemPrompt';

interface Args {
  fixtureId?: string;
  only?: 'deterministic' | 'claude';
}

function parseArgs(): Args {
  const args: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixtureId = argv[++i];
    else if (argv[i] === '--only') args.only = argv[++i] as Args['only'];
  }
  return args;
}

async function main() {
  const args = parseArgs();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const patients = args.fixtureId
    ? TEST_PATIENTS.filter(p => p.fixtureId === args.fixtureId)
    : TEST_PATIENTS;

  if (patients.length === 0) {
    console.error(`No patients matched fixture id ${args.fixtureId}`);
    process.exit(1);
  }

  console.log(`Running A/B eval on ${patients.length} patient fixtures...`);
  console.log(`Claude model: ${CLAUDE_MODEL}, prompt version: ${SYSTEM_PROMPT_VERSION}\n`);

  let successes = 0;
  let failures = 0;

  for (const patient of patients) {
    console.log(`─── ${patient.name} (${patient.fixtureId}) ───`);

    // Deterministic path
    const detStart = Date.now();
    let deterministic: any;
    try {
      deterministic = generateProtocolFromIntake(patient.intake);
      const detMs = Date.now() - detStart;
      console.log(`  deterministic: ok in ${detMs}ms`);
    } catch (e) {
      console.log(`  deterministic: FAILED — ${e instanceof Error ? e.message : e}`);
      failures++;
      continue;
    }

    // Claude path
    let claude: any = null;
    let claudeMs: number | null = null;
    let claudeError: string | null = null;
    if (args.only !== 'deterministic') {
      const claudeStart = Date.now();
      try {
        const result = await generateProtocolWithClaude(patient.intake);
        claude = result.protocol;
        claudeMs = result.generationMs;
        console.log(`  claude:        ok in ${claudeMs}ms (attempts=${result.attempts})`);
      } catch (e: any) {
        claudeMs = Date.now() - claudeStart;
        claudeError = e?.message ?? String(e);
        console.log(`  claude:        FAILED in ${claudeMs}ms — ${claudeError}`);
      }
    }

    // Persist
    const { error: insertError } = await sb.from('longevity_ab_evaluations').insert({
      patient_fixture_id: patient.fixtureId,
      deterministic,
      claude: claude ?? { error: claudeError, failed: true },
      deterministic_generation_ms: Date.now() - detStart,
      claude_generation_ms: claudeMs,
      claude_model: claude ? CLAUDE_MODEL : null,
      claude_system_prompt_version: claude ? SYSTEM_PROMPT_VERSION : null,
    });

    if (insertError) {
      console.log(`  persist:       FAILED — ${insertError.message}`);
      failures++;
    } else {
      console.log(`  persist:       ok`);
      successes++;
    }
    console.log();
  }

  console.log(`\nDone. ${successes}/${patients.length} evaluations saved. Failures: ${failures}.`);
  console.log(`Review them in the clinic portal at /(tabs)/(clinic)/ab-review`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
