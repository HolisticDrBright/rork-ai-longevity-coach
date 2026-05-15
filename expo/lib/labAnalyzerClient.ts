import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

export type LabAnalysisJobStatus = 'pending' | 'extracting' | 'enriching' | 'complete' | 'failed';

export interface LabAnalysisBiomarker {
  name: string;
  value: number;
  unit: string;
  referenceMin: number | null;
  referenceMax: number | null;
  functionalMin: number | null;
  functionalMax: number | null;
  status: 'optimal' | 'normal' | 'suboptimal' | 'critical';
}

export interface LabAnalysisSupplement {
  name: string;
  dose: string;
  timing: string;
  reason: string;
  mechanism: string;
}

export interface LabAnalysisJob {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  file_type: 'pdf' | 'jpg' | 'png';
  status: LabAnalysisJobStatus;
  error: string | null;
  biomarkers_json: LabAnalysisBiomarker[] | null;
  supplements_json: LabAnalysisSupplement[] | null;
  herbs_json: LabAnalysisSupplement[] | null;
  priority_actions_json: string[] | null;
  analysis_text: string | null;
  textract_raw_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface LabAnalysisResultPayload {
  job: LabAnalysisJob;
  biomarkers: LabAnalysisBiomarker[];
  supplements: LabAnalysisSupplement[];
  herbs: LabAnalysisSupplement[];
  priorityActions: string[];
  analysisText: string;
  supplementsToSkip: { name: string; reason: string }[];
}

const BUCKET = 'lab-pdfs';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000; // Up to 12 minutes for very large PDFs
const REINVOKE_INTERVAL_MS = 30 * 1000; // Re-invoke the function every 30s to advance Textract polling

function fileTypeFromMime(mimeType: string): 'pdf' | 'jpg' | 'png' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  throw new Error(`Unsupported file type: ${mimeType}`);
}

// Web path: read the file as bytes for direct upload via supabase-js. Works
// fine in browsers because their fetch implementation handles arbitrarily
// large Blob bodies via streams. We keep this path because it's the simplest
// thing that works on web.
async function readFileBytesWeb(fileUri: string): Promise<Uint8Array> {
  const res = await fetch(fileUri);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

async function uploadToStorage(
  userId: string,
  fileUri: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `${userId}/${Date.now()}_${safeName}`;

  if (Platform.OS === 'web') {
    const bytes = await readFileBytesWeb(fileUri);
    console.log('[labAnalyzer] Uploading to Storage (web):', BUCKET, objectKey, 'bytes:', bytes.byteLength);
    const { error } = await supabase.storage.from(BUCKET).upload(objectKey, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return objectKey;
  }

  // Native path: chunked upload via the lab-upload edge function.
  //
  // We previously tried every variant of single-request upload (supabase-js
  // storage.upload, FileSystem.uploadAsync BINARY_CONTENT/MULTIPART,
  // foreground/background sessions, signed URL PUT) and every one of them
  // hit iOS NSPOSIXErrorDomain Code=40 "Message too long" at the socket
  // layer for files >~1MB. Sending small chunks via supabase.functions.invoke
  // works because each individual HTTP request stays well under the
  // EMSGSIZE threshold - we never touch a body iOS will reject.
  //
  // The lab-upload edge function reassembles chunks server-side and writes
  // to lab-pdfs Storage. Returns the storage path on the last chunk's
  // response.
  console.log('[labAnalyzer] Uploading via chunked proxy (native):', BUCKET, objectKey);

  const fileType = fileTypeFromMime(mimeType);
  // 500KB raw -> ~680KB base64. Still well under iOS's ~1MB EMSGSIZE
  // threshold but half the request count vs 200KB chunks.
  const RAW_CHUNK_SIZE = 500 * 1024;
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });

  // Split base64 along boundaries that decode evenly. Each base64 group of
  // 4 chars decodes to 3 raw bytes, so we slice at multiples of 4.
  const base64ChunkSize = Math.ceil(RAW_CHUNK_SIZE / 3) * 4;
  const totalChunks = Math.max(1, Math.ceil(base64.length / base64ChunkSize));
  const uploadId = generateUploadId();

  console.log('[labAnalyzer] File base64 length:', base64.length, 'chunks:', totalChunks);

  let finalStoragePath: string | null = null;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * base64ChunkSize;
    const chunkBase64 = base64.slice(start, start + base64ChunkSize);

    const resp = await postChunkWithRetry({
      upload_id: uploadId,
      chunk_index: i,
      total_chunks: totalChunks,
      base64_data: chunkBase64,
      file_name: fileName,
      mime_type: mimeType,
      file_type: fileType,
    });

    if (resp.status === 'error') {
      throw new Error(`Chunk ${i + 1}/${totalChunks} server error: ${resp.error}`);
    }
    if (resp.status === 'complete') {
      if (!resp.storage_path) throw new Error('Final chunk returned no storage_path');
      finalStoragePath = resp.storage_path;
      console.log('[labAnalyzer] Chunked upload complete, storagePath:', finalStoragePath);
    } else {
      console.log('[labAnalyzer] Chunk', i + 1, '/', totalChunks, 'acknowledged');
    }
  }

  if (!finalStoragePath) {
    throw new Error('Chunked upload finished but no storage_path was returned');
  }
  return finalStoragePath;
}

