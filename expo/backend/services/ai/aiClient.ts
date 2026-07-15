// Server-side AI gateway. The ONLY place backend code may call an LLM.
//
// - Configured exclusively via server env (never EXPO_PUBLIC_*):
//     AI_PROVIDER_API_KEY  — required to enable AI features
//     AI_PROVIDER_BASE_URL — OpenAI-compatible base, default https://api.openai.com/v1
//     AI_MODEL             — default gpt-4.1
//     AI_TIMEOUT_MS        — per-request timeout, default 90000
// - Structured output only: JSON mode + zod validation with one corrective retry.
// - Every attempt is logged to ai_operations before the result is used.
// - Callers must pass PHI-minimized prompts (see ADR 0002); the lab-extraction
//   operation is the sanctioned exception and sends the lab file itself.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

export interface ServerAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function getServerAiConfig(): ServerAiConfig | null {
  const apiKey = process.env.AI_PROVIDER_API_KEY ?? '';
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.AI_PROVIDER_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL ?? 'gpt-4.1',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90000),
  };
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_id: string } };

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ChatContentPart[];
}

interface OperationLog {
  sb: SupabaseClient;
  userId: string | null;
  initiatedBy: string;
  operation: string;
  promptTemplate: string;
  promptVersion: string;
  inputRecordIds?: unknown;
  clinical?: boolean;
}

async function logOperation(
  log: OperationLog,
  entry: {
    model: string;
    output?: unknown;
    outputText?: string;
    validationStatus: 'passed' | 'failed' | 'not_applicable';
    error?: string;
    retryCount: number;
    latencyMs: number;
  }
): Promise<string | null> {
  try {
    const { data, error } = await log.sb
      .from('ai_operations')
      .insert({
        user_id: log.userId,
        operation: log.operation,
        model: entry.model,
        model_version: null,
        prompt_template: log.promptTemplate,
        prompt_version: log.promptVersion,
        input_record_ids: log.inputRecordIds ?? [],
        output: entry.output ?? null,
        output_text: entry.outputText ? entry.outputText.slice(0, 20000) : null,
        validation_status: entry.validationStatus,
        error: entry.error ?? null,
        retry_count: entry.retryCount,
        latency_ms: entry.latencyMs,
        initiated_by: log.initiatedBy,
        review_status: log.clinical ? 'pending_review' : 'not_required',
      })
      .select('id')
      .single();
    if (error || !data) {
      console.log(`[AI] Failed to log operation ${log.operation}: ${error?.code ?? 'unknown'}`);
      return null;
    }
    return String(data.id);
  } catch {
    console.log(`[AI] Failed to log operation ${log.operation}`);
    return null;
  }
}

async function chatCompletion(
  config: ServerAiConfig,
  messages: ChatMessage[],
  jsonMode: boolean
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI provider returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned an empty completion');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export type StructuredResult<T> =
  | { ok: true; data: T; operationId: string | null; retries: number }
  | { ok: false; error: string; operationId: string | null };

/**
 * JSON-mode completion validated against a zod schema, with one corrective
 * retry that feeds the validation errors back to the model. Logs every
 * attempt outcome to ai_operations.
 */
export async function generateStructured<T>(opts: {
  config: ServerAiConfig;
  log: OperationLog;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
}): Promise<StructuredResult<T>> {
  const startedAt = Date.now();
  let lastError = '';
  let rawText = '';

  for (let attempt = 0; attempt <= 1; attempt++) {
    const messages: ChatMessage[] =
      attempt === 0
        ? opts.messages
        : [
            ...opts.messages,
            {
              role: 'user',
              content: `Your previous response was invalid JSON for the required schema. Validation errors: ${lastError.slice(0, 1500)}. Respond again with ONLY corrected JSON.`,
            },
          ];
    try {
      rawText = await chatCompletion(opts.config, messages, true);
      const parsed: unknown = JSON.parse(rawText);
      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        const operationId = await logOperation(opts.log, {
          model: opts.config.model,
          output: result.data,
          validationStatus: 'passed',
          retryCount: attempt,
          latencyMs: Date.now() - startedAt,
        });
        return { ok: true, data: result.data, operationId, retries: attempt };
      }
      lastError = JSON.stringify(result.error.issues.slice(0, 8));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  const operationId = await logOperation(opts.log, {
    model: opts.config.model,
    outputText: rawText,
    validationStatus: 'failed',
    error: lastError.slice(0, 2000),
    retryCount: 1,
    latencyMs: Date.now() - startedAt,
  });
  return { ok: false, error: lastError, operationId };
}

/** Free-text completion (for narrative analyses), logged like everything else. */
export async function generateNarrative(opts: {
  config: ServerAiConfig;
  log: OperationLog;
  messages: ChatMessage[];
}): Promise<{ ok: true; text: string; operationId: string | null } | { ok: false; error: string; operationId: string | null }> {
  const startedAt = Date.now();
  try {
    const text = await chatCompletion(opts.config, opts.messages, false);
    const operationId = await logOperation(opts.log, {
      model: opts.config.model,
      outputText: text,
      validationStatus: 'not_applicable',
      retryCount: 0,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: true, text, operationId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const operationId = await logOperation(opts.log, {
      model: opts.config.model,
      validationStatus: 'not_applicable',
      error: message.slice(0, 2000),
      retryCount: 0,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, error: message, operationId };
  }
}

/** Uploads a file to the provider's Files API (used for PDF lab reports). */
export async function uploadProviderFile(
  config: ServerAiConfig,
  fileName: string,
  mimeType: string,
  base64Content: string
): Promise<string> {
  const bytes = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([bytes], { type: mimeType }), fileName);

  const res = await fetch(`${config.baseUrl}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`File upload failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('File upload returned no id');
  return json.id;
}

export async function deleteProviderFile(config: ServerAiConfig, fileId: string): Promise<void> {
  try {
    await fetch(`${config.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  } catch {
    console.log('[AI] Provider file cleanup failed');
  }
}
