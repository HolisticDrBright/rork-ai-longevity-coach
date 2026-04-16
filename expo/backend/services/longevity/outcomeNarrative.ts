/**
 * Narrative generator for the Month 6 outcome report.
 *
 * The narrative is the one part of the report that is free text, so we want
 * to drive it with the actual numbers — no hallucinated improvements.
 * This module computes a deterministic draft from the structured report and
 * optionally routes it through Claude for polish. Claude only receives the
 * numbers we extracted ourselves; it cannot invent metrics.
 */

import { z } from 'zod';
import { generateObject } from '@rork-ai/toolkit-sdk';
import type { OutcomeReport, NarrativeBlock } from './outcomeReportTypes';

export const NARRATIVE_SYSTEM_PROMPT_VERSION = '2026-04-16-v1';

const NarrativeSchema = z.object({
  topWins: z.array(z.string()).min(1).max(5),
  topGaps: z.array(z.string()).min(1).max(5),
  maintenanceRecommendation: z.string().min(40),
});

const SYSTEM_PROMPT = `You are writing the narrative summary for a 6-month longevity protocol outcome report.

RULES (non-negotiable):
- You MAY ONLY reference metrics and numbers that are present in the structured report JSON provided by the user. Do NOT invent any values, trends, or outcomes.
- If a metric is missing or direction is "unknown", do NOT include it — skip it entirely.
- Keep each win/gap item to ONE short sentence that names the metric and quantifies the change.
- topWins should be the 3 most clinically meaningful positive shifts, ranked by impact.
- topGaps should be 2-3 items that remain off-target or declined.
- maintenanceRecommendation should be 2-3 sentences describing how to hold gains and close gaps, referencing only interventions that are clinically appropriate given the data.
- Voice: direct, clinical, encouraging but not hype. This goes to both the patient and their practitioner.
- Never use phrases like "significant", "dramatic", or "transformation" unless the deltaPercent genuinely supports it (>30%).
- No medical advice disclaimers — that is handled separately by the UI.

Output strictly valid JSON matching the schema.`;

function deterministicDraft(report: OutcomeReport): NarrativeBlock {
  const wins: string[] = [];
  const gaps: string[] = [];

  const metrics = [
    report.biologicalAge.deltaYears != null && report.biologicalAge.direction === 'improved'
      ? `Biological age dropped ${Math.abs(report.biologicalAge.deltaYears).toFixed(1)} years.`
      : null,
    report.inflammation.crp?.direction === 'improved' ? report.inflammation.crp.summary : null,
    report.inflammation.il6?.direction === 'improved' ? report.inflammation.il6.summary : null,
    report.wearables.hrv?.direction === 'improved' ? report.wearables.hrv.summary : null,
    report.wearables.restingHr?.direction === 'improved' ? report.wearables.restingHr.summary : null,
    report.wearables.deepSleepPct?.direction === 'improved' ? report.wearables.deepSleepPct.summary : null,
    report.bodyComp.bodyFatPct?.direction === 'improved' ? report.bodyComp.bodyFatPct.summary : null,
    report.bodyComp.waistToHipRatio?.direction === 'improved' ? report.bodyComp.waistToHipRatio.summary : null,
  ].filter((s): s is string => !!s);

  wins.push(...metrics.slice(0, 3));

  const gapMetrics = [
    report.biologicalAge.direction === 'declined' ? `Biological age trended upward by ${Math.abs(report.biologicalAge.deltaYears ?? 0).toFixed(1)} years.` : null,
    report.inflammation.crp?.direction === 'declined' ? report.inflammation.crp.summary : null,
    report.wearables.hrv?.direction === 'declined' ? report.wearables.hrv.summary : null,
    report.wearables.deepSleepPct?.direction === 'declined' ? report.wearables.deepSleepPct.summary : null,
    report.labShifts.nutrEval.remainingDeficiencies.length > 0
      ? `${report.labShifts.nutrEval.remainingDeficiencies.length} NutrEval deficiencies still need addressing: ${report.labShifts.nutrEval.remainingDeficiencies.slice(0, 3).join(', ')}.`
      : null,
  ].filter((s): s is string => !!s);

  gaps.push(...gapMetrics.slice(0, 3));
  if (gaps.length === 0) gaps.push('No significant gaps detected from available data.');
  if (wins.length === 0) wins.push('Protocol completed — reassessment data captured for the next cycle.');

  const adherencePct = report.adherence.overallPct ?? null;
  const adherenceLine = adherencePct != null
    ? `Overall adherence was ${adherencePct}%.`
    : '';

  const maintenanceRecommendation = [
    `Continue the foundational supplement stack (NAD+ maintenance, omega-3, D3/K2, magnesium).`,
    adherenceLine,
    `Re-run key biomarkers (hs-CRP, fasting insulin, HbA1c, IGF-1, TruAge) in 3-6 months to confirm the trajectory holds.`,
  ].filter(Boolean).join(' ');

  return {
    topWins: wins,
    topGaps: gaps,
    maintenanceRecommendation,
  };
}

export interface NarrativeResult {
  narrative: NarrativeBlock;
  method: 'deterministic' | 'claude' | 'claude_fallback';
  systemPromptVersion: string;
}

export async function generateNarrative(
  report: OutcomeReport,
  useClaude: boolean,
): Promise<NarrativeResult> {
  const draft = deterministicDraft(report);

  if (!useClaude) {
    return {
      narrative: draft,
      method: 'deterministic',
      systemPromptVersion: NARRATIVE_SYSTEM_PROMPT_VERSION,
    };
  }

  try {
    const result = await generateObject({
      messages: [
        { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
        {
          role: 'user',
          content: [{ type: 'text', text:
            `Here is the structured outcome report. Generate the narrative JSON.\n\n` +
            JSON.stringify({
              biologicalAge: report.biologicalAge,
              inflammation: report.inflammation,
              wearables: report.wearables,
              bodyComp: report.bodyComp,
              labShifts: report.labShifts,
              adherence: report.adherence,
              patientReported: report.patientReported,
            }, null, 2),
          }],
        },
      ] as any,
      schema: NarrativeSchema as any,
    });
    const parsed = NarrativeSchema.parse(result);
    return {
      narrative: {
        topWins: parsed.topWins,
        topGaps: parsed.topGaps,
        maintenanceRecommendation: parsed.maintenanceRecommendation,
      },
      method: 'claude',
      systemPromptVersion: NARRATIVE_SYSTEM_PROMPT_VERSION,
    };
  } catch {
    return {
      narrative: draft,
      method: 'claude_fallback',
      systemPromptVersion: NARRATIVE_SYSTEM_PROMPT_VERSION,
    };
  }
}
