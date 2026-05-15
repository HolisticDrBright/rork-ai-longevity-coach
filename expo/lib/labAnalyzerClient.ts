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

  // Native path: use FileSystem.uploadAsync which streams the file directly
  // from disk to Supabase Storage via a native HTTP request. The previous
  // approach (read file -> Uint8Array -> supabase.storage.upload) fails on
  // React Native with "Network request failed" for files larger than ~1MB,
  // because supabase-js wraps the Uint8Array in a Blob and RN's fetch can't
  // reliably send large Blob bodies on iOS/Android.
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is not configured');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated (no Supabase session)');

  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectKey}`;
  console.log('[labAnalyzer] Uploading to Storage (native, streaming):', BUCKET, objectKey);

  const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
  });

  if (result.status < 200 || result.status >= 300) {
    console.log('[labAnalyzer] Storage upload failed:', result.status, result.body);
    throw new Error(`Storage upload failed (${result.status}): ${result.body?.slice(0, 200) ?? 'no body'}`);
  }

  return objectKey;
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
