import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClinicalAnonClient, createClinicalUserClient } from '../clinical-supabase';
import { extractPdfPages, looksLikePdf } from './pdf-text';
import { extractLabMeta, parseLabPages } from './parse';

/**
 * POST /api/clinical/labs/upload — multipart lab-PDF ingestion.
 *
 * Pipeline (every step under the CALLER's identity — no service role):
 *   1. bearer → verified clinical user
 *   2. patient lookup under RLS (invisible patient = not authorized)
 *   3. lab_documents INSERT under RLS
 *   4. storage upload to lab-documents/{org}/{patient}/{doc}.pdf (storage RLS)
 *   5. deterministic text extraction + parse (labs/parse.ts — no AI, no network)
 *   6. ingest_lab_extraction RPC: observations + doc status + review-queue
 *      item + audit event, atomically (migration 0016)
 *   Failure after upload → mark_lab_document_failed RPC: the original PDF
 *   stays stored for manual review; the failure is honest and audited.
 *
 * Logs carry counts and status codes only — never file names, marker values,
 * or patient identifiers.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type FailureReason = 'unreadable_pdf' | 'no_text_extracted' | 'no_markers_found';

const err = (code: string, message: string) => ({ error: { code, message } });

async function markFailed(db: SupabaseClient, documentId: string, reason: FailureReason) {
  const { error } = await db.rpc('mark_lab_document_failed', {
    _document_id: documentId,
    _reason: reason,
  });
  if (error) console.log(`[labs-upload] mark-failed rpc error code=${error.code ?? 'unknown'}`);
  return { data: { documentId, status: 'failed' as const, failureReason: reason } };
}

export const labsUploadApp = new Hono();

labsUploadApp.post('/upload', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return c.json(err('unauthenticated', 'Authentication required'), 401);

  let userId: string | null = null;
  try {
    const { data, error } = await createClinicalAnonClient().auth.getUser(token);
    if (!error && data?.user) userId = data.user.id;
  } catch {
    // fall through — never log the token
  }
  if (!userId) return c.json(err('unauthenticated', 'Authentication required'), 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json(err('invalid', 'Expected multipart/form-data'), 400);
  }
  const patientId = typeof body.patientId === 'string' ? body.patientId : '';
  const file = body.file instanceof File ? body.file : null;

  if (!UUID_RE.test(patientId)) return c.json(err('invalid', 'A patient id is required'), 400);
  if (!file || file.size === 0) return c.json(err('invalid', 'A PDF file is required'), 400);
  if (file.size > MAX_BYTES) return c.json(err('invalid', 'PDF exceeds the 15 MB limit'), 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return c.json(err('invalid', 'File is not a PDF'), 400);

  const db = createClinicalUserClient(token);

  // Patient must be visible under the caller's RLS — also yields the org id.
  const patient = await db
    .from('patient_profiles')
    .select('id, organization_id')
    .eq('id', patientId)
    .maybeSingle();
  if (patient.error) return c.json(err('unavailable', 'Could not verify patient access'), 502);
  if (!patient.data) return c.json(err('forbidden', 'Patient not found or not accessible'), 403);
  const orgId = (patient.data as { organization_id: string }).organization_id;

  const documentId = crypto.randomUUID();
  const storagePath = `${orgId}/${patientId}/${documentId}.pdf`;
  // Original filename is stored (DB is the PHI boundary) but never logged.
  const safeName = (file.name || 'lab-document.pdf').slice(0, 160);

  const inserted = await db.from('lab_documents').insert({
    id: documentId,
    organization_id: orgId,
    patient_id: patientId,
    file_name: safeName,
    file_type: 'application/pdf',
    file_size_bytes: file.size,
    storage_path: storagePath,
    processing_status: 'uploaded',
    uploaded_by: userId,
    source: 'upload',
    created_by: userId,
    updated_by: userId,
  });
  if (inserted.error) {
    const code = inserted.error.code === '42501' ? 403 : 502;
    console.log(`[labs-upload] document insert rejected code=${inserted.error.code ?? 'unknown'}`);
    return c.json(
      code === 403
        ? err('forbidden', 'Not authorized to upload for this patient')
        : err('unavailable', 'Could not record the document'),
      code,
    );
  }

  const uploaded = await db.storage
    .from('lab-documents')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (uploaded.error) {
    console.log('[labs-upload] storage upload failed — rolling back document row');
    await db.from('lab_documents').delete().eq('id', documentId);
    return c.json(err('unavailable', 'Could not store the PDF'), 502);
  }

  // From here the PDF is safely stored: failures become an honest, audited
  // 'failed' document instead of an error, and the file stays for manual review.
  let pages: string[];
  try {
    pages = await extractPdfPages(bytes);
  } catch {
    return c.json(await markFailed(db, documentId, 'unreadable_pdf'));
  }
  if (!pages.some((p) => p.trim().length > 0)) {
    return c.json(await markFailed(db, documentId, 'no_text_extracted'));
  }

  const markers = parseLabPages(pages);
  if (markers.length === 0) {
    return c.json(await markFailed(db, documentId, 'no_markers_found'));
  }
  const meta = extractLabMeta(pages);

  const ingest = await db.rpc('ingest_lab_extraction', {
    _document_id: documentId,
    _markers: markers.map((m) => ({
      name: m.name,
      valueNumeric: m.valueNumeric,
      valueText: m.valueText,
      unit: m.unit,
      referenceInterval: m.referenceInterval,
      flag: m.flag,
      page: m.page,
      confidence: m.confidence,
      originalValue: m.originalValue,
    })),
    _lab_company: meta.labCompany,
    _panel_name: null,
    _lab_date: meta.labDate,
  });
  if (ingest.error) {
    // Document stays 'uploaded' (re-ingestable); report honestly.
    console.log(`[labs-upload] ingest rpc error code=${ingest.error.code ?? 'unknown'}`);
    return c.json(err('unavailable', 'Extraction could not be saved'), 502);
  }

  const summary = ingest.data as {
    document_id: string;
    status: string;
    inserted: number;
    matched: number;
    low_confidence: number;
    queue_item_id: string | null;
  };
  console.log(
    `[labs-upload] extracted doc markers=${summary.inserted} low=${summary.low_confidence} matched=${summary.matched}`,
  );

  return c.json({
    data: {
      documentId: summary.document_id,
      status: 'extracted' as const,
      inserted: summary.inserted,
      matched: summary.matched,
      lowConfidence: summary.low_confidence,
      queueItemId: summary.queue_item_id,
    },
  });
});
