import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { z } from 'zod';

import { trpcClient } from '@/lib/trpc';
import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordAccessPattern } from '@/lib/breachDetection';
import { sendLabsAnalyzed, sendLabUploadStarted } from '@/lib/webhooks';
import { labPanelService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import { LabPanel, Biomarker, LabAnalysis } from '@/types';
import { findAffiliateLink, AffiliateLink } from '@/constants/affiliateLinks';

export interface SupplementRecommendation {
  name: string;
  dose: string;
  timing: string;
  reason: string;
  mechanism: string;
  affiliateLink?: AffiliateLink;
}

export interface LabAnalysisResult {
  analysis: LabAnalysis;
  biomarkers: Biomarker[];
  supplements: SupplementRecommendation[];
  herbs: SupplementRecommendation[];
  priorityActions: string[];
}

const nullableNumber = z.preprocess(
  (val) => (val === null || val === undefined ? undefined : val),
  z.number().optional()
);

const nullableString = z.preprocess(
  (val) => (val === null || val === undefined ? '' : val),
  z.string()
);

const biomarkerSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: nullableString,
  referenceMin: nullableNumber,
  referenceMax: nullableNumber,
  functionalMin: nullableNumber,
  functionalMax: nullableNumber,
  status: z.enum(['optimal', 'normal', 'suboptimal', 'critical']),
});

const supplementSchema = z.object({
  name: z.string(),
  dose: z.string(),
  timing: z.string(),
  reason: z.string(),
  mechanism: z.string(),
});

const labExtractionSchema = z.object({
  biomarkers: z.array(biomarkerSchema),
  supplements: z.array(supplementSchema),
  herbs: z.array(supplementSchema),
  priorityActions: z.array(z.string()),
});

const STORAGE_KEY = 'longevity_lab_panels';
const LATEST_ANALYSIS_KEY = 'longevity_latest_lab_analysis';
const CROSS_LAB_SYNTHESIS_KEY = 'longevity_cross_lab_synthesis';

export interface StoredLabAnalysis {
  panelId?: string;
  generatedAt: string;
  supplements: SupplementRecommendation[];
  herbs: SupplementRecommendation[];
  priorityActions: string[];
  flaggedBiomarkerNames: string[];
}

export interface CrossLabPattern {
  name: string;
  description: string;
  panels?: string[];
}

export interface CrossLabSynthesis {
  patterns: CrossLabPattern[];
  narrative: string;
  panelCount: number;
  generatedAt: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function revokeIfObjectUrl(uri: string): void {
  if (Platform.OS === 'web' && uri.startsWith('blob:')) {
    try { URL.revokeObjectURL(uri); } catch { /* already revoked */ }
  }
}

/** Read a local file (native path or web blob/object URL) as raw base64. */
async function readFileAsBase64(fileUri: string): Promise<string> {
  if (Platform.OS !== 'web') {
    return FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  }
  const response = await fetch(fileUri);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * All AI traffic goes through the authenticated server-side proxy
 * (backend/trpc/routes/ai.ts). No API keys ship in the client bundle and
 * lab documents (PHI) are never sent to third parties from the device.
 */
async function uploadPdfForAnalysis(fileUri: string, fileName: string): Promise<string> {
  console.log('[Labs] Uploading PDF for server-side analysis');
  const base64 = await readFileAsBase64(fileUri);
  const { fileId } = await trpcClient.ai.uploadPdf.mutate({ base64, fileName });
  console.log('[Labs] PDF uploaded for analysis');
  return fileId;
}

async function callAiWithFile(fileId: string, prompt: string, expectJson: boolean): Promise<string> {
  const res = await trpcClient.ai.promptWithFile.mutate({ fileId, prompt, expectJson });
  return res.text;
}

async function callAiWithImages(prompt: string, images: string[], expectJson: boolean): Promise<string> {
  const res = await trpcClient.ai.promptWithImages.mutate({ prompt, images, expectJson });
  return res.text;
}

/** Best-effort cleanup of a server-uploaded AI file. Never throws. */
async function deleteAiFile(fileId: string): Promise<void> {
  try {
    await trpcClient.ai.deleteFile.mutate({ fileId });
    console.log('[Labs] Cleaned up uploaded AI file');
  } catch {
    console.log('[Labs] AI file cleanup failed (non-blocking)');
  }
}

/**
 * Explicit JSON shape appended to extraction prompts. json_object mode has no
 * schema enforcement server-side, so the prompt must fully describe the shape;
 * responses are validated client-side with labExtractionSchema.
 */
const EXTRACTION_JSON_SHAPE = `

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "biomarkers": [{"name": string, "value": number, "unit": string, "referenceMin": number|null, "referenceMax": number|null, "functionalMin": number|null, "functionalMax": number|null, "status": "optimal"|"normal"|"suboptimal"|"critical"}],
  "supplements": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "herbs": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "priorityActions": [string]
}
Every array must be present (use [] when empty).`;

/** Parse + zod-validate an extraction response. Returns null when invalid. */
function parseExtraction(text: string): z.infer<typeof labExtractionSchema> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = labExtractionSchema.safeParse(parsed);
    if (!result.success) {
      console.log('[Labs] Extraction response failed schema validation');
      return null;
    }
    return result.data;
  } catch {
    console.log('[Labs] Extraction response was not valid JSON');
    return null;
  }
}

