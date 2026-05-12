/**
 * Client-side helper for the lab-analyzer edge function.
 *
 * Flow:
 *   1. Upload the file to Supabase Storage at `lab-pdfs/{userId}/{uuid}.{ext}`
 *   2. Insert a row into `lab_analysis_jobs`
 *   3. Invoke the `lab-analyzer` edge function with { jobId }
 *   4. Poll the job row until status = 'complete' or 'failed'
 *   5. Return the structured result
 *
 * No OpenAI key is needed on the client — everything happens server-side.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

export interface LabAnalyzerBiomarker {
  name: string;
  value: number;
  unit: string;
  referenceMin: number | null;
  referenceMax: number | null;
  functionalMin: number | null;
  functionalMax: number | null;
  status: 'optimal' | 'normal' | 'suboptimal' | 'critical';
}

export interface LabAnalyzerSupplement {
  name: string;
  dose: string;
  timing: string;
  reason: string;
  mechanism: string;
}

export interface LabAnalyzerResult {
  biomarkers: LabAnalyzerBiomarker[];
  supplements: LabAnalyzerSupplement[];
  herbs: LabAnalyzerSupplement[];
  priorityActions: string[];
  analysisText: string;
}

const STORAGE_BUCKET = 'lab-pdfs';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function extToFileType(mimeType: string): 'pdf' | 'jpg' | 'png' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}

async function readFileAsUint8Array(fileUri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const res = await fetch(fileUri);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function analyzeLabViaEdgeFunction(params: {
  fileUri: string;
  mimeType: string;
  fileName: string;
  clinicDocumentId?: string | null;
  onProgress?: (status: string) => void;
}): Promise<LabAnalyzerResult> {
  const { fileUri, mimeType, fileName, clinicDocumentId = null, onProgress } = params;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('You must be signed in to analyze labs.');

  onProgress?.('uploading');
  const ext = extensionFor(mimeType);
  const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;
  const bytes = await readFileAsUint8Array(fileUri);

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  onProgress?.('creating_job');
  const { data: jobInsert, error: jobErr } = await supabase
    .from('lab_analysis_jobs')
    .insert({
      user_id: userId,
      clinic_document_id: clinicDocumentId,
      storage_path: objectPath,
      file_name: fileName,
      file_type: extToFileType(mimeType),
      status: 'pending',
    })
    .select('id')
    .single();
  if (jobErr || !jobInsert) throw new Error(`Could not create analysis job: ${jobErr?.message ?? 'unknown'}`);

  const jobId = jobInsert.id as string;

  onProgress?.('analyzing');
  const { error: invokeErr } = await supabase.functions.invoke('lab-analyzer', {
    body: { jobId },
  });
  if (invokeErr) {
    // Non-fatal — the function may still be running; poll and see.
    console.log('[labAnalyzer] invoke returned error, will still poll:', invokeErr.message);
  }

  const finalJob = await pollUntilDone(jobId, onProgress);
  if (finalJob.status === 'failed') {
    throw new Error(finalJob.error || 'Lab analysis failed.');
  }

  return {
    biomarkers: (finalJob.biomarkers_json ?? []) as LabAnalyzerBiomarker[],
    supplements: (finalJob.supplements_json ?? []) as LabAnalyzerSupplement[],
    herbs: (finalJob.herbs_json ?? []) as LabAnalyzerSupplement[],
    priorityActions: (finalJob.priority_actions_json ?? []) as string[],
    analysisText: (finalJob.analysis_text ?? '') as string,
  };
}

async function pollUntilDone(
  jobId: string,
  onProgress?: (status: string) => void
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const { data, error } = await supabase
      .from('lab_analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (error) throw new Error(`Polling failed: ${error.message}`);
    if (data?.status) onProgress?.(data.status as string);
    if (data?.status === 'complete' || data?.status === 'failed') {
      return data as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Lab analysis timed out after 5 minutes. Please try again.');
}
