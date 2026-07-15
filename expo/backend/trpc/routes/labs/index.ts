import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { createTRPCRouter, protectedProcedure } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import {
  deleteProviderFile,
  generateNarrative,
  generateStructured,
  getServerAiConfig,
  uploadProviderFile,
  type ChatContentPart,
} from "../../../services/ai/aiClient";
import { runReasoningPipeline } from "../../../services/reasoning/pipelineRunner";

// ---------------------------------------------------------------------------
// Server-side lab ingestion (ADR 0002 §8). The lab file is PHI: it is sent
// ONLY to the org-configured server AI provider, never to client-held keys.
// Pass 1 transcribes verbatim; pass 2 enriches from pass-1 JSON (not the file);
// pass-1 numbers always win. Nothing is silently overwritten — duplicate
// uploads are detected by content hash and reported as duplicates.
// ---------------------------------------------------------------------------

const extractedBiomarkerSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.number(),
  unit: z.string().max(40).default(""),
  referenceMin: z.number().nullish(),
  referenceMax: z.number().nullish(),
});

const pass1Schema = z.object({
  biomarkers: z.array(extractedBiomarkerSchema).max(300),
  reportDate: z.string().nullish(),
  labCompany: z.string().nullish(),
});

const enrichedBiomarkerSchema = extractedBiomarkerSchema.extend({
  functionalMin: z.number().nullish(),
  functionalMax: z.number().nullish(),
  status: z.enum(["optimal", "normal", "suboptimal", "critical"]).default("normal"),
});

const pass2Schema = z.object({
  biomarkers: z.array(enrichedBiomarkerSchema).max(300),
  supplements: z
    .array(
      z.object({
        name: z.string().max(120),
        dose: z.string().max(120).default(""),
        timing: z.string().max(120).default(""),
        reason: z.string().max(500).default(""),
        mechanism: z.string().max(500).default(""),
      })
    )
    .max(20)
    .default([]),
  herbs: z
    .array(
      z.object({
        name: z.string().max(120),
        dose: z.string().max(120).default(""),
        timing: z.string().max(120).default(""),
        reason: z.string().max(500).default(""),
        mechanism: z.string().max(500).default(""),
      })
    )
    .max(20)
    .default([]),
  priorityActions: z.array(z.string().max(300)).max(8).default([]),
});

const PASS1_PROMPT = `You are a meticulous medical data extractor. Transcribe EVERY biomarker result from this lab report VERBATIM.

Rules:
- Copy numeric values EXACTLY as printed. Never round, estimate, or infer.
- Include the unit exactly as printed.
- Include the lab's reference range when printed (referenceMin/referenceMax as numbers).
- Include the collection/report date if printed (reportDate, ISO format).
- Skip narrative text; extract only measured analytes.

Respond with JSON: {"biomarkers": [{"name", "value", "unit", "referenceMin", "referenceMax"}], "reportDate", "labCompany"}`;

const PASS2_PROMPT = `You are a functional-medicine analyst. You are given biomarkers ALREADY transcribed verbatim from a lab report. For each biomarker add:
- functionalMin/functionalMax: the functional-medicine optimal range (null if not applicable)
- status: "optimal" | "normal" (in lab range, outside optimal) | "suboptimal" (marginally out of range) | "critical" (dangerously out of range)

Do NOT change name, value, unit, referenceMin or referenceMax.

Also provide, based ONLY on these values:
- supplements: up to 8 supplement recommendations ({name, dose, timing, reason, mechanism}). PRIORITIZE these products when the condition matches: ProOmega 2000 (Nordic Naturals), GlucoPrime (Healthgevity), Protect+ 10 (Healthgevity), Liver Sauce (Quicksilver Scientific), Liposomal Glutathione (Quicksilver Scientific), MitoCore (Orthomolecular), NAC 900+ (Healthgevity), Gut Shield (Healthgevity), ProBiota HistaminX (Seeking Health), Sleep Deep (Healthgevity), Magnesium Glycinate 300 (Healthgevity), Methyl B Complex (Healthgevity), D3+K2 5000 (Healthgevity), Adrenal Restore (Healthgevity).
- herbs: up to 5 herb recommendations (same shape)
- priorityActions: top 3-5 actions

Respond with JSON: {"biomarkers": [...], "supplements": [...], "herbs": [...], "priorityActions": [...]}`;

