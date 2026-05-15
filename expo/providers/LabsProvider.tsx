import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createGateway, generateText as aiGenerateText, generateObject as aiGenerateObject } from 'ai';
import { z } from 'zod';

import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordAccessPattern } from '@/lib/breachDetection';
import { sendLabsAnalyzed, sendLabUploadStarted } from '@/lib/webhooks';
import { labPanelService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';
import { analyzeLabFile, type LabAnalysisJobStatus } from '@/lib/labAnalyzerClient';

import { LabPanel, Biomarker, LabAnalysis } from '@/types';
import { findAffiliateLink, AffiliateLink } from '@/constants/affiliateLinks';

const TOOLKIT_URL = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;

const openaiGateway = createGateway({
  baseURL: `${TOOLKIT_URL}/v2/vercel/v3/ai`,
  apiKey: SECRET_KEY,
});

const OPENAI_MODEL_ID = 'openai/gpt-5-mini' as const;

// PDF parsing is handled server-side by the lab-analyzer edge function
// (AWS Textract -> OpenAI -> safety gate filtering). Image branches still
// use OpenAI vision directly via the openaiGateway above.

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

export interface StoredLabAnalysis {
  panelId?: string;
  generatedAt: string;
  supplements: SupplementRecommendation[];
  herbs: SupplementRecommendation[];
  priorityActions: string[];
  flaggedBiomarkerNames: string[];
  // Multi-paragraph clinical narrative produced by the lab-analyzer edge
  // function (big-picture summary, pattern recognition, marker analysis,
  // root-cause action plan, top-3 fixes). Persisted so the UI can show it
  // whenever the user revisits the labs tab.
  summary?: string | null;
}

export const [LabsProvider, useLabs] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [labPanels, setLabPanels] = useState<LabPanel[]>([]);
  const [latestAnalysis, setLatestAnalysis] = useState<StoredLabAnalysis | null>(null);

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

  useEffect(() => {
    if (labsQuery.data) setLabPanels(labsQuery.data);
  }, [labsQuery.data]);

  useEffect(() => {
    if (latestAnalysisQuery.data !== undefined) setLatestAnalysis(latestAnalysisQuery.data);
  }, [latestAnalysisQuery.data]);

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
        console.log('[Labs] Supabase sync failed (non-blocking):', e);
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

  // Sort by date desc, with panel id as a tiebreaker so two labs uploaded
  // the same day (date field is YYYY-MM-DD with no time component) still
  // resolve to the newer one. Panel IDs are `panel_<Date.now()>` so newer
  // IDs sort lexicographically larger.
  const sortedPanels = useMemo(() => {
    return [...labPanels].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return (b.id ?? '').localeCompare(a.id ?? '');
    });
  }, [labPanels]);

  const latestPanel = useMemo(() => {
    return sortedPanels.length > 0 ? sortedPanels[0] : null;
  }, [sortedPanels]);

  const previousPanel = useMemo(() => {
    return sortedPanels.length > 1 ? sortedPanels[1] : null;
  }, [sortedPanels]);

  // Combined biomarkers across all uploaded panels (Blood, Dutch, GI Map,
  // TruAge, Total Tox, etc.). Dedups by marker name with the most-recent
  // panel winning, so users see a unified view of every biomarker they've
  // ever measured, not just the most-recently uploaded panel.
  const allBiomarkers = useMemo<Biomarker[]>(() => {
    const byName = new Map<string, Biomarker>();
    for (const panel of sortedPanels) {
      for (const b of panel.biomarkers) {
        const key = b.name.toLowerCase().trim();
        if (!byName.has(key)) byName.set(key, b);
      }
    }
    return Array.from(byName.values());
  }, [sortedPanels]);

  // Biomarker views combine across ALL uploaded panels (no "latest panel
  // wins") so a Dutch test doesn't erase the user's blood-lab markers from
  // the UI.

  const flaggedBiomarkers = useMemo(() => {
    return allBiomarkers.filter(b =>
      b.status === 'suboptimal' || b.status === 'critical'
    );
  }, [allBiomarkers]);

  const optimalBiomarkers = useMemo(() => {
    return allBiomarkers.filter(b => b.status === 'optimal');
  }, [allBiomarkers]);

  // Trend: for a given biomarker (by id), find its current value AND the
  // most-recent prior value across ALL panels (not just latest vs previous
  // panel). This way a marker that appears in lab #1 + lab #3 still trends
  // even if lab #2 didn't measure it.
  const getBiomarkerTrend = useCallback((biomarkerId: string): 'up' | 'down' | 'stable' | null => {
    let targetName: string | null = null;
    for (const p of sortedPanels) {
      const b = p.biomarkers.find(x => x.id === biomarkerId);
      if (b) { targetName = b.name; break; }
    }
    if (!targetName) return null;

    let current: Biomarker | null = null;
    let prior: Biomarker | null = null;
    for (const p of sortedPanels) {
      const match = p.biomarkers.find(b => b.name === targetName);
      if (!match) continue;
      if (!current) current = match;
      else if (!prior) { prior = match; break; }
    }
    if (!current || !prior) return null;

    if (prior.value === 0) return null;
    const percentChange = ((current.value - prior.value) / prior.value) * 100;
    if (Math.abs(percentChange) < 5) return 'stable';
    return percentChange > 0 ? 'up' : 'down';
  }, [sortedPanels]);

  // Keyword-driven categorization that handles the diverse lab types users
  // actually upload (Dutch, GI Map, Total Tox, OMX, TruAge, etc.), not just
  // standard blood panels. Order matters: most specific buckets first.
  const biomarkersByCategory = useMemo(() => {
    const categories: Record<string, Biomarker[]> = {
      'Metabolic': [],
      'Lipids': [],
      'Thyroid': [],
      'Inflammation': [],
      'Hormones': [],
      'Gut Health': [],
      'Toxins / Heavy Metals': [],
      'Methylation': [],
      'Mitochondrial / Energy': [],
      'Biological Age': [],
      'Liver': [],
      'Kidney': [],
      'Vitamins / Minerals': [],
      'Other': [],
    };

    for (const bio of allBiomarkers) {
      const n = bio.name.toLowerCase();
      if (/(glucose|hba1c|insulin|fructosamine|homa[\s-]?ir|c[\s-]?peptide)/.test(n)) {
        categories['Metabolic'].push(bio);
      } else if (/(cholesterol|hdl|ldl|triglycer|apo[\s-]?[ab]|lipoprotein|lp\(a\))/.test(n)) {
        categories['Lipids'].push(bio);
      } else if (/(tsh|free\s*t3|free\s*t4|reverse\s*t3|thyroid|tpo|tg\s*ab)/.test(n)) {
        categories['Thyroid'].push(bio);
      } else if (/(hs[\s-]?crp|homocysteine|fibrinogen|ferritin\s*high|esr|sed\s*rate)/.test(n)) {
        categories['Inflammation'].push(bio);
      } else if (/(testosterone|dhea|estradiol|estrone|estriol|progesterone|cortisol|melatonin|prolactin|lh|fsh|shbg|androstene|pregnenolone|4[\s-]?oh|16[\s-]?oh|2[\s-]?oh)/.test(n)) {
        categories['Hormones'].push(bio);
      } else if (/(zonulin|secretory\s*iga|beta[\s-]?glucuronidase|calprotectin|h\.?\s*pylori|dysbiosis|sibo|candida|firmicutes|bacteroides|akkermansia|lactobacillus|bifido)/.test(n)) {
        categories['Gut Health'].push(bio);
      } else if (/(aflatoxin|ochratoxin|gliotoxin|trichothecene|mold|mycotoxin|mercury|lead|arsenic|cadmium|aluminum|nickel|heavy\s*metal)/.test(n)) {
        categories['Toxins / Heavy Metals'].push(bio);
      } else if (/(homocysteine|methylmalonic|mma|formate|folate|b12|cobalamin|mthfr|sam|sah)/.test(n)) {
        categories['Methylation'].push(bio);
      } else if (/(coq10|ubiquinol|carnitine|krebs|citric|succinate|alpha[\s-]?keto|malate|fumarate|fatty\s*acid|atp)/.test(n)) {
        categories['Mitochondrial / Energy'].push(bio);
      } else if (/(epigenetic|biological\s*age|truage|pace\s*of\s*aging|methylation\s*age|grim|horvath|phenoage|telomere)/.test(n)) {
        categories['Biological Age'].push(bio);
      } else if (/(ast|alt|ggt|bilirubin|alkaline\s*phosphatase|alp)/.test(n)) {
        categories['Liver'].push(bio);
      } else if (/(creatinine|bun|egfr|cystatin|urea|kidney)/.test(n)) {
        categories['Kidney'].push(bio);
      } else if (/(vitamin\s*[abcdek]|d3|d2|25[\s-]?oh|zinc|magnesium|iron|ferritin|copper|selenium|iodine|potassium|sodium|calcium|chromium|manganese|molybdenum|niacin|biotin|riboflavin|thiamine|pyridoxine)/.test(n)) {
        categories['Vitamins / Minerals'].push(bio);
      } else {
        categories['Other'].push(bio);
      }
    }

    // Drop empty buckets so the UI doesn't render headers with zero items.
    for (const key of Object.keys(categories)) {
      if (categories[key].length === 0) delete categories[key];
    }
    return categories;
  }, [allBiomarkers]);

  const addLabPanel = useCallback((panel: LabPanel) => {
    const updated = [...labPanels, panel];
    saveLabsMutation.mutate(updated);
  }, [labPanels, saveLabsMutation]);

  const pickLabImages = useCallback(async (): Promise<{ uri: string; name: string; mimeType: string }[]> => {
    try {
      if (Platform.OS === 'web') {
        return await new Promise<{ uri: string; name: string; mimeType: string }[]>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.style.display = 'none';
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
            document.body.removeChild(input);
            resolve(results);
          };
          input.oncancel = () => {
            try { document.body.removeChild(input); } catch { }
            resolve([]);
          };
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
      console.log('[Labs] Error picking images:', e);
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
        if (Platform.OS !== 'web') {
          try {
            base64Content = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
          } catch {
            throw new Error('Could not read the uploaded file. Please try again.');
          }
        } else {
          try {
            const response = await fetch(fileUri);
            const blob = await response.blob();
            base64Content = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch {
            throw new Error('Could not read the uploaded file. Please try again.');
          }
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

      if (isPdf) {
        // PDF path: server-side pipeline (Storage -> AWS Textract -> OpenAI ->
        // safety-gate filtering). The edge function writes the result back
        // to lab_analysis_jobs; the client polls until done.
        console.log('[Labs] PDF detected — invoking lab-analyzer edge function');
        try {
          const result = await analyzeLabFile({
            fileUri,
            fileName: fileName ?? 'lab-results.pdf',
            mimeType: 'application/pdf',
            onProgress: (status: LabAnalysisJobStatus) =>
              console.log('[Labs] lab-analyzer status:', status),
          });

          if (result.biomarkers.length === 0) {
            throw new Error(
              "We couldn't extract biomarkers from this PDF. The file may be a scan without selectable text — try uploading a digital PDF or screenshots of the results pages."
            );
          }

          const biomarkers: Biomarker[] = result.biomarkers.map((b, index) => ({
            id: `bio_${Date.now()}_${index}`,
            name: b.name,
            value: b.value,
            unit: b.unit,
            referenceRange: { min: b.referenceMin ?? 0, max: b.referenceMax ?? 0 },
            functionalRange: { min: b.functionalMin ?? 0, max: b.functionalMax ?? 0 },
            status: b.status,
            date: new Date().toISOString(),
          }));
          const supplementsWithLinks: SupplementRecommendation[] = result.supplements.map(supp => ({
            ...supp,
            affiliateLink: findAffiliateLink(supp.name),
          }));
          const herbsWithLinks: SupplementRecommendation[] = result.herbs.map(herb => ({
            ...herb,
            affiliateLink: findAffiliateLink(herb.name),
          }));
          const analysis: LabAnalysis = {
            id: `analysis_${Date.now()}`,
            panelId: panelId || '',
            date: new Date().toISOString(),
            summary: result.analysisText,
            status: 'completed',
          };
          return {
            analysis,
            biomarkers,
            supplements: supplementsWithLinks,
            herbs: herbsWithLinks,
            priorityActions: result.priorityActions,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('[Labs] lab-analyzer failed:', msg);
          // Surface server-side error messages directly so the user sees the
          // real reason (e.g. "Textract extracted no text" -> bad scan).
          if (msg.includes('Textract') || msg.includes('biomarker') || msg.includes('scan')) {
            throw new Error(msg);
          }
          throw new Error(
            'Failed to analyze this PDF. Please try again or upload screenshots of the results pages.'
          );
        }
      }

      // Image path — send directly to OpenAI vision
      const imageDataUrl = `data:${mimeType};base64,${base64Content}`;

      console.log('[Labs] Extracting biomarkers from image via OpenAI gpt-5-mini...');

      try {
        const { object } = await aiGenerateObject({
          model: openaiGateway(OPENAI_MODEL_ID),
          schema: labExtractionSchema,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: extractionPrompt },
                { type: 'image', image: imageDataUrl },
              ],
            },
          ],
        });
        extractedData = object;
        console.log('[Labs] Image extraction complete');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log('[Labs] Extraction error occurred:', errorMessage);
        extractionError = errorMessage;
      }

      if (extractedData.biomarkers.length === 0 && extractionError) {
        console.log('[Labs] No biomarkers extracted and had error, throwing...');
        throw new Error('Unable to read lab results from the document. Please try uploading a clearer image or PDF.');
      }

      let analysisText = '';


      const labAnalysisPrompt = `🧬 FUNCTIONAL / LONGEVITY LAB INTERPRETATION MASTER PROMPT

You are a world-class functional medicine, longevity, and systems-biology physician.

Analyze the lab results shown in this image using a root-cause, pattern-recognition, and longevity-optimization framework.

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

      console.log('[Labs] Generating analysis via OpenAI gpt-5-mini...');

      try {
        const { text } = await aiGenerateText({
          model: openaiGateway(OPENAI_MODEL_ID),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: labAnalysisPrompt },
                { type: 'image', image: imageDataUrl },
              ],
            },
          ],
        });
        analysisText = text;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
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
        if (Platform.OS !== 'web') {
          const b64 = await FileSystem.readAsStringAsync(img.uri, { encoding: 'base64' });
          return `data:${img.mimeType};base64,${b64}`;
        }
        const response = await fetch(img.uri);
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      const dataUrls: string[] = [];
      for (const img of images) {
        try {
          dataUrls.push(await readImage(img));
        } catch (e) {
          console.log('[Labs] Failed to read image:', e);
        }
      }
      if (dataUrls.length === 0) throw new Error('Could not read any of the uploaded images.');

      const extractionPrompt = `You are analyzing pages from a lab report for a functional medicine practice. Extract ALL biomarker values you can find across the pages.\n\nFor each biomarker found, provide:\n- name: The biomarker name (e.g., "Fasting Glucose", "TSH", "Vitamin D")\n- value: The numeric value\n- unit: The unit of measurement\n- referenceMin/referenceMax: The lab's reference range\n- functionalMin/functionalMax: The optimal functional medicine range\n- status: "optimal", "normal", "suboptimal", or "critical"\n\nIMPORTANT — When recommending supplements, PRIORITIZE these specific products:\n- ProOmega 2000 (Nordic Naturals) — for omega-3, cardiovascular\n- GlucoPrime (Healthgevity) — for blood sugar, insulin resistance\n- Protect+ 10 (Healthgevity) — foundational multi\n- Liver Sauce (Quicksilver Scientific) — liver support, detox\n- Liposomal Glutathione (Quicksilver Scientific) — glutathione, oxidative stress\n- MitoCore (Orthomolecular) — mitochondrial support, energy\n- NAC 900+ (Healthgevity) — liver, glutathione precursor\n- Gut Shield (Healthgevity) — gut repair\n- ProBiota HistaminX (Seeking Health) — probiotics, histamine\n- Sleep Deep (Healthgevity) — sleep support\n- Magnesium Glycinate 300 (Healthgevity) — magnesium\n- Methyl B Complex (Healthgevity) — B vitamins, methylation\n- D3+K2 5000 (Healthgevity) — vitamin D\n- Adrenal Restore (Healthgevity) — adrenal, cortisol\n\nUse exact product name and brand when the condition matches. Base ALL recommendations on actual biomarker values.\n\nAlso provide:\n- herbs: Recommended herbs with dose, timing, reason, mechanism\n- priorityActions: Top 3-5 priority actions\n\nDeduplicate biomarkers across pages. Be thorough.`;

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
          const { object } = await aiGenerateObject({
            model: openaiGateway(OPENAI_MODEL_ID),
            schema: labExtractionSchema,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: extractionPrompt },
                  ...batch.map((url) => ({ type: 'image' as const, image: url })),
                ],
              },
            ],
          });
          allBiomarkers.push(...object.biomarkers);
          allSupps.push(...object.supplements);
          allHerbs.push(...object.herbs);
          allActions.push(...object.priorityActions);
        } catch (e) {
          console.log('[Labs] Batch failed:', e);
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
        const { text } = await aiGenerateText({
          model: openaiGateway(OPENAI_MODEL_ID),
          messages: [{ role: 'user', content: [{ type: 'text', text: labAnalysisPrompt }] }],
        });
        analysisText = text;
      } catch (e) {
        console.log('[Labs] Final analysis failed, using fallback');
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

  // Cross-lab synthesis: invokes the cross-lab-synthesis edge function which
  // groups all of the user's lab_markers by panel, asks an LLM to spot
  // cross-test patterns (HPA dysregulation, gut-systemic inflammation, etc.),
  // and returns patterns + narrative. Persisted to lab_synthesis_results so
  // the client hydrates from DB on app load instead of re-running OpenAI.
  type SynthesisPanelSummary = {
    jobId: string;
    fileName: string;
    panelType: string;
    collectedAt: string;
    markerCount?: number;
  };
  type CrossLabSynthesis = {
    id: string | null;
    patterns: string[];
    narrative: string;
    panelCount: number;
    panels: SynthesisPanelSummary[];
    generatedAt: string;
    modelUsed: string | null;
  };

  const synthesisHistoryQuery = useQuery({
    queryKey: ['crossLabSynthesisHistory'],
    queryFn: async (): Promise<CrossLabSynthesis[]> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [];
      const { data, error } = await supabase
        .from('lab_synthesis_results')
        .select('id, generated_at, panel_count, panels_summary_json, patterns_json, narrative, model_used')
        .eq('user_id', session.user.id)
        .order('generated_at', { ascending: false })
        .limit(20);
      if (error) {
        console.log('[Labs] synthesis history query failed:', error.message);
        return [];
      }
      return ((data as Array<{ id: string; generated_at: string; panel_count: number; panels_summary_json: SynthesisPanelSummary[] | null; patterns_json: string[] | null; narrative: string | null; model_used: string | null }>) ?? [])
        .map(row => ({
          id: row.id,
          patterns: row.patterns_json ?? [],
          narrative: row.narrative ?? '',
          panelCount: row.panel_count ?? 0,
          panels: row.panels_summary_json ?? [],
          generatedAt: row.generated_at,
          modelUsed: row.model_used,
        }));
    },
    staleTime: 60_000,
  });

  const crossLabSynthesis = useMemo<CrossLabSynthesis | null>(() => {
    return synthesisHistoryQuery.data && synthesisHistoryQuery.data.length > 0
      ? synthesisHistoryQuery.data[0]
      : null;
  }, [synthesisHistoryQuery.data]);

  const crossLabSynthesisHistory = useMemo<CrossLabSynthesis[]>(() => {
    return synthesisHistoryQuery.data ?? [];
  }, [synthesisHistoryQuery.data]);

  const [isRunningCrossLabSynthesis, setIsRunningCrossLabSynthesis] = useState(false);

  // True when the most-recent persisted synthesis was generated against fewer
  // panels than the user currently has uploaded. UI uses this to nudge "you've
  // uploaded new labs since the last analysis — run again to refresh".
  const isCrossLabSynthesisStale = useMemo(() => {
    if (!crossLabSynthesis) return labPanels.length >= 2;
    return labPanels.length > crossLabSynthesis.panelCount;
  }, [crossLabSynthesis, labPanels.length]);

  const runCrossLabSynthesis = useCallback(async (): Promise<void> => {
    console.log('[Labs] Invoking cross-lab-synthesis edge function');
    setIsRunningCrossLabSynthesis(true);
    try {
      const { data, error } = await supabase.functions.invoke('cross-lab-synthesis', { body: {} });
      if (error) {
        console.log('[Labs] cross-lab-synthesis invoke error:', error.message);
        return;
      }
      const result = data as { status?: string } | null;
      if (!result || result.status !== 'ok') {
        console.log('[Labs] cross-lab-synthesis returned non-ok status:', result?.status);
        return;
      }
      // The edge function persists to lab_synthesis_results. Invalidate so the
      // history query re-fetches and picks up the new row.
      await queryClient.invalidateQueries({ queryKey: ['crossLabSynthesisHistory'] });
    } catch (e) {
      console.log('[Labs] cross-lab-synthesis call failed:', e);
    } finally {
      setIsRunningCrossLabSynthesis(false);
    }
  }, [queryClient]);

  return useMemo(() => ({
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    allBiomarkers,
    crossLabSynthesis,
    crossLabSynthesisHistory,
    isCrossLabSynthesisStale,
    isRunningCrossLabSynthesis,
    runCrossLabSynthesis,
    biomarkersByCategory,
    latestAnalysis,
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
    crossLabSynthesis,
    crossLabSynthesisHistory,
    isCrossLabSynthesisStale,
    isRunningCrossLabSynthesis,
    runCrossLabSynthesis,
    biomarkersByCategory,
    latestAnalysis,
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