const LAB_ANALYSIS_PROMPT = `🧬 FUNCTIONAL / LONGEVITY LAB INTERPRETATION MASTER PROMPT

You are a world-class functional medicine, longevity, and systems-biology physician.

Analyze the lab results shown in this document using a root-cause, pattern-recognition, and longevity-optimization framework.

For your response, structure it exactly as follows:

1. BIG-PICTURE SUMMARY (TOP PRIORITIES)
In 3–6 bullets, identify the most important physiological imbalances.
Rank them by impact on: Energy, Hormones, Metabolism, Brain, Immune system, Inflammation, Longevity

2. PATTERN RECOGNITION
Identify patterns: Mitochondrial dysfunction, Insulin resistance, Thyroid resistance, HPA axis dysregulation, Estrogen dominance, Methylation issues, Oxidative stress, Inflammation, Immune issues, Detox congestion, Gut issues, Chronic infections
Explain how markers connect as systems.

3. MARKER-BY-MARKER ANALYSIS
For each abnormal marker: What it means, system it belongs to, functional range, root causes, consequences, links to other markers

4. FUNCTIONAL OPTIMAL TARGETS
Current value, lab range, functional optimal range, gap from optimal, clinical meaning

5. ROOT-CAUSE ACTION PLAN
A) Diet - foods to emphasize/avoid, therapeutic diet style
B) Lifestyle - sleep, circadian, stress, training, sauna/cold, light
C) Supplements - foundational, targeted, doses, timing, mechanism
D) Peptides/Advanced Tools - if appropriate
E) Detox & Gut Repair - Phase I/II support, binders, microbiome

6. LONGEVITY INTERPRETATION
Biological age, cardiometabolic risk, neurodegeneration, cancer terrain, hormone aging, mitochondrial resilience, inflammaging

7. PATIENT-FRIENDLY EXPLANATION
Explain simply: What's off, why it matters, what fixing it changes. Speak directly to "you".

8. PRIORITY SUMMARY
Top 3 Things to Fix First
If You Do Nothing Else, Do These 3 Things

Tone: Clear, Precise, Educational, No fear-mongering, No sugar-coating`;

const STATUS_RANK: Record<Biomarker['status'], number> = {
  optimal: 0,
  normal: 1,
  suboptimal: 2,
  critical: 3,
};

/**
 * Deterministic cross-panel pattern detector. No AI, no network: flags
 * biomarkers that are abnormal across multiple panels and status trends for
 * the same biomarker across panels (worsening/improving by status rank).
 */
function buildCrossLabSynthesis(panels: LabPanel[]): CrossLabSynthesis {
  const sorted = [...panels].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  interface Occurrence {
    panelId: string;
    panelName: string;
    status: Biomarker['status'];
    displayName: string;
  }
  const byName = new Map<string, Occurrence[]>();
  sorted.forEach((panel) => {
    panel.biomarkers.forEach((b) => {
      const key = b.name.toLowerCase().trim();
      if (!key) return;
      const list = byName.get(key) ?? [];
      list.push({
        panelId: panel.id,
        panelName: panel.name,
        status: b.status,
        displayName: b.name,
      });
      byName.set(key, list);
    });
  });

  const patterns: CrossLabPattern[] = [];
  let recurringCount = 0;
  let worseningCount = 0;
  let improvingCount = 0;

  byName.forEach((occurrences) => {
    const displayName = occurrences[occurrences.length - 1].displayName;

    // Recurring abnormality across >= 2 distinct panels
    const abnormal = occurrences.filter(
      (o) => o.status === 'suboptimal' || o.status === 'critical'
    );
    const abnormalPanelNames = Array.from(new Set(abnormal.map((o) => o.panelName)));
    if (abnormalPanelNames.length >= 2) {
      recurringCount += 1;
      patterns.push({
        name: `${displayName} flagged in multiple labs`,
        description: `${displayName} is outside the optimal range in ${abnormalPanelNames.length} separate panels, which makes it a consistent finding rather than a one-off result.`,
        panels: abnormalPanelNames,
      });
    }

    // Status trend across panels (earliest vs latest measurement)
    const distinctPanelIds = new Set(occurrences.map((o) => o.panelId));
    if (distinctPanelIds.size >= 2) {
      const first = occurrences[0];
      const last = occurrences[occurrences.length - 1];
      const firstRank = STATUS_RANK[first.status];
      const lastRank = STATUS_RANK[last.status];
      if (lastRank > firstRank) {
        worseningCount += 1;
        patterns.push({
          name: `${displayName} trending away from optimal`,
          description: `${displayName} moved from "${first.status}" (${first.panelName}) to "${last.status}" (${last.panelName}) across your panels.`,
          panels: [first.panelName, last.panelName],
        });
      } else if (lastRank < firstRank) {
        improvingCount += 1;
        patterns.push({
          name: `${displayName} improving`,
          description: `${displayName} improved from "${first.status}" (${first.panelName}) to "${last.status}" (${last.panelName}) across your panels.`,
          panels: [first.panelName, last.panelName],
        });
      }
    }
  });

  const narrativeParts: string[] = [];
  if (recurringCount > 0) {
    narrativeParts.push(
      `${recurringCount} biomarker${recurringCount === 1 ? ' is' : 's are'} consistently outside the optimal range across multiple panels`
    );
  }
  if (worseningCount > 0) {
    narrativeParts.push(`${worseningCount} moved away from optimal between panels`);
  }
  if (improvingCount > 0) {
    narrativeParts.push(`${improvingCount} improved between panels`);
  }
  const narrative =
    narrativeParts.length > 0
      ? `Comparing your ${sorted.length} lab panels: ${narrativeParts.join('; ')}. Recurring and worsening markers are the highest-leverage places to focus your protocol.`
      : `Comparing your ${sorted.length} lab panels: no biomarker was flagged in more than one panel and no cross-panel status changes were detected.`;

  return {
    patterns,
    narrative,
    panelCount: sorted.length,
    generatedAt: new Date().toISOString(),
  };
}

