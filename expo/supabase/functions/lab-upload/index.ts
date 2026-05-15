/**
 * Supabase Edge Function: lab-upload
 *
 * Chunked upload proxy for the lab analyzer pipeline. Client splits a lab
 * PDF/image into ~200KB raw / ~270KB base64 chunks (well under iOS's
 * ~1MB EMSGSIZE socket-level limit) and POSTs each chunk to this function.
 * The function stores chunks in public.lab_upload_chunks, then on the
 * last chunk reassembles them, writes the file to the lab-pdfs Storage
 * bucket, and returns the storage path. The caller can then create a
 * lab_analysis_jobs row and invoke the lab-analyzer function exactly as
 * before.
 *
 * Why this exists: every single-request upload approach (supabase-js
 * storage.upload, FileSystem.uploadAsync BINARY_CONTENT, MULTIPART, signed
 * URL PUT) failed on iOS for files >~1MB with NSPOSIXErrorDomain Code=40
 * "Message too long". Sending small chunks dodges the issue entirely
 * because each individual HTTP request stays well under the threshold.
 *
 * Request body:
 *   {
 *     upload_id: string (UUID, client-generated, stable across all chunks),
 *     chunk_index: number (0-based),
 *     total_chunks: number,
 *     base64_data: string (~270KB max),
 *     file_name: string,
 *     mime_type: 'application/pdf' | 'image/jpeg' | 'image/png',
 *     file_type: 'pdf' | 'jpg' | 'png'
 *   }
 *
 * Response (non-final chunk):
 *   { status: 'chunk_received', chunk_index: N, received_so_far: M }
 *
 * Response (final chunk):
 *   { status: 'complete', storage_path: '<user_id>/<ts>_<file>', bytes: N }
 *
 * Deploy: supabase functions deploy lab-upload
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const STORAGE_BUCKET = 'lab-pdfs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ChunkBody {
  upload_id?: string;
  chunk_index?: number;
  total_chunks?: number;
  base64_data?: string;
  file_name?: string;
  mime_type?: string;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function base64ToBytes(b64: string): Uint8Array {
  // Deno globals atob is available; build Uint8Array from binary string.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Resolve caller's user_id from the JWT. We need this to scope chunks +
  // ensure the assembled file lands under the caller's storage prefix.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Invalid auth token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: ChunkBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    upload_id: uploadId,
    chunk_index: chunkIndex,
    total_chunks: totalChunks,
    base64_data: base64Data,
    file_name: fileName,
    mime_type: mimeType,
  } = body;

  if (
    !uploadId ||
    typeof chunkIndex !== 'number' ||
    typeof totalChunks !== 'number' ||
    !base64Data ||
    !fileName ||
    !mimeType
  ) {
    return new Response(JSON.stringify({
      error: 'Missing required fields',
      required: ['upload_id', 'chunk_index', 'total_chunks', 'base64_data', 'file_name', 'mime_type'],
    }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (chunkIndex < 0 || chunkIndex >= totalChunks) {
    return new Response(JSON.stringify({ error: 'chunk_index out of range' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Upsert this chunk. Idempotent so a client retry of an already-uploaded
    // chunk does not error.
    const { error: insertErr } = await sb
      .from('lab_upload_chunks')
      .upsert({
        upload_id: uploadId,
        user_id: userId,
        chunk_index: chunkIndex,
        total_chunks: totalChunks,
        file_name: fileName,
        mime_type: mimeType,
        base64_data: base64Data,
      }, { onConflict: 'upload_id,chunk_index' });

    if (insertErr) {
      console.error('[lab-upload] chunk insert failed', insertErr);
      throw new Error(`Chunk insert failed: ${insertErr.message}`);
    }

    // For non-final chunks: confirm receipt and report progress.
    if (chunkIndex !== totalChunks - 1) {
      const { count } = await sb
        .from('lab_upload_chunks')
        .select('chunk_index', { count: 'exact', head: true })
        .eq('upload_id', uploadId)
        .eq('user_id', userId);
      return new Response(JSON.stringify({
        status: 'chunk_received',
        chunk_index: chunkIndex,
        received_so_far: count ?? null,
        total_chunks: totalChunks,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Final chunk path: pull all chunks for this upload, ensure none missing,
    // assemble base64 strings in order, decode to a single Uint8Array,
    // upload to Storage, then delete chunk rows.
    console.log(`[lab-upload] Final chunk received for ${uploadId}; assembling`);

    const { data: chunkRows, error: fetchErr } = await sb
      .from('lab_upload_chunks')
      .select('chunk_index, base64_data')
      .eq('upload_id', uploadId)
      .eq('user_id', userId)
      .order('chunk_index', { ascending: true });

    if (fetchErr || !chunkRows) {
      throw new Error(`Failed to fetch chunks for assembly: ${fetchErr?.message ?? 'no data'}`);
    }
    if (chunkRows.length !== totalChunks) {
      throw new Error(`Expected ${totalChunks} chunks for upload ${uploadId}, found ${chunkRows.length}`);
    }
    for (let i = 0; i < totalChunks; i++) {
      if ((chunkRows[i] as { chunk_index: number }).chunk_index !== i) {
        throw new Error(`Missing chunk at index ${i} for upload ${uploadId}`);
      }
    }

    const fullBase64 = (chunkRows as Array<{ base64_data: string }>)
      .map(r => r.base64_data)
      .join('');
    const fileBytes = base64ToBytes(fullBase64);
    console.log(`[lab-upload] Assembled ${fileBytes.byteLength} bytes from ${totalChunks} chunks`);

    const storagePath = `${userId}/${Date.now()}_${safeFileName(fileName)}`;
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadErr) {
      console.error('[lab-upload] storage.upload failed', uploadErr);
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    // Cleanup chunks. Errors here are logged but non-fatal - the upload
    // succeeded; orphan chunks are cleared by the staleness sweep at most
    // a few hours later.
    const { error: deleteErr } = await sb
      .from('lab_upload_chunks')
      .delete()
      .eq('upload_id', uploadId)
      .eq('user_id', userId);
    if (deleteErr) {
      console.error('[lab-upload] chunk cleanup failed (non-blocking)', deleteErr);
    }

    return new Response(JSON.stringify({
      status: 'complete',
      storage_path: storagePath,
      bytes: fileBytes.byteLength,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lab-upload] error', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ status: 'error', error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
