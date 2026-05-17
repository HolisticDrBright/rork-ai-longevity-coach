/**
 * visualAnalyzerClient — orchestrates the patient-side flow:
 *   1. Create a visual_sessions row
 *   2. For each modality the patient is capturing:
 *      - Upload image to the `visual-diagnostics` Storage bucket via
 *        chunked upload (avoids the iOS EMSGSIZE issues we hit in the
 *        lab-analyzer pipeline)
 *      - Insert visual_session_images row pointing at the storage key
 *      - Invoke `visual-analysis` edge function for that modality
 *   3. When all per-modality analyses complete, invoke `visual-correlator`
 *   4. Poll visual_sessions until status === 'review_pending' (or
 *      'failed') and return the assembled report data.
 *
 * Reuses the same chunked upload helper pattern as labAnalyzerClient —
 * the iOS EMSGSIZE constraint applies identically here.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

const BUCKET = 'visual-diagnostics';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;
// 500KB raw → ~680KB base64. Same threshold the lab analyzer uses to
// stay well under iOS's ~1MB EMSGSIZE socket-level limit.
const RAW_CHUNK_SIZE = 500 * 1024;

export type Modality = 'skin' | 'tcm_face' | 'tongue' | 'nails' | 'iris';
export type Angle =
  | 'portrait' | 'tongue_extended' | 'hand_palms_down'
  | 'right_straight' | 'left_straight'
  | 'right_left_gaze' | 'left_right_gaze'
  | 'right_upper_gaze' | 'left_lower_gaze';

export type VisualSessionStatus =
  | 'pending' | 'analyzing' | 'correlating' | 'rendering'
  | 'review_pending' | 'signed_off' | 'render_failed' | 'failed';

export interface ModalityCapture {
  modality: Modality;
  angle: Angle;
  fileUri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileName: string;
}

export interface StartSessionInput {
  captures: ModalityCapture[];
  isBaseline?: boolean;
  // Modality-specific session inputs (tongue extras, iris eye color, etc.)
  sessionInputs?: Record<string, unknown>;
}

export interface VisualSessionResult {
  sessionId: string;
  status: VisualSessionStatus;
  visualHealthIndex: number | null;
  modalitiesAnalyzed: Modality[];
  convergentCount: number;
  divergentCount: number;
  redFlagCount: number;
}

// ────────────────────────────────────────────────────────────
// Upload helpers (chunked via supabase.functions.invoke for iOS safety;
// re-uses the same pattern as labAnalyzerClient.ts)
// ────────────────────────────────────────────────────────────

function generateId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function uploadImageWeb(fileUri: string, objectKey: string, mimeType: string): Promise<void> {
  const res = await fetch(fileUri);
  const blob = await res.blob();
  const { error } = await supabase.storage.from(BUCKET).upload(objectKey, blob, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

/**
 * Native upload uses the chunked lab-upload edge function exclusively.
 *
 * Why not supabase-js direct or FileSystem.uploadAsync? labAnalyzerClient
 * documents that EVERY single-request variant — supabase-js storage.upload,
 * FileSystem.uploadAsync BINARY_CONTENT, MULTIPART, FOREGROUND/BACKGROUND
 * session, signed URL PUT — hits iOS NSPOSIXErrorDomain Code=40
 * "Message too long" at the socket layer for files >~1MB. Camera JPEGs at
 * quality 0.85 routinely cross that threshold. The chunked-upload pattern
 * (small base64 chunks via supabase.functions.invoke) is the only one
 * that works reliably. The lab-upload function now takes a target_bucket
 * parameter so we share the proven plumbing.
 */
async function uploadImageNativeChunked(
  fileUri: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  // Slice along base64 4-char boundaries so chunks decode evenly.
  const base64ChunkSize = Math.ceil(RAW_CHUNK_SIZE / 3) * 4;
  const totalChunks = Math.max(1, Math.ceil(base64.length / base64ChunkSize));
  const uploadId = generateId();

  console.log(`[visualAnalyzer] Chunked upload: ${totalChunks} chunk(s), base64 len=${base64.length}`);

  let storagePath: string | null = null;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * base64ChunkSize;
    const chunkBase64 = base64.slice(start, start + base64ChunkSize);

    const { data, error } = await supabase.functions.invoke('lab-upload', {
      body: {
        upload_id: uploadId,
        chunk_index: i,
        total_chunks: totalChunks,
        base64_data: chunkBase64,
        file_name: fileName,
        mime_type: mimeType,
        target_bucket: BUCKET,
      },
    });
    if (error) {
      throw new Error(`Chunk ${i + 1}/${totalChunks} upload failed: ${error.message}`);
    }
    const resp = data as { status: string; storage_path?: string; error?: string };
    if (resp.status === 'error') {
      throw new Error(`Chunk ${i + 1}/${totalChunks} server error: ${resp.error ?? 'unknown'}`);
    }
    if (resp.status === 'complete') {
      if (!resp.storage_path) throw new Error('Final chunk completed but no storage_path returned');
      storagePath = resp.storage_path;
    }
  }
  if (!storagePath) throw new Error('Upload finished without storage_path');
  return storagePath;
}