export const [LabsProvider, useLabs] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [labPanels, setLabPanels] = useState<LabPanel[]>([]);
  const [latestAnalysis, setLatestAnalysis] = useState<StoredLabAnalysis | null>(null);
  const [crossLabSynthesis, setCrossLabSynthesis] = useState<CrossLabSynthesis | null>(null);

  const labsQuery = useQuery({
    queryKey: ['labPanels'],
    queryFn: async () => {
      const stored = await secureGetJSON<LabPanel[]>(STORAGE_KEY);
      await recordAccessPattern('lab_panels', 'read');
      return stored ?? [];
    },
  });

  const latestAnalysisQuery = useQuery({
    queryKey: ['latestLabAnalysis'],
    queryFn: async () => {
      const stored = await secureGetJSON<StoredLabAnalysis>(LATEST_ANALYSIS_KEY);
      return stored ?? null;
    },
  });

  const crossLabSynthesisQuery = useQuery({
    queryKey: ['crossLabSynthesis'],
    queryFn: async () => {
      const stored = await secureGetJSON<CrossLabSynthesis>(CROSS_LAB_SYNTHESIS_KEY);
      return stored ?? null;
    },
  });

  useEffect(() => {
    if (labsQuery.data) setLabPanels(labsQuery.data);
  }, [labsQuery.data]);

  useEffect(() => {
    if (latestAnalysisQuery.data !== undefined) setLatestAnalysis(latestAnalysisQuery.data);
  }, [latestAnalysisQuery.data]);

  useEffect(() => {
    if (crossLabSynthesisQuery.data !== undefined) setCrossLabSynthesis(crossLabSynthesisQuery.data);
  }, [crossLabSynthesisQuery.data]);

  const saveLatestAnalysisMutation = useMutation({
    mutationFn: async (analysis: StoredLabAnalysis) => {
      await secureSetJSON(LATEST_ANALYSIS_KEY, analysis);
      return analysis;
    },
    onSuccess: (data) => {
      setLatestAnalysis(data);
      void queryClient.invalidateQueries({ queryKey: ['latestLabAnalysis'] });
    },
  });

  const saveCrossLabSynthesisMutation = useMutation({
    mutationFn: async (synthesis: CrossLabSynthesis) => {
      await secureSetJSON(CROSS_LAB_SYNTHESIS_KEY, synthesis);
      return synthesis;
    },
    onSuccess: (data) => {
      setCrossLabSynthesis(data);
      void queryClient.invalidateQueries({ queryKey: ['crossLabSynthesis'] });
    },
  });

  const saveLabsMutation = useMutation({
    mutationFn: async (panels: LabPanel[]) => {
      await secureSetJSON(STORAGE_KEY, panels);
      await writeAuditLog('PHI_UPDATE', 'lab_panels', 'user', `Saved ${panels.length} panels`);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && panels.length > 0) {
          console.log('[Labs] Syncing lab panels to Supabase...');
          const latest = panels[panels.length - 1];
          await labPanelService.upsert({
            name: latest.name,
            date: latest.date,
            source: latest.source ?? null,
            biomarkers_json: latest.biomarkers as unknown as Record<string, unknown>[],
            notes: null,
          });
        }
      } catch (e) {
        console.log('[Labs] Supabase sync failed (non-blocking):', errMsg(e));
      }

      return panels;
    },
    onSuccess: (data) => {
      setLabPanels(data);
      void queryClient.invalidateQueries({ queryKey: ['labPanels'] });
    },
    onError: () => {
      console.log('[Labs] Save failed');
    },
  });

  const latestPanel = useMemo(() => {
    if (labPanels.length === 0) return null;
    return [...labPanels].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];
  }, [labPanels]);

  const previousPanel = useMemo(() => {
    if (labPanels.length < 2) return null;
    const sorted = [...labPanels].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sorted[1];
  }, [labPanels]);

  const flaggedBiomarkers = useMemo(() => {
    if (!latestPanel) return [];
    return latestPanel.biomarkers.filter(b =>
      b.status === 'suboptimal' || b.status === 'critical'
    );
  }, [latestPanel]);

  const optimalBiomarkers = useMemo(() => {
    if (!latestPanel) return [];
    return latestPanel.biomarkers.filter(b => b.status === 'optimal');
  }, [latestPanel]);

  /** Latest value per biomarker (deduped by name) across ALL panels. */
  const allBiomarkers = useMemo<Biomarker[]>(() => {
    if (labPanels.length === 0) return [];
    const sorted = [...labPanels].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const seen = new Set<string>();
    const deduped: Biomarker[] = [];
    sorted.forEach(panel => {
      panel.biomarkers.forEach(b => {
        const key = b.name.toLowerCase().trim();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(b);
      });
    });
    return deduped;
  }, [labPanels]);

  const getBiomarkerTrend = useCallback((biomarkerId: string): 'up' | 'down' | 'stable' | null => {
    if (!latestPanel || !previousPanel) return null;

    const currentBio = latestPanel.biomarkers.find(b => b.name ===
      latestPanel.biomarkers.find(lb => lb.id === biomarkerId)?.name
    );
    const previousBio = previousPanel.biomarkers.find(b => b.name === currentBio?.name);

    if (!currentBio || !previousBio) return null;

    const percentChange = ((currentBio.value - previousBio.value) / previousBio.value) * 100;

    if (Math.abs(percentChange) < 5) return 'stable';
    return percentChange > 0 ? 'up' : 'down';
  }, [latestPanel, previousPanel]);

  const biomarkersByCategory = useMemo(() => {
    if (!latestPanel) return {};

    const categories: Record<string, Biomarker[]> = {
      'Metabolic': [],
      'Lipids': [],
      'Thyroid': [],
      'Inflammation': [],
      'Hormones': [],
      'Nutrients': [],
    };

    latestPanel.biomarkers.forEach(bio => {
      if (['Fasting Glucose', 'HbA1c', 'Fasting Insulin'].includes(bio.name)) {
        categories['Metabolic'].push(bio);
      } else if (['Total Cholesterol', 'HDL', 'LDL', 'Triglycerides'].includes(bio.name)) {
        categories['Lipids'].push(bio);
      } else if (['TSH', 'Free T3'].includes(bio.name)) {
        categories['Thyroid'].push(bio);
      } else if (['hs-CRP', 'Homocysteine'].includes(bio.name)) {
        categories['Inflammation'].push(bio);
      } else if (['Testosterone (Total)', 'DHEA-S'].includes(bio.name)) {
        categories['Hormones'].push(bio);
      } else {
        categories['Nutrients'].push(bio);
      }
    });

    return categories;
  }, [latestPanel]);

  const addLabPanel = useCallback((panel: LabPanel) => {
    const updated = [...labPanels, panel];
    saveLabsMutation.mutate(updated);
  }, [labPanels, saveLabsMutation]);

  /**
   * Deterministic cross-panel synthesis (no AI, no network). Persisted so
   * labs.tsx can render it across sessions.
   */
  const runCrossLabSynthesis = useCallback(async (): Promise<CrossLabSynthesis | null> => {
    if (labPanels.length < 2) {
      console.log('[Labs] Cross-lab synthesis skipped: fewer than 2 panels');
      return null;
    }
    const synthesis = buildCrossLabSynthesis(labPanels);
    await saveCrossLabSynthesisMutation.mutateAsync(synthesis);
    console.log('[Labs] Cross-lab synthesis complete:', synthesis.patterns.length, 'patterns across', synthesis.panelCount, 'panels');
    return synthesis;
  }, [labPanels, saveCrossLabSynthesisMutation]);

  const pickLabImages = useCallback(async (): Promise<{ uri: string; name: string; mimeType: string }[]> => {
    try {
      if (Platform.OS === 'web') {
        return await new Promise<{ uri: string; name: string; mimeType: string }[]>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.style.display = 'none';

          let settled = false;
          let cancelTimer: ReturnType<typeof setTimeout> | null = null;
          const finish = (results: { uri: string; name: string; mimeType: string }[]) => {
            if (settled) return;
            settled = true;
            if (cancelTimer) clearTimeout(cancelTimer);
            window.removeEventListener('focus', onFocus);
            try { document.body.removeChild(input); } catch { /* already removed */ }
            resolve(results);
          };
          // Fallback for browsers that never fire `oncancel`: when the file
          // dialog closes the window regains focus; if no change event follows
          // shortly, settle the promise as a cancel.
          const onFocus = () => {
            cancelTimer = setTimeout(() => finish([]), 1500);
          };

          input.onchange = () => {
            const files = Array.from(input.files ?? []);
            const validImages = files.filter((f) => (f.type || '').startsWith('image/'));
            const skipped = files.length - validImages.length;
            if (skipped > 0) {
              console.log('[Labs] Ignored', skipped, 'non-image files (e.g. PDFs). Use Upload PDF instead.');
            }
            const results = validImages.map((f, i) => ({
              uri: URL.createObjectURL(f),
              name: f.name || `lab-image-${i + 1}.jpg`,
              mimeType: f.type || 'image/jpeg',
            }));
            console.log('[Labs] Picked', results.length, 'images (web)');
            finish(results);
          };
          input.oncancel = () => finish([]);

          window.addEventListener('focus', onFocus, { once: true });
          document.body.appendChild(input);
          input.click();
        });
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        console.log('[Labs] Media library permission denied');
        return [];
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 30,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return [];
      console.log('[Labs] Picked', result.assets.length, 'images');
      return result.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName || `lab-image-${i + 1}.jpg`,
        mimeType: a.mimeType || 'image/jpeg',
      }));
    } catch (e) {
      console.log('[Labs] Error picking images:', errMsg(e));
      return [];
    }
  }, []);

  const pickLabDocument = useCallback(async (): Promise<{ uri: string; name: string; mimeType: string } | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        console.log('[Labs] Document picked successfully');
        return {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType || 'application/pdf',
        };
      }
      return null;
    } catch {
      console.log('[Labs] Error picking document');
      return null;
    }
  }, []);

  const analyzeLabMutation = useMutation({
    mutationFn: async (params: { fileUri: string; mimeType: string; panelId?: string; fileName?: string }): Promise<LabAnalysisResult> => {
      const { fileUri, mimeType, panelId, fileName } = params;
      console.log('[Labs] Starting lab analysis');

      const isImage = mimeType.startsWith('image/');
      const isPdf = mimeType === 'application/pdf';

      if (!isImage && !isPdf) {
        throw new Error('Please upload an image or PDF file of your lab results.');
      }

      let base64Content = '';
      if (isImage) {
        try {
          base64Content = await readFileAsBase64(fileUri);
        } catch {
          throw new Error('Could not read the uploaded file. Please try again.');
        } finally {
          revokeIfObjectUrl(fileUri);
        }
      }

      let extractedData = { biomarkers: [], supplements: [], herbs: [], priorityActions: [] } as z.infer<typeof labExtractionSchema>;
      let extractionError: string | null = null;

      const extractionPrompt = `You are analyzing a lab report for a functional medicine practice. Extract ALL biomarker values you can find.

For each biomarker found, provide:
- name: The biomarker name (e.g., "Fasting Glucose", "TSH", "Vitamin D")
- value: The numeric value
- unit: The unit of measurement
- referenceMin/referenceMax: The lab's reference range
- functionalMin/functionalMax: The optimal functional medicine range
- status: "optimal" (within functional range), "normal" (within reference but not optimal), "suboptimal" (slightly outside), or "critical" (significantly outside)

IMPORTANT — Supplement recommendations:
When recommending supplements, PRIORITIZE these specific products from our curated catalog. Use the exact product name and brand when the condition matches:

- ProOmega 2000 (Nordic Naturals) — 2 softgels daily with meals — for omega-3, fish oil, EPA/DHA, inflammation, cardiovascular, triglycerides
- GlucoPrime (Healthgevity) — 1 capsule 2x daily with meals — for blood sugar, insulin resistance, glucose, HbA1c
- Protect+ 10 (Healthgevity) — 1 softgel daily with fat — for foundational multi, vitamin D, antioxidants
- Liver Sauce (Quicksilver Scientific) — 1 tsp daily empty stomach — for liver support, detox, ALT/AST elevation
- Liposomal Glutathione Complex (Quicksilver Scientific) — 1 tsp daily empty stomach — for glutathione, oxidative stress, detox
- Glutaryl Transdermal Glutathione (Auro Wellness) — 4 pumps daily on skin — for glutathione, detox support
- MitoCore (Orthomolecular) — 4 capsules daily with breakfast — for mitochondrial support, CoQ10, energy, fatigue
- NAC 900+ (Healthgevity) — 1-2 capsules daily — for NAC, liver support, glutathione precursor
- Gut Shield (Healthgevity) — 1 scoop daily — for gut repair, leaky gut, IBS, gut inflammation
- ProBiota HistaminX (Seeking Health) — 1 capsule daily — for probiotics, histamine intolerance, gut health
- Sleep Deep (Healthgevity) — 2 capsules before bed — for sleep, insomnia, GABA, magnesium
- Magnesium Glycinate 300 (Healthgevity) — 1-2 capsules evening — for magnesium, sleep, muscle cramps, stress
- Methyl B Complex (Healthgevity) — 1 capsule morning — for B vitamins, methylation, MTHFR, homocysteine
- D3+K2 5000 (Healthgevity) — 1 softgel morning with fat — for vitamin D deficiency, bone health, immune
- Adrenal Restore (Healthgevity) — 2 capsules morning — for adrenal fatigue, cortisol, HPA axis, stress

If the patient's labs indicate a condition that matches one of these products, recommend that SPECIFIC product by name and brand. For conditions not covered by our catalog, you may recommend generic supplements with standard dosing.

Also provide:
- herbs: Recommended herbs/botanicals with dose, timing, reason, and mechanism
- priorityActions: Top 3-5 priority actions to take based on the actual lab values

Be thorough and extract every biomarker visible in the document. Base ALL recommendations on the patient's actual biomarker values — not generic advice.`;

      let aiFileId: string | null = null;

      if (isPdf) {
        console.log('[Labs] PDF detected — uploading via secure server proxy');
        try {
          aiFileId = await uploadPdfForAnalysis(fileUri, fileName ?? 'lab-results.pdf');
        } catch (uploadErr) {
          console.log('[Labs] PDF upload failed:', errMsg(uploadErr));
          throw new Error(
            'Could not upload this PDF for analysis. Please check your connection and try again.'
          );
        } finally {
          revokeIfObjectUrl(fileUri);
        }

        try {
          // PASS 1 — strict VERBATIM extraction of biomarker values from the PDF.
          // No recommendations, no status inference, no catalogs — just the numbers as printed.
          const verbatimExtractionPrompt = `You are reading a clinical lab PDF. Transcribe EVERY biomarker / analyte row VERBATIM from the document.

RULES — read carefully:
1. Copy the numeric value EXACTLY as printed in the PDF. Do NOT round. Do NOT convert units. Do NOT substitute values from memory or general knowledge.
2. Match each value to the SAME ROW as its label and unit. Never pull a number from another row.
3. If the PDF shows "<0.1" or ">100" treat the number after the operator as the value.
4. Copy the reference range EXACTLY as printed (e.g. "70-99" → referenceMin 70, referenceMax 99). If only one bound is printed, set the other to null.
5. If a value is illegible or missing, OMIT that biomarker entirely. Do NOT guess.
6. Do NOT invent biomarkers that are not in the PDF.
7. Use the marker name as printed (e.g. "Glucose, Fasting", "Hemoglobin A1c", "TSH, 3rd Generation").

Return ONLY valid JSON with this exact shape:
{
  "biomarkers": [
    {
      "name": string,
      "value": number,
      "unit": string,
      "referenceMin": number|null,
      "referenceMax": number|null
    }
  ]
}`;

          const verbatimJson = await callAiWithFile(aiFileId, verbatimExtractionPrompt, true);
          const verbatimParsed = JSON.parse(verbatimJson) as {
            biomarkers?: { name: string; value: number; unit: string; referenceMin: number | null; referenceMax: number | null }[];
          };
          const verbatimBiomarkers = (verbatimParsed.biomarkers ?? []).filter(
            (b) => typeof b?.value === 'number' && Number.isFinite(b.value) && typeof b?.name === 'string' && b.name.trim().length > 0
          );
          console.log('[Labs] Verbatim extraction complete:', verbatimBiomarkers.length, 'biomarkers');

          if (verbatimBiomarkers.length === 0) {
            throw new Error('PDF_UNREADABLE');
          }

          // PASS 2 — enrich the verbatim values with functional ranges, status, supplements, herbs.
          // The model MUST NOT change the numeric values or reference ranges from pass 1.
          const enrichmentPrompt = `${extractionPrompt}

The biomarker values below were transcribed VERBATIM from the patient's lab PDF. You MUST preserve every value, unit, and reference range EXACTLY as given. Do not change, round, or replace any number. Only add functionalMin, functionalMax, and status — and produce the supplements / herbs / priorityActions arrays based on these values.

VERBATIM BIOMARKERS (do not modify):
${JSON.stringify(verbatimBiomarkers, null, 2)}
${EXTRACTION_JSON_SHAPE}

The "biomarkers" array MUST contain exactly the same entries (same name/value/unit/referenceMin/referenceMax) as the verbatim list above, in the same order, only with functionalMin/functionalMax/status added.`;

          const jsonText = await callAiWithFile(aiFileId, enrichmentPrompt, true);
          const parsed = JSON.parse(jsonText) as { biomarkers?: unknown[] } & Record<string, unknown>;

          // Safety: if the enrichment pass drifted any values, force-restore the verbatim numbers.
          if (Array.isArray(parsed.biomarkers)) {
            const byName = new Map(verbatimBiomarkers.map((b) => [b.name.toLowerCase().trim(), b]));
            parsed.biomarkers = (parsed.biomarkers as Record<string, unknown>[]).map((b) => {
              const key = typeof b.name === 'string' ? b.name.toLowerCase().trim() : '';
              const truth = byName.get(key);
              if (truth) {
                return {
                  ...b,
                  name: truth.name,
                  value: truth.value,
                  unit: truth.unit,
                  referenceMin: truth.referenceMin,
                  referenceMax: truth.referenceMax,
                };
              }
              return b;
            });
          }

          const validated = labExtractionSchema.safeParse(parsed);
          if (!validated.success) {
            console.log('[Labs] PDF enrichment response failed schema validation');
            throw new Error('PDF_UNREADABLE');
          }
          extractedData = validated.data;
          console.log('[Labs] PDF extraction complete:', extractedData.biomarkers.length, 'biomarkers');

          if (extractedData.biomarkers.length === 0) {
            throw new Error('PDF_UNREADABLE');
          }
        } catch (pdfError) {
          const msg = pdfError instanceof Error ? pdfError.message : '';
          if (aiFileId) void deleteAiFile(aiFileId);
          if (msg === 'PDF_UNREADABLE') {
            throw new Error(
              'We couldn\'t extract biomarkers from this PDF. The file may be a scan without selectable text — try uploading a digital PDF or screenshots of the results pages.'
            );
          }
          console.log('[Labs] PDF extraction failed:', msg);
          throw new Error(
            'Failed to analyze this PDF. Please try again or upload screenshots of the results pages.'
          );
        }
      } else {
        // Image file — extract via the server-side vision proxy and validate
        // the JSON against the zod schema locally.
        const imageDataUrl = `data:${mimeType};base64,${base64Content}`;

        console.log('[Labs] Extracting biomarkers from image via server AI proxy...');

        try {
          const raw = await callAiWithImages(extractionPrompt + EXTRACTION_JSON_SHAPE, [imageDataUrl], true);
          const parsed = parseExtraction(raw);
          if (!parsed) {
            throw new Error('Extraction response did not match the expected format.');
          }
          extractedData = parsed;
          console.log('[Labs] Image extraction complete');
        } catch (error: unknown) {
          console.log('[Labs] Extraction error occurred:', errMsg(error));
          extractionError = errMsg(error);
        }
      }

      if (extractedData.biomarkers.length === 0 && extractionError) {
        console.log('[Labs] No biomarkers extracted and had error, throwing...');
        throw new Error('Unable to read lab results from the document. Please try uploading a clearer image or PDF.');
      }

      let analysisText = '';

      if (isPdf && aiFileId) {
        console.log('[Labs] Generating analysis from PDF via server AI proxy...');
        try {
          analysisText = await callAiWithFile(aiFileId, LAB_ANALYSIS_PROMPT, false);
        } catch (e) {
          console.log('[Labs] PDF analysis generation failed:', errMsg(e));
          analysisText = 'Analysis temporarily unavailable. Your biomarkers have been extracted and saved.';
        }
        void deleteAiFile(aiFileId);
        aiFileId = null;

        const biomarkers: Biomarker[] = extractedData.biomarkers.map((b, index) => ({
          id: `bio_${Date.now()}_${index}`,
          name: b.name,
          value: b.value,
          unit: b.unit,
          referenceRange: { min: b.referenceMin ?? 0, max: b.referenceMax ?? 0 },
          functionalRange: { min: b.functionalMin ?? 0, max: b.functionalMax ?? 0 },
          status: b.status,
          date: new Date().toISOString(),
        }));
        const supplementsWithLinks: SupplementRecommendation[] = extractedData.supplements.map(supp => ({
          ...supp,
          affiliateLink: findAffiliateLink(supp.name),
        }));
        const herbsWithLinks: SupplementRecommendation[] = extractedData.herbs.map(herb => ({
          ...herb,
          affiliateLink: findAffiliateLink(herb.name),
        }));
        const analysis: LabAnalysis = {
          id: `analysis_${Date.now()}`,
          panelId: panelId || '',
          date: new Date().toISOString(),
          summary: analysisText,
          status: 'completed',
        };
        return {
          analysis,
          biomarkers,
          supplements: supplementsWithLinks,
          herbs: herbsWithLinks,
          priorityActions: extractedData.priorityActions,
        };
      }

      console.log('[Labs] Generating analysis via server AI proxy...');

      const imageDataUrl = `data:${mimeType};base64,${base64Content}`;

      try {
        analysisText = await callAiWithImages(LAB_ANALYSIS_PROMPT, [imageDataUrl], false);
      } catch (error: unknown) {
        const errorMessage = errMsg(error);
        console.log('[Labs] Analysis generation error');

        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
          if (extractedData.biomarkers.length === 0) {
            throw new Error('Network connection issue. Please check your internet connection and try again.');
          }
          analysisText = 'Analysis temporarily unavailable due to network issues. Your biomarkers have been extracted and saved.';
        } else if (extractedData.biomarkers.length === 0) {
          throw new Error('Unable to analyze lab document. Please try again or upload a clearer image.');
        } else {
          analysisText = 'Analysis temporarily unavailable. Your biomarkers have been extracted and saved.';
        }
      }

      const biomarkers: Biomarker[] = extractedData.biomarkers.map((b, index) => ({
        id: `bio_${Date.now()}_${index}`,
        name: b.name,
        value: b.value,
        unit: b.unit,
        referenceRange: { min: b.referenceMin ?? 0, max: b.referenceMax ?? 0 },
        functionalRange: { min: b.functionalMin ?? 0, max: b.functionalMax ?? 0 },
        status: b.status,
        date: new Date().toISOString(),
      }));

      const supplementsWithLinks: SupplementRecommendation[] = extractedData.supplements.map(supp => ({
        ...supp,
        affiliateLink: findAffiliateLink(supp.name),
      }));

      const herbsWithLinks: SupplementRecommendation[] = extractedData.herbs.map(herb => ({
        ...herb,
        affiliateLink: findAffiliateLink(herb.name),
      }));

      const analysis: LabAnalysis = {
        id: `analysis_${Date.now()}`,
        panelId: panelId || '',
        date: new Date().toISOString(),
        summary: analysisText,
        status: 'completed',
      };

      return {
        analysis,
        biomarkers,
        supplements: supplementsWithLinks,
        herbs: herbsWithLinks,
        priorityActions: extractedData.priorityActions,
      };
    },
  });

  const updateLabPanelBiomarkers = useCallback((panelId: string, biomarkers: Biomarker[]) => {
    const updated = labPanels.map(panel =>
      panel.id === panelId
        ? { ...panel, biomarkers }
        : panel
    );
    saveLabsMutation.mutate(updated);
  }, [labPanels, saveLabsMutation]);

  const createManualLabPanel = useCallback((name: string, date: string, biomarkers: Biomarker[]): LabPanel => {
    const panel: LabPanel = {
      id: `panel_${Date.now()}`,
      name,
      date,
      source: 'manual',
      biomarkers,
    };
    addLabPanel(panel);
    return panel;
  }, [addLabPanel]);

  const sendLabUploadStartedWebhook = useCallback((userId: string, email: string) => {
    sendLabUploadStarted({ userId, email });
  }, []);

  const sendLabsWebhook = useCallback((userId: string, email: string, labType: string, supplements: SupplementRecommendation[]) => {
    sendLabsAnalyzed({
      userId,
      email,
      labType,
      supplementsRecommended: supplements.map(s => ({
        name: s.name,
        affiliateLink: s.affiliateLink?.url || '',
        reason: s.reason,
      })),
    });
  }, []);

  const analyzeLabImagesMutation = useMutation({
    mutationFn: async (params: { images: { uri: string; mimeType: string }[]; panelId?: string; onProgress?: (msg: string) => void }): Promise<LabAnalysisResult> => {
      const { images, panelId, onProgress } = params;
      console.log('[Labs] Starting multi-image analysis with', images.length, 'images');
      onProgress?.(`Reading ${images.length} images...`);

      const readImage = async (img: { uri: string; mimeType: string }): Promise<string> => {
        const b64 = await readFileAsBase64(img.uri);
        return `data:${img.mimeType};base64,${b64}`;
      };

      const dataUrls: string[] = [];
      for (const img of images) {
        try {
          dataUrls.push(await readImage(img));
        } catch (e) {
          console.log('[Labs] Failed to read image:', errMsg(e));
        } finally {
          revokeIfObjectUrl(img.uri);
        }
      }
      if (dataUrls.length === 0) throw new Error('Could not read any of the uploaded images.');

      const extractionPrompt = `You are analyzing pages from a lab report for a functional medicine practice. Extract ALL biomarker values you can find across the pages.\n\nFor each biomarker found, provide:\n- name: The biomarker name (e.g., "Fasting Glucose", "TSH", "Vitamin D")\n- value: The numeric value\n- unit: The unit of measurement\n- referenceMin/referenceMax: The lab's reference range\n- functionalMin/functionalMax: The optimal functional medicine range\n- status: "optimal", "normal", "suboptimal", or "critical"\n\nIMPORTANT — When recommending supplements, PRIORITIZE these specific products:\n- ProOmega 2000 (Nordic Naturals) — for omega-3, cardiovascular\n- GlucoPrime (Healthgevity) — for blood sugar, insulin resistance\n- Protect+ 10 (Healthgevity) — foundational multi\n- Liver Sauce (Quicksilver Scientific) — liver support, detox\n- Liposomal Glutathione (Quicksilver Scientific) — glutathione, oxidative stress\n- MitoCore (Orthomolecular) — mitochondrial support, energy\n- NAC 900+ (Healthgevity) — liver, glutathione precursor\n- Gut Shield (Healthgevity) — gut repair\n- ProBiota HistaminX (Seeking Health) — probiotics, histamine\n- Sleep Deep (Healthgevity) — sleep support\n- Magnesium Glycinate 300 (Healthgevity) — magnesium\n- Methyl B Complex (Healthgevity) — B vitamins, methylation\n- D3+K2 5000 (Healthgevity) — vitamin D\n- Adrenal Restore (Healthgevity) — adrenal, cortisol\n\nUse exact product name and brand when the condition matches. Base ALL recommendations on actual biomarker values.\n\nAlso provide:\n- herbs: Recommended herbs with dose, timing, reason, mechanism\n- priorityActions: Top 3-5 priority actions\n\nDeduplicate biomarkers across pages. Be thorough.${EXTRACTION_JSON_SHAPE}`;

      const BATCH = 4;
      const batches: string[][] = [];
      for (let i = 0; i < dataUrls.length; i += BATCH) batches.push(dataUrls.slice(i, i + BATCH));

      const allBiomarkers: z.infer<typeof biomarkerSchema>[] = [];
      const allSupps: z.infer<typeof supplementSchema>[] = [];
      const allHerbs: z.infer<typeof supplementSchema>[] = [];
      const allActions: string[] = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        onProgress?.(`Extracting biomarkers from pages ${i * BATCH + 1}-${i * BATCH + batch.length} of ${dataUrls.length}...`);
        console.log(`[Labs] Batch ${i + 1}/${batches.length} with ${batch.length} images`);
        try {
          const raw = await callAiWithImages(extractionPrompt, batch, true);
          const parsed = parseExtraction(raw);
          if (!parsed) {
            console.log('[Labs] Batch response invalid, skipping batch');
            continue;
          }
          allBiomarkers.push(...parsed.biomarkers);
          allSupps.push(...parsed.supplements);
          allHerbs.push(...parsed.herbs);
          allActions.push(...parsed.priorityActions);
        } catch (e) {
          console.log('[Labs] Batch failed:', errMsg(e));
        }
      }

      if (allBiomarkers.length === 0) {
        throw new Error('We could not read biomarkers from these screenshots. Please make sure the values and labels are clearly visible.');
      }

      const seen = new Set<string>();
      const dedupedBiomarkers = allBiomarkers.filter(b => {
        const key = b.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const seenSupp = new Set<string>();
      const dedupedSupps = allSupps.filter(s => {
        const k = s.name.toLowerCase().trim();
        if (seenSupp.has(k)) return false;
        seenSupp.add(k);
        return true;
      });

      const seenHerb = new Set<string>();
      const dedupedHerbs = allHerbs.filter(h => {
        const k = h.name.toLowerCase().trim();
        if (seenHerb.has(k)) return false;
        seenHerb.add(k);
        return true;
      });

      onProgress?.('Generating functional medicine analysis...');
      console.log('[Labs] Generating final analysis from', dedupedBiomarkers.length, 'biomarkers');

      const summary = dedupedBiomarkers
        .map(b => `${b.name}: ${b.value} ${b.unit} (status: ${b.status}${b.referenceMin != null ? `, ref ${b.referenceMin}-${b.referenceMax}` : ''})`)
        .join('\n');

      const labAnalysisPrompt = `You are a world-class functional medicine and longevity physician.\n\nHere are the extracted biomarkers from the patient's lab panel:\n\n${summary}\n\nProvide a comprehensive functional analysis including:\n1. Big-picture summary (top priorities)\n2. Pattern recognition (mitochondrial, insulin resistance, thyroid, HPA axis, etc.)\n3. Marker-by-marker analysis for abnormal markers\n4. Functional optimal targets\n5. Root-cause action plan (diet, lifestyle, supplements, detox/gut)\n6. Longevity interpretation\n7. Patient-friendly explanation\n8. Top 3 priorities\n\nTone: clear, precise, educational, no fear-mongering.`;

      let analysisText = '';
      try {
        // The AI proxy requires at least one image; the first page gives the
        // model visual context alongside the extracted-summary prompt.
        analysisText = await callAiWithImages(labAnalysisPrompt, [dataUrls[0]], false);
      } catch (e) {
        console.log('[Labs] Final analysis failed, using fallback:', errMsg(e));
        analysisText = 'Analysis temporarily unavailable. Your biomarkers have been extracted and saved.';
      }

      const biomarkers: Biomarker[] = dedupedBiomarkers.map((b, index) => ({
        id: `bio_${Date.now()}_${index}`,
        name: b.name,
        value: b.value,
        unit: b.unit,
        referenceRange: { min: b.referenceMin ?? 0, max: b.referenceMax ?? 0 },
        functionalRange: { min: b.functionalMin ?? 0, max: b.functionalMax ?? 0 },
        status: b.status,
        date: new Date().toISOString(),
      }));

      const supplementsWithLinks: SupplementRecommendation[] = dedupedSupps.map(s => ({
        ...s,
        affiliateLink: findAffiliateLink(s.name),
      }));
      const herbsWithLinks: SupplementRecommendation[] = dedupedHerbs.map(h => ({
        ...h,
        affiliateLink: findAffiliateLink(h.name),
      }));

      const analysis: LabAnalysis = {
        id: `analysis_${Date.now()}`,
        panelId: panelId || '',
        date: new Date().toISOString(),
        summary: analysisText,
        status: 'completed',
      };

      return {
        analysis,
        biomarkers,
        supplements: supplementsWithLinks,
        herbs: herbsWithLinks,
        priorityActions: Array.from(new Set(allActions)).slice(0, 5),
      };
    },
  });

  const saveLatestAnalysis = useCallback((analysis: StoredLabAnalysis) => {
    saveLatestAnalysisMutation.mutate(analysis);
  }, [saveLatestAnalysisMutation]);

  return useMemo(() => ({
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    allBiomarkers,
    biomarkersByCategory,
    latestAnalysis,
    crossLabSynthesis,
    runCrossLabSynthesis,
    isLoading: labsQuery.isLoading,
    getBiomarkerTrend,
    addLabPanel,
    pickLabDocument,
    pickLabImages,
    createManualLabPanel,
    analyzeLab: analyzeLabMutation.mutateAsync,
    analyzeLabImages: analyzeLabImagesMutation.mutateAsync,
    isAnalyzing: analyzeLabMutation.isPending || analyzeLabImagesMutation.isPending,
    analysisError: analyzeLabMutation.error || analyzeLabImagesMutation.error,
    updateLabPanelBiomarkers,
    sendLabsWebhook,
    sendLabUploadStartedWebhook,
    saveLatestAnalysis,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    allBiomarkers,
    biomarkersByCategory,
    latestAnalysis,
    crossLabSynthesis,
    runCrossLabSynthesis,
    labsQuery.isLoading,
    getBiomarkerTrend,
    addLabPanel,
    pickLabDocument,
    pickLabImages,
    createManualLabPanel,
    analyzeLabMutation.mutateAsync,
    analyzeLabImagesMutation.mutateAsync,
    analyzeLabMutation.isPending,
    analyzeLabImagesMutation.isPending,
    analyzeLabMutation.error,
    analyzeLabImagesMutation.error,
    updateLabPanelBiomarkers,
    sendLabUploadStartedWebhook,
    saveLatestAnalysis,
  ]);
});