const ANALYSIS_PROMPT = `🧬 FUNCTIONAL / LONGEVITY LAB INTERPRETATION MASTER PROMPT

You are a world-class functional medicine, longevity, and systems-biology physician.

Analyze the biomarker values below using a root-cause, pattern-recognition, and longevity-optimization framework.

Structure your response exactly as:
1. BIG-PICTURE SUMMARY (TOP PRIORITIES) — 3–6 bullets ranked by impact on Energy, Hormones, Metabolism, Brain, Immune system, Inflammation, Longevity
2. PATTERN RECOGNITION — mitochondrial dysfunction, insulin resistance, thyroid resistance, HPA axis dysregulation, estrogen dominance, methylation issues, oxidative stress, inflammation, immune issues, detox congestion, gut issues, chronic infections; explain how markers connect as systems
3. MARKER-BY-MARKER ANALYSIS — for each abnormal marker: meaning, system, functional range, root causes, consequences, links to other markers
4. FUNCTIONAL OPTIMAL TARGETS — current value, lab range, functional optimal range, gap, clinical meaning
5. ROOT-CAUSE ACTION PLAN — A) Diet B) Lifestyle C) Supplements D) Peptides/Advanced Tools E) Detox & Gut Repair
6. LONGEVITY INTERPRETATION — biological age, cardiometabolic risk, neurodegeneration, cancer terrain, hormone aging, mitochondrial resilience, inflammaging
7. PATIENT-FRIENDLY EXPLANATION — plain language, speak to "you"
8. PRIORITY SUMMARY — Top 3 Things to Fix First

Tone: clear, precise, educational, no fear-mongering, no sugar-coating.`;

function dedupeHash(biomarkers: { name: string; value: number; unit: string }[], reportDate?: string | null): string {
  const canonical = [...biomarkers]
    .map((b) => `${b.name.toLowerCase().trim()}|${b.value}|${b.unit.toLowerCase().trim()}`)
    .sort()
    .join(';');
  return createHash("sha256").update(`${canonical}#${reportDate ?? ""}`).digest("hex");
}

