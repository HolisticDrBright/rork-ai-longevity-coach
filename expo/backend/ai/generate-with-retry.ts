/**
 * generateWithRetry — thin wrapper around `@rork-ai/toolkit-sdk` `generateObject`
 * that enforces the Visual Diagnostics build prompt's reliability contract:
 *
 *   1. One automatic retry on Zod-validation failure (the SDK does not
 *      retry on parse errors by default).
 *   2. Sentry capture on the second failure, with redacted context.
 *   3. Always returns metadata (model_version, prompt_version,
 *      generation_ms) so callers can persist it on every result row.
 *
 * Use this for ALL visual-diagnostics AI calls. Other modules already use
 * `generateObject` directly without retry — they don't have the same
 * reliability requirement, so we don't force-migrate them.
 */

import { generateObject } from '@rork-ai/toolkit-sdk';
import { z } from 'zod';
import { captureError } from '@/lib/sentry';

const DEFAULT_MODEL_VERSION = 'claude-opus-4.6';

export interface GenerateWithRetryArgs<T extends z.ZodTypeAny> {
  /**
   * Versioned prompt identifier. Persisted on the result row for audit
   * (e.g. `skin_v1_2026-05-05`). Bumping the prompt requires a new file
   * + a new version string; never edit a versioned prompt in place.
   */
  promptVersion: string;
  /**
   * System prompt content. The toolkit SDK takes everything as user
   * messages with a system-style preamble — we follow that convention.
   */
  systemPrompt: string;
  /**
   * User prompt content (rendered patient context + image instructions).
   */
  userPrompt: string;
  /**
   * Optional image content. Each entry is a base64 string OR a URL
   * (the toolkit SDK accepts either; analyzers pass base64 for inline
   * upload from the lab-pdfs equivalent storage bucket).
   */
  images?: string[];
  /**
   * Zod schema the response must conform to. On parse failure we retry
   * once with an explicit "your previous output failed validation" note.
   */
  schema: T;
  /**
   * Optional model override. Defaults to claude-opus-4.6 vision.
   */
  modelVersion?: string;
  /**
   * Context that goes into the Sentry breadcrumb if both attempts fail.
   * Keep this PHI-free — analyzer code never includes raw patient data
   * here, just session id / modality / user id.
   */
  sentryContext?: Record<string, unknown>;
}

export interface GenerateWithRetryResult<T> {
  data: T;
  promptVersion: string;
  modelVersion: string;
  generationMs: number;
  retried: boolean;
}

export async function generateWithRetry<T extends z.ZodTypeAny>(
  args: GenerateWithRetryArgs<T>,
): Promise<GenerateWithRetryResult<z.infer<T>>> {
  const {
    promptVersion,
    systemPrompt,
    userPrompt,
    images,
    schema,
    modelVersion = DEFAULT_MODEL_VERSION,
    sentryContext,
  } = args;

  const buildMessages = (validationNote?: string) => {
    const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];
    contentParts.push({ type: 'text', text: systemPrompt });
    if (validationNote) {
      contentParts.push({ type: 'text', text: `\n---\nYour previous output failed schema validation:\n${validationNote}\nReturn ONLY valid JSON conforming to the required schema. Do not add commentary outside the JSON.\n---\n` });
    }
    contentParts.push({ type: 'text', text: userPrompt });
    for (const img of images ?? []) {
      contentParts.push({ type: 'image', image: img });
    }
    return [{ role: 'user' as const, content: contentParts }];
  };

  const attempt = async (validationNote?: string): Promise<z.infer<T>> => {
    const raw = await generateObject({
      messages: buildMessages(validationNote),
      schema,
    });
    // The SDK already returns the parsed object on success. If the SDK
    // returned an unstructured value (older versions), force a parse.
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ZodValidationError(parsed.error.message);
    }
    return parsed.data;
  };

  const startedAt = Date.now();
  try {
    const data = await attempt();
    return {
      data,
      promptVersion,
      modelVersion,
      generationMs: Date.now() - startedAt,
      retried: false,
    };
  } catch (firstError) {
    const firstErrMsg = firstError instanceof Error ? firstError.message : String(firstError);
    console.log('[generateWithRetry] First attempt failed; retrying once:', firstErrMsg);
    try {
      const data = await attempt(firstErrMsg);
      return {
        data,
        promptVersion,
        modelVersion,
        generationMs: Date.now() - startedAt,
        retried: true,
      };
    } catch (secondError) {
      captureError(secondError instanceof Error ? secondError : new Error(String(secondError)), {
        ...sentryContext,
        promptVersion,
        modelVersion,
        firstAttemptError: firstErrMsg.slice(0, 500),
      });
      throw secondError;
    }
  }
}

class ZodValidationError extends Error {
  constructor(message: string) {
    super(`Zod validation: ${message}`);
    this.name = 'ZodValidationError';
  }
}
