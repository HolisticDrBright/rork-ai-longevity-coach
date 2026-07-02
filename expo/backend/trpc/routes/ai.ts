import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../create-context";

/**
 * Server-side proxy for all OpenAI usage.
 *
 * The mobile app previously called api.openai.com directly with an
 * EXPO_PUBLIC_* key compiled into the shipped bundle — extractable by anyone
 * who downloads the app, and it sent lab PDFs (PHI) to a third party straight
 * from the device. All AI traffic now flows through these authenticated
 * procedures using a server-only OPENAI_API_KEY.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_BASE = "https://api.openai.com/v1";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1";
const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

function requireKey(): string {
  if (!OPENAI_API_KEY) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI features are not configured on the server.",
    });
  }
  return OPENAI_API_KEY;
}

async function openAIError(res: Response, action: string): Promise<never> {
  // Log details server-side only; never leak upstream error bodies to clients.
  const body = await res.text().catch(() => "");
  console.error(`[ai] OpenAI ${action} failed: ${res.status} ${body.slice(0, 500)}`);
  throw new TRPCError({ code: "BAD_GATEWAY", message: `AI ${action} failed.` });
}

const EXTRACTOR_SYSTEM_PROMPT =
  "You are a meticulous medical data extractor. When reading lab documents you transcribe numbers VERBATIM from the document. Never round, never infer, never substitute. If a value is unclear, omit it rather than guess. Match each numeric value to the row label and unit it appears on in the document.";

export const aiRouter = createTRPCRouter({
  /** Upload a PDF (base64) to OpenAI Files and return the file id. */
  uploadPdf: protectedProcedure
    .input(
      z.object({
        base64: z.string().min(1).max(28_000_000), // ~20MB PDF
        fileName: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ input }) => {
      const key = requireKey();
      const bytes = Buffer.from(input.base64, "base64");
      const form = new FormData();
      form.append("purpose", "user_data");
      form.append(
        "file",
        new Blob([bytes], { type: "application/pdf" }),
        input.fileName.replace(/[^\w.\- ]/g, "_"),
      );

      const res = await fetch(`${OPENAI_BASE}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) await openAIError(res, "file upload");
      const json = (await res.json()) as { id: string };
      return { fileId: json.id };
    }),

  /** Delete a previously uploaded OpenAI file (best effort). */
  deleteFile: protectedProcedure
    .input(z.object({ fileId: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      const key = requireKey();
      const res = await fetch(`${OPENAI_BASE}/files/${encodeURIComponent(input.fileId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
      });
      return { success: res.ok };
    }),

  /** Run a prompt against an uploaded file (lab PDF extraction/analysis). */
  promptWithFile: protectedProcedure
    .input(
      z.object({
        fileId: z.string().min(1).max(128),
        prompt: z.string().min(1).max(60_000),
        expectJson: z.boolean().default(false),
        system: z.string().max(4_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const key = requireKey();
      const body: Record<string, unknown> = {
        model: CHAT_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: input.system ?? EXTRACTOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "file", file: { file_id: input.fileId } },
              { type: "text", text: input.prompt },
            ],
          },
        ],
      };
      if (input.expectJson) body.response_format = { type: "json_object" };

      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) await openAIError(res, "file analysis");
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return { text: json.choices?.[0]?.message?.content ?? "" };
    }),

  /** Run a prompt against one or more images (lab screenshot extraction). */
  promptWithImages: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(60_000),
        // data: URLs; capped to keep request bodies bounded
        images: z.array(z.string().min(1).max(10_000_000)).min(1).max(8),
        expectJson: z.boolean().default(false),
        system: z.string().max(4_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const key = requireKey();
      const body: Record<string, unknown> = {
        model: VISION_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: input.system ?? EXTRACTOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              ...input.images.map(url => ({ type: "image_url", image_url: { url } })),
              { type: "text", text: input.prompt },
            ],
          },
        ],
      };
      if (input.expectJson) body.response_format = { type: "json_object" };

      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) await openAIError(res, "image analysis");
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return { text: json.choices?.[0]?.message?.content ?? "" };
    }),

  /** Transcribe a short voice memo (meal logging). */
  transcribeAudio: protectedProcedure
    .input(
      z.object({
        base64: z.string().min(1).max(20_000_000), // ~14MB audio
        mimeType: z.string().min(1).max(64),
        fileName: z.string().max(128).default("recording.m4a"),
      }),
    )
    .mutation(async ({ input }) => {
      const key = requireKey();
      const bytes = Buffer.from(input.base64, "base64");
      const form = new FormData();
      form.append("model", TRANSCRIBE_MODEL);
      form.append(
        "file",
        new Blob([bytes], { type: input.mimeType }),
        input.fileName.replace(/[^\w.\- ]/g, "_"),
      );

      const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) await openAIError(res, "transcription");
      const json = (await res.json()) as { text?: string };
      return { text: json.text ?? "" };
    }),
});

/**
 * Server-side integration tokens.
 * The Vital/Junction API key must never ship in the client bundle; Vital Link
 * is designed around short-lived, server-generated link tokens.
 */
const VITAL_API_KEY = process.env.VITAL_API_KEY ?? "";
const VITAL_ENV = process.env.VITAL_ENV ?? "sandbox"; // sandbox | production

export const integrationsRouter = createTRPCRouter({
  createVitalLinkToken: protectedProcedure
    .input(z.object({ provider: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!VITAL_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Wearable integration is not configured on the server.",
        });
      }
      const base =
        VITAL_ENV === "production"
          ? "https://api.tryvital.io"
          : "https://api.sandbox.tryvital.io";

      const res = await fetch(`${base}/v2/link/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vital-api-key": VITAL_API_KEY,
        },
        body: JSON.stringify({
          user_id: ctx.user.id,
          ...(input.provider ? { provider: input.provider } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[integrations] Vital link token failed: ${res.status} ${body.slice(0, 300)}`);
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not start device connection." });
      }
      const json = (await res.json()) as { link_token?: string; link_web_url?: string };
      return { linkToken: json.link_token ?? null, linkWebUrl: json.link_web_url ?? null };
    }),
});
