/**
 * Backfill intervention_events from existing protocol + adherence records.
 *
 * For protocols already running, we want retroactive event rows so the
 * effectiveness job can compute deltas against them. This runs once on
 * rollout; subsequent events are inserted inline by the protocol builder.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface BackfillResult {
  protocolsSeen: number;
  peptidesSeen: number;
  eventsWritten: number;
  skippedExisting: number;
  errors: string[];
}

export async function backfillInterventionEvents(
  sb: SupabaseClient,
): Promise<BackfillResult> {
  const errors: string[] = [];
  let protocolsSeen = 0;
  let peptidesSeen = 0;
  let eventsWritten = 0;
  let skippedExisting = 0;

  // Pull all active and completed protocols with their peptides
  const { data: protocols } = await sb
    .from('protocols')
    .select('id, user_id, name, start_date, end_date, status, peptides_json');
  for (const protocol of (protocols as any[] ?? [])) {
    protocolsSeen++;
    const startedAt = protocol.start_date ?? protocol.created_at;
    if (!startedAt) continue;

    // Insert a 'protocol' event
    const existing = await sb
      .from('intervention_events')
      .select('id')
      .eq('patient_id', protocol.user_id)
      .eq('intervention_id', protocol.id)
      .eq('event', 'start')
      .maybeSingle();
    if (existing.data) { skippedExisting++; }
    else {
      const { error } = await sb.from('intervention_events').insert({
        patient_id: protocol.user_id,
        intervention_type: 'protocol',
        intervention_id: protocol.id,
        intervention_label: protocol.name ?? 'Unnamed protocol',
        event: 'start',
        started_at: new Date(startedAt).toISOString(),
        ended_at: protocol.end_date ? new Date(protocol.end_date).toISOString() : null,
        source: 'backfill',
      });
      if (error) errors.push(`protocol ${protocol.id}: ${error.message}`);
      else eventsWritten++;
    }

    // Peptides stored as JSONB on the protocol row
    const peptides = Array.isArray(protocol.peptides_json) ? protocol.peptides_json : [];
    for (const pep of peptides) {
      peptidesSeen++;
      const pepId = pep?.id ?? pep?.peptide_id;
      if (!pepId) continue;
      const ex = await sb
        .from('intervention_events')
        .select('id')
        .eq('patient_id', protocol.user_id)
        .eq('intervention_id', pepId)
        .eq('event', 'start')
        .maybeSingle();
      if (ex.data) { skippedExisting++; continue; }
      const { error } = await sb.from('intervention_events').insert({
        patient_id: protocol.user_id,
        intervention_type: 'peptide',
        intervention_id: pepId,
        intervention_label: pep.name ?? pep.label ?? 'Unnamed peptide',
        event: 'start',
        dose_snapshot: pep,
        started_at: new Date(startedAt).toISOString(),
        ended_at: protocol.end_date ? new Date(protocol.end_date).toISOString() : null,
        source: 'backfill',
      });
      if (error) errors.push(`peptide ${pepId}: ${error.message}`);
      else eventsWritten++;
    }
  }

  // Also backfill from protocol_peptides (structured table) if it exists
  const { data: protocolPeptides } = await sb
    .from('protocol_peptides')
    .select('id, protocol_id, peptide_id, dose_amount, dose_unit, frequency, timing, created_at, peptide_library(name)');
  for (const pp of (protocolPeptides as any[] ?? [])) {
    peptidesSeen++;
    const { data: parentProtocol } = await sb
      .from('peptide_protocols')
      .select('user_id, start_date, end_date')
      .eq('id', pp.protocol_id)
      .maybeSingle();
    if (!parentProtocol) continue;
    const startedAt = parentProtocol.start_date ?? pp.created_at;

    const ex = await sb
      .from('intervention_events')
      .select('id')
      .eq('patient_id', parentProtocol.user_id)
      .eq('intervention_id', pp.peptide_id)
      .gte('started_at', new Date(new Date(startedAt).getTime() - 86400000).toISOString())
      .lte('started_at', new Date(new Date(startedAt).getTime() + 86400000).toISOString())
      .maybeSingle();
    if (ex.data) { skippedExisting++; continue; }

    const { error } = await sb.from('intervention_events').insert({
      patient_id: parentProtocol.user_id,
      intervention_type: 'peptide',
      intervention_id: pp.peptide_id,
      intervention_label: pp.peptide_library?.name ?? 'Peptide',
      event: 'start',
      dose_snapshot: { dose_amount: pp.dose_amount, dose_unit: pp.dose_unit, frequency: pp.frequency, timing: pp.timing },
      started_at: new Date(startedAt).toISOString(),
      ended_at: parentProtocol.end_date ? new Date(parentProtocol.end_date).toISOString() : null,
      source: 'backfill',
    });
    if (error) errors.push(`protocol_peptide ${pp.id}: ${error.message}`);
    else eventsWritten++;
  }

  return { protocolsSeen, peptidesSeen, eventsWritten, skippedExisting, errors };
}