// Post a chunk with exponential-backoff retry on transient failures.
// supabase-js's "Failed to send a request to the Edge Function" error is a
// generic network/connection failure that resolves on its own most of the
// time - common causes are momentary network blips, edge function cold
// starts, or short-lived rate-limit pushback.
async function postChunkWithRetry(
  body: {
    upload_id: string;
    chunk_index: number;
    total_chunks: number;
    base64_data: string;
    file_name: string;
    mime_type: string;
    file_type: 'pdf' | 'jpg' | 'png';
  },
  maxAttempts: number = 5,
): Promise<{ status?: string; storage_path?: string; error?: string }> {
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('lab-upload', { body });
      if (!error) {
        return (data ?? {}) as { status?: string; storage_path?: string; error?: string };
      }
      lastError = error.message ?? 'unknown error';
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxAttempts - 1) {
      const delay = Math.min(500 * Math.pow(2, attempt), 5000);
      console.log(`[labAnalyzer] Chunk ${body.chunk_index + 1}/${body.total_chunks} attempt ${attempt + 1} failed (${lastError}), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`Chunk ${body.chunk_index + 1}/${body.total_chunks} failed after ${maxAttempts} attempts: ${lastError}`);
}

// Lightweight UUID v4 generator. crypto.randomUUID is available on modern RN /
// Hermes but we fall back to a manual builder for older runtimes.
function generateUploadId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function createJob(
  userId: string,
  storagePath: string,
  fileName: string,
  fileType: 'pdf' | 'jpg' | 'png',
): Promise<string> {
  console.log('[labAnalyzer] Inserting lab_analysis_jobs row');
  const { data, error } = await supabase
    .from('lab_analysis_jobs')
    .insert({
      user_id: userId,
      storage_path: storagePath,
      file_name: fileName,
      file_type: fileType,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to create job: ${error?.message ?? 'no data'}`);
  return (data as { id: string }).id;
}

async function invokeFunction(jobId: string): Promise<void> {
  console.log('[labAnalyzer] Invoking lab-analyzer edge function for job', jobId);
  const { error } = await supabase.functions.invoke('lab-analyzer', {
    body: { job_id: jobId },
  });
  if (error) {
    // The function processes in resumable phases - one invocation may
    // legitimately return "still running" without finishing. Errors here
    // are not fatal; the poll loop observes the DB row's final state.
    console.log('[labAnalyzer] Edge function invoke returned non-2xx (may be expected mid-pipeline):', error.message);
  }
}

async function readJob(jobId: string): Promise<LabAnalysisJob | null> {
  const { data, error } = await supabase
    .from('lab_analysis_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    console.log('[labAnalyzer] readJob error:', error.message);
    return null;
  }
  return (data as LabAnalysisJob | null) ?? null;
}

async function pollUntilDone(jobId: string, onProgress?: (status: LabAnalysisJobStatus) => void): Promise<LabAnalysisJob> {
  const start = Date.now();
  let lastStatus: LabAnalysisJobStatus | null = null;
  let lastInvokeAt = Date.now();
  let lastRowUpdatedAt: string | null = null;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const job = await readJob(jobId);
    if (job && job.status !== lastStatus) {
      lastStatus = job.status;
      onProgress?.(job.status);
      console.log('[labAnalyzer] Job status →', job.status);
    }
    if (job && (job.status === 'complete' || job.status === 'failed')) return job;

    // Re-invoke the function periodically to push the pipeline forward.
    // The function processes in resumable phases - Textract polling can run
    // for several minutes for multi-page PDFs, and each invocation only
    // advances by ~60s before returning. Re-invocation is also our recovery
    // if the function silently died (no row update for > 30s).
    const rowStale = job && lastRowUpdatedAt === job.updated_at;
    const reinvokeDue = Date.now() - lastInvokeAt > REINVOKE_INTERVAL_MS;
    if (job && job.status !== 'complete' && job.status !== 'failed' && reinvokeDue && rowStale) {
      console.log('[labAnalyzer] Re-invoking function to advance pipeline');
      void invokeFunction(jobId);
      lastInvokeAt = Date.now();
    }
    if (job) lastRowUpdatedAt = job.updated_at;

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Lab analysis timed out after 12 minutes.');
}

export interface AnalyzeLabFileParams {
  fileUri: string;
  fileName: string;
  mimeType: string;
  onProgress?: (status: LabAnalysisJobStatus) => void;
}

export async function analyzeLabFile(params: AnalyzeLabFileParams): Promise<LabAnalysisResultPayload> {
  const { fileUri, fileName, mimeType, onProgress } = params;
  const fileType = fileTypeFromMime(mimeType);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated.');
  const userId = session.user.id;

  const storagePath = await uploadToStorage(userId, fileUri, fileName, mimeType);
  const jobId = await createJob(userId, storagePath, fileName, fileType);
  void invokeFunction(jobId);

  const job = await pollUntilDone(jobId, onProgress);

  if (job.status === 'failed') {
    throw new Error(job.error ?? 'Lab analysis failed.');
  }

  const supplementsToSkip =
    ((job.textract_raw_json as { safety_gates?: { supplements_to_skip?: { name: string; reason: string }[] } } | null)
      ?.safety_gates?.supplements_to_skip) ?? [];

  return {
    job,
    biomarkers: job.biomarkers_json ?? [],
    supplements: job.supplements_json ?? [],
    herbs: job.herbs_json ?? [],
    priorityActions: job.priority_actions_json ?? [],
    analysisText: job.analysis_text ?? '',
    supplementsToSkip,
  };
}

export async function getLatestCompletedJob(): Promise<LabAnalysisJob | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('lab_analysis_jobs')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('status', 'complete')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as LabAnalysisJob | null) ?? null;
}