async function uploadImage(
  fileUri: string,
  userId: string,
  modality: Modality,
  angle: Angle,
  fileName: string,
  mimeType: string,
): Promise<string> {
  if (Platform.OS === 'web') {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${userId}/${Date.now()}_${modality}_${angle}_${safeName}`;
    await uploadImageWeb(fileUri, objectKey, mimeType);
    return objectKey;
  }
  // Native: the chunked edge function chooses the final storage path
  // (user_id/timestamp_filename). We prefix the filename with the
  // modality/angle metadata so the resulting path is self-describing.
  const tagged = `${modality}_${angle}_${fileName}`;
  return uploadImageNativeChunked(fileUri, tagged, mimeType);
}

// ────────────────────────────────────────────────────────────
// Session orchestration
// ────────────────────────────────────────────────────────────

async function readSession(sessionId: string): Promise<{
  status: VisualSessionStatus;
  visual_health_index: number | null;
} | null> {
  const { data, error } = await supabase
    .from('visual_sessions')
    .select('status, visual_health_index')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) {
    console.log('[visualAnalyzer] readSession error:', error.message);
    return null;
  }
  return (data as { status: VisualSessionStatus; visual_health_index: number | null } | null) ?? null;
}

async function pollUntilDone(sessionId: string, onStatus?: (s: VisualSessionStatus) => void): Promise<void> {
  const start = Date.now();
  let lastStatus: VisualSessionStatus | null = null;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const row = await readSession(sessionId);
    if (row && row.status !== lastStatus) {
      lastStatus = row.status;
      onStatus?.(row.status);
      console.log('[visualAnalyzer] session status →', row.status);
    }
    if (row && (row.status === 'review_pending' || row.status === 'signed_off' || row.status === 'failed')) return;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Visual session timed out after 6 minutes.');
}

export interface AnalyzeVisualSessionOptions {
  onProgress?: (info: { phase: 'upload' | 'analyzing' | 'correlating' | 'complete'; modality?: Modality; status?: VisualSessionStatus }) => void;
}

async function markSessionFailed(sessionId: string, reason: string): Promise<void> {
  try {
    await supabase
      .from('visual_sessions')
      .update({ status: 'failed', notes: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch (cleanupErr) {
    console.log('[visualAnalyzer] markSessionFailed itself errored (best-effort):', cleanupErr);
  }
}

export async function analyzeVisualSession(
  input: StartSessionInput,
  options: AnalyzeVisualSessionOptions = {},
): Promise<VisualSessionResult> {
  const { captures, isBaseline = false, sessionInputs = {} } = input;
  const { onProgress } = options;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated.');
  const userId = session.user.id;

  // 1. Create visual_sessions row
  const sessionId = generateId();
  const { error: sessionErr } = await supabase.from('visual_sessions').insert({
    id: sessionId,
    user_id: userId,
    captured_at: new Date().toISOString(),
    status: 'pending',
    is_baseline: isBaseline,
    session_inputs_json: sessionInputs,
  });
  if (sessionErr) throw new Error(`Failed to create session: ${sessionErr.message}`);

  // Once the session row exists, every subsequent failure path must
  // mark it 'failed' so the patient doesn't see a stuck 'Queued' entry
  // forever (audit bugs #11 + #12).
  try {
    // 2. For each capture: upload image + insert visual_session_images row
    const uploadedModalities: Modality[] = [];
    for (const cap of captures) {
      onProgress?.({ phase: 'upload', modality: cap.modality });
      const storageKey = await uploadImage(cap.fileUri, userId, cap.modality, cap.angle, cap.fileName, cap.mimeType);
      const { error: imgErr } = await supabase.from('visual_session_images').insert({
        session_id: sessionId,
        user_id: userId,
        modality: cap.modality,
        angle: cap.angle,
        storage_key: storageKey,
        mime_type: cap.mimeType,
        captured_at: new Date().toISOString(),
      });
      if (imgErr) throw new Error(`Failed to record image row for ${cap.modality}: ${imgErr.message}`);
      uploadedModalities.push(cap.modality);
    }

    // 3. Invoke visual-analysis for each modality in parallel. Track
    //    per-modality outcome — if ANY analyzer fails the correlator
    //    would run on partial findings (audit bug #5), so we mark the
    //    session 'failed' rather than producing a bogus VHI.
    onProgress?.({ phase: 'analyzing' });
    const analysisResults = await Promise.all(
      uploadedModalities.map(async (modality) => {
        const { error } = await supabase.functions.invoke('visual-analysis', {
          body: { session_id: sessionId, modality },
        });
        return { modality, error: error ? error.message : null };
      }),
    );
    const failed = analysisResults.filter(r => r.error !== null);
    if (failed.length > 0) {
      const summary = failed.map(f => `${f.modality}: ${f.error}`).join('; ');
      throw new Error(`Analyzer failed for: ${summary}`);
    }

    // 4. Invoke visual-correlator (it expects all per-modality findings to exist)
    onProgress?.({ phase: 'correlating' });
    const { error: corrErr } = await supabase.functions.invoke('visual-correlator', {
      body: { session_id: sessionId },
    });
    if (corrErr) {
      throw new Error(`Correlator failed: ${corrErr.message}`);
    }

    // 5. Poll session row until terminal status
    await pollUntilDone(sessionId, (status) => onProgress?.({ phase: 'analyzing', status }));

    // 6. Return final result
    const final = await readSession(sessionId);
    if (!final) throw new Error('Session disappeared during polling');
    if (final.status === 'failed') throw new Error('Visual analysis failed; check Supabase Edge Function logs.');

    const [convergentRes, divergentRes, redFlagRes] = await Promise.all([
      supabase.from('visual_convergent_findings').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
      supabase.from('visual_divergent_findings').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
      supabase.from('visual_red_flag_alerts').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    ]);

    onProgress?.({ phase: 'complete' });
    return {
      sessionId,
      status: final.status,
      visualHealthIndex: final.visual_health_index,
      modalitiesAnalyzed: uploadedModalities,
      convergentCount: convergentRes.count ?? 0,
      divergentCount: divergentRes.count ?? 0,
      redFlagCount: redFlagRes.count ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markSessionFailed(sessionId, msg);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────
// Read helpers for the dashboard
// ────────────────────────────────────────────────────────────

export interface SessionDetail {
  session: {
    id: string;
    captured_at: string;
    status: VisualSessionStatus;
    visual_health_index: number | null;
    is_baseline: boolean;
  };
  findings: Array<{
    modality: Modality;
    structured_findings: Record<string, unknown>;
    cross_modality_tags: string[];
    red_flags: Array<{ severity: string; observation: string; recommended_action: string }>;
    confidence: number | null;
    prompt_version: string;
  }>;
  convergent: Array<{
    tag: string;
    contributing_modalities: string[];
    combined_confidence: number;
    trend: string | null;
  }>;
  divergent: Array<{
    tag_a: string;
    tag_b: string;
    note: string | null;
  }>;
  redFlags: Array<{
    modality: string;
    severity: string;
    observation: string;
    recommended_action: string | null;
    acknowledged_at: string | null;
  }>;
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const [sessionRes, findingsRes, convergentRes, divergentRes, redFlagsRes] = await Promise.all([
    supabase.from('visual_sessions').select('id, captured_at, status, visual_health_index, is_baseline').eq('id', sessionId).maybeSingle(),
    supabase.from('visual_findings').select('modality, structured_findings, cross_modality_tags, red_flags, confidence, prompt_version').eq('session_id', sessionId),
    supabase.from('visual_convergent_findings').select('tag, contributing_modalities, combined_confidence, trend').eq('session_id', sessionId),
    supabase.from('visual_divergent_findings').select('tag_a, tag_b, note').eq('session_id', sessionId),
    supabase.from('visual_red_flag_alerts').select('modality, severity, observation, recommended_action, acknowledged_at').eq('session_id', sessionId),
  ]);
  if (!sessionRes.data) return null;
  return {
    session: sessionRes.data as SessionDetail['session'],
    findings: (findingsRes.data as SessionDetail['findings']) ?? [],
    convergent: (convergentRes.data as SessionDetail['convergent']) ?? [],
    divergent: (divergentRes.data as SessionDetail['divergent']) ?? [],
    redFlags: (redFlagsRes.data as SessionDetail['redFlags']) ?? [],
  };
}

export async function listRecentSessions(limit = 20): Promise<Array<{
  id: string;
  captured_at: string;
  status: VisualSessionStatus;
  visual_health_index: number | null;
  is_baseline: boolean;
}>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data, error } = await supabase
    .from('visual_sessions')
    .select('id, captured_at, status, visual_health_index, is_baseline')
    .eq('user_id', session.user.id)
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.log('[visualAnalyzer] listRecentSessions error:', error.message);
    return [];
  }
  return (data as Array<{ id: string; captured_at: string; status: VisualSessionStatus; visual_health_index: number | null; is_baseline: boolean }>) ?? [];
}