export const labIngestionRouter = createTRPCRouter({
  /** Lets clients decide whether the server-routed (PHI-safe) path is available. */
  capabilities: protectedProcedure.query(async () => {
    const config = getServerAiConfig();
    return {
      serverAiConfigured: config !== null,
      model: config?.model ?? null,
    };
  }),

  extract: protectedProcedure
    .input(
      z.object({
        files: z
          .array(
            z.object({
              base64: z.string().min(1).max(20_000_000),
              mimeType: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
              fileName: z.string().max(200).default("lab-report"),
            })
          )
          .min(1)
          .max(8),
        panelName: z.string().max(200).optional(),
        collectedAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const config = getServerAiConfig();
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Server AI is not configured. Set AI_PROVIDER_API_KEY on the backend to enable PHI-safe lab extraction.",
        });
      }
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = ctx.user.id;
      const log = (operation: string) => ({
        sb,
        userId,
        initiatedBy: userId,
        operation,
        promptTemplate: operation,
        promptVersion: "1.0.0",
        clinical: true,
      });

      // ---- Pass 1: verbatim transcription from the file(s) --------------------
      const pdf = input.files.find((f) => f.mimeType === "application/pdf");
      let providerFileId: string | null = null;
      let pass1Content: ChatContentPart[];
      try {
        if (pdf) {
          providerFileId = await uploadProviderFile(config, pdf.fileName, pdf.mimeType, pdf.base64);
          pass1Content = [
            { type: "file", file: { file_id: providerFileId } },
            { type: "text", text: PASS1_PROMPT },
          ];
        } else {
          pass1Content = [
            { type: "text", text: PASS1_PROMPT },
            ...input.files.map((f): ChatContentPart => ({
              type: "image_url",
              image_url: { url: `data:${f.mimeType};base64,${f.base64}` },
            })),
          ];
        }

        const pass1 = await generateStructured({
          config,
          log: log("labs.extract.transcribe"),
          schema: pass1Schema,
          messages: [{ role: "user", content: pass1Content }],
        });

        if (!pass1.ok || pass1.data.biomarkers.length === 0) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: "Could not read biomarkers from this document. Try a clearer scan or PDF.",
          });
        }

        const reportDate = pass1.data.reportDate ?? input.collectedAt ?? null;

        // ---- Duplicate / corrected-report detection ---------------------------
        const hash = dedupeHash(pass1.data.biomarkers, reportDate);
        const { data: existing } = await sb
          .from("uploaded_documents")
          .select("id, status, created_at")
          .eq("user_id", userId)
          .eq("dedupe_hash", hash)
          .neq("status", "superseded")
          .limit(1);
        if (existing && existing.length > 0) {
          return {
            duplicate: true as const,
            existingDocumentId: String(existing[0].id),
            biomarkerCount: pass1.data.biomarkers.length,
          };
        }

        // ---- Pass 2: enrichment from pass-1 JSON (no file re-exposure) --------
        const pass2 = await generateStructured({
          config,
          log: log("labs.extract.enrich"),
          schema: pass2Schema,
          messages: [
            { role: "system", content: PASS2_PROMPT },
            { role: "user", content: JSON.stringify({ biomarkers: pass1.data.biomarkers }) },
          ],
        });

        // Pass-1 verbatim numbers always win; pass-2 may only add enrichment.
        type EnrichedBiomarker = z.infer<typeof enrichedBiomarkerSchema>;
        const pass1ByName = new Map(pass1.data.biomarkers.map((b) => [b.name.toLowerCase().trim(), b]));
        const enriched: EnrichedBiomarker[] = (pass2.ok
          ? pass2.data.biomarkers
          : pass1.data.biomarkers.map(
              (b): EnrichedBiomarker => ({ ...b, functionalMin: null, functionalMax: null, status: "normal" })
            )
        )
          .filter((b) => pass1ByName.has(b.name.toLowerCase().trim()))
          .map((b) => {
            const original = pass1ByName.get(b.name.toLowerCase().trim())!;
            return { ...b, value: original.value, unit: original.unit, referenceMin: original.referenceMin, referenceMax: original.referenceMax };
          });
        for (const original of pass1.data.biomarkers) {
          if (!enriched.some((b) => b.name.toLowerCase().trim() === original.name.toLowerCase().trim())) {
            enriched.push({ ...original, functionalMin: null, functionalMax: null, status: "normal" });
          }
        }

        // ---- Narrative analysis (from values, not the file) --------------------
        const summaryLines = enriched
          .map((b) => `${b.name}: ${b.value} ${b.unit}${b.referenceMin != null ? ` (ref ${b.referenceMin}-${b.referenceMax})` : ""} [${b.status}]`)
          .join("\n");
        const narrative = await generateNarrative({
          config,
          log: log("labs.extract.analysis"),
          messages: [
            { role: "system", content: ANALYSIS_PROMPT },
            { role: "user", content: summaryLines },
          ],
        });
        const analysisText = narrative.ok
          ? narrative.text
          : "Analysis temporarily unavailable. Your biomarkers were extracted and saved.";

        // ---- Persist provenance -------------------------------------------------
        const { data: docRow, error: docError } = await sb
          .from("uploaded_documents")
          .insert({
            user_id: userId,
            file_name: input.files.map((f) => f.fileName).join(", ").slice(0, 300),
            mime_type: pdf ? "application/pdf" : input.files[0].mimeType,
            page_count: pdf ? null : input.files.length,
            raw_text: JSON.stringify(pass1.data).slice(0, 100000),
            extraction: { biomarkers: enriched, reportDate, labCompany: pass1.data.labCompany ?? null },
            extraction_model: config.model,
            extraction_confidence: pass2.ok ? 0.9 : 0.75,
            dedupe_hash: hash,
            status: "extracted",
            report_date: reportDate ? reportDate.slice(0, 10) : null,
            created_by: userId,
          })
          .select("id")
          .single();

        if (docError || !docRow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Extraction succeeded but could not be stored. Has the Phase 2 migration been applied?",
          });
        }
        const documentId = String(docRow.id);

        // Structured markers for reasoning/trends (client keeps owning lab_panels).
        const collectedIso = reportDate
          ? new Date(reportDate.length === 10 ? `${reportDate}T12:00:00Z` : reportDate).toISOString()
          : new Date().toISOString();
        for (const b of enriched) {
          await sb.from("lab_markers").insert({
            user_id: userId,
            marker_name: b.name,
            marker_value: b.value,
            unit: b.unit || "",
            reference_range_low: b.referenceMin ?? null,
            reference_range_high: b.referenceMax ?? null,
            optimal_range_low: b.functionalMin ?? null,
            optimal_range_high: b.functionalMax ?? null,
            collected_at: collectedIso,
            source: `server_extraction:${documentId}`,
          });
        }

        // ---- Re-reason with the new data (best-effort) --------------------------
        let pipelineRan = false;
        try {
          await runReasoningPipeline(sb, { id: userId }, userId, "new_lab");
          pipelineRan = true;
        } catch {
          console.log("[Labs] post-extraction reasoning pipeline failed (non-blocking)");
        }

        return {
          duplicate: false as const,
          documentId,
          reportDate,
          biomarkers: enriched,
          analysisText,
          supplements: pass2.ok ? pass2.data.supplements : [],
          herbs: pass2.ok ? pass2.data.herbs : [],
          priorityActions: pass2.ok ? pass2.data.priorityActions : [],
          pipelineRan,
        };
      } finally {
        if (providerFileId) {
          void deleteProviderFile(config, providerFileId);
        }
      }
    }),
});
