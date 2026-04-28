import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { generateText, generateObject } from '@rork-ai/toolkit-sdk';
import { createGateway, generateText as aiGenerateText, generateObject as aiGenerateObject } from 'ai';
import { z } from 'zod';

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

const openaiGateway = createGateway({
  baseURL: `${TOOLKIT_URL}/v2/vercel/v3/ai`,
  apiKey: SECRET_KEY,
});

const OPENAI_MODEL_ID = 'openai/gpt-5-mini' as const;
const OPENAI_DIRECT_MODEL = 'gpt-4.1' as const;

async function uploadPdfToOpenAI(fileUri: string, fileName: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');
  console.log('[Labs] Uploading PDF to OpenAI Files API:', fileName);

  if (Platform.OS !== 'web') {
    const result = await FileSystem.uploadAsync('https://api.openai.com/v1/files', fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'application/pdf',
      parameters: { purpose: 'user_data' },
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    if (result.status < 200 || result.status >= 300) {
      console.log('[Labs] OpenAI upload failed:', result.status, result.body);
      throw new Error(`OpenAI file upload failed (${result.status}).`);
    }
    const json = JSON.parse(result.body) as { id: string };
    console.log('[Labs] OpenAI file uploaded, id:', json.id);
    return json.id;
  }

  const response = await fetch(fileUri);
  const blob = await response.blob();
  const formData = new FormData();
  formData.append('file', new File([blob], fileName, { type: 'application/pdf' }));
  formData.append('purpose', 'user_data');
  const res = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) {
    const t = await res.text();
    console.log('[Labs] OpenAI web upload failed:', res.status, t);
    throw new Error(`OpenAI file upload failed (${res.status}).`);
  }
  const json = (await res.json()) as { id: string };
  console.log('[Labs] OpenAI file uploaded (web), id:', json.id);
  return json.id;
}

async function callOpenAIWithFile(fileId: string, prompt: string, expectJson: boolean): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');
  const body: Record<string, unknown> = {
    model: OPENAI_DIRECT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', file: { file_id: fileId } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
  if (expectJson) {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    console.log('[Labs] OpenAI chat call failed:', res.status, t);
    throw new Error(`OpenAI request failed (${res.status}).`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? '';
}

async function deleteOpenAIFile(fileId: string): Promise<void> {
  if (!OPENAI_API_KEY) return;
  try {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    console.log('[Labs] Cleaned up OpenAI file:', fileId);
  } catch (e) {
    console.log('[Labs] Cleanup of OpenAI file failed (non-blocking):', e);
  }
}
void generateText;
void generateObject;
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

export interface StoredLabAnalysis {
  panelId?: string;
  generatedAt: string;
  supplements: SupplementRecommendation[];
  herbs: SupplementRecommendation[];
  priorityActions: string[];
  flaggedBiomarkerNames: string[];
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
            try { document.body.removeChild(input); } catch {}
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

      const extractionPrompt = `You are analyzing a lab report. Extract ALL biomarker values you can find.

For each biomarker found, provide:
- name: The biomarker name (e.g., "Fasting Glucose", "TSH", "Vitamin D")
- value: The numeric value
- unit: The unit of measurement
- referenceMin/referenceMax: The lab's reference range
- functionalMin/functionalMax: The optimal functional medicine range
- status: "optimal" (within functional range), "normal" (within reference but not optimal), "suboptimal" (slightly outside), or "critical" (significantly outside)

Also provide:
- supplements: Recommended supplements with dose, timing, reason, and mechanism
- herbs: Recommended herbs/botanicals with dose, timing, reason, and mechanism
- priorityActions: Top 3-5 priority actions to take

Be thorough and extract every biomarker visible in the document.`;

      let openaiFileId: string | null = null;

      if (isPdf) {
        console.log('[Labs] PDF detected — uploading directly to OpenAI Files API');
        try {
          openaiFileId = await uploadPdfToOpenAI(fileUri, fileName ?? 'lab-results.pdf');
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : '';
          console.log('[Labs] OpenAI PDF upload failed:', msg);
          throw new Error(
            'Could not upload this PDF for analysis. Please check your connection and try again.'
          );
        }

        try {
          const jsonText = await callOpenAIWithFile(
            openaiFileId,
            `${extractionPrompt}\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "biomarkers": [{"name": string, "value": number, "unit": string, "referenceMin": number|null, "referenceMax": number|null, "functionalMin": number|null, "functionalMax": number|null, "status": "optimal"|"normal"|"suboptimal"|"critical"}],\n  "supplements": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],\n  "herbs": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],\n  "priorityActions": [string]\n}`,
            true
          );
          const parsed = JSON.parse(jsonText) as unknown;
          extractedData = labExtractionSchema.parse(parsed);
          console.log('[Labs] OpenAI direct PDF extraction complete:', extractedData.biomarkers.length, 'biomarkers');

          if (extractedData.biomarkers.length === 0) {
            throw new Error('PDF_UNREADABLE');
          }
        } catch (pdfError) {
          const msg = pdfError instanceof Error ? pdfError.message : '';
          if (openaiFileId) void deleteOpenAIFile(openaiFileId);
          if (msg === 'PDF_UNREADABLE') {
            throw new Error(
              'We couldn\'t extract biomarkers from this PDF. The file may be a scan without selectable text — try uploading a digital PDF or screenshots of the results pages.'
            );
          }
          console.log('[Labs] OpenAI direct PDF extraction failed:', msg);
          throw new Error(
            'Failed to analyze this PDF. Please try again or upload screenshots of the results pages.'
          );
        }
      } else {
        // Image file — send directly to OpenAI vision
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
      }

      if (extractedData.biomarkers.length === 0 && extractionError) {
        console.log('[Labs] No biomarkers extracted and had error, throwing...');
        throw new Error('Unable to read lab results from the document. Please try uploading a clearer image or PDF.');
      }

      let analysisText = '';

      if (isPdf && openaiFileId) {
        console.log('[Labs] Generating analysis from PDF via OpenAI direct API...');
        try {
          analysisText = await callOpenAIWithFile(openaiFileId, labAnalysisPrompt, false);
        } catch (e) {
          console.log('[Labs] PDF analysis generation failed:', e);
          analysisText = 'Analysis temporarily unavailable. Your biomarkers have been extracted and saved.';
        }
        void deleteOpenAIFile(openaiFileId);
        openaiFileId = null;

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

      const imageDataUrl = `data:${mimeType};base64,${base64Content}`;

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

      const extractionPrompt = `You are analyzing pages from a lab report. Extract ALL biomarker values you can find across the pages.\n\nFor each biomarker found, provide:\n- name: The biomarker name (e.g., "Fasting Glucose", "TSH", "Vitamin D")\n- value: The numeric value\n- unit: The unit of measurement\n- referenceMin/referenceMax: The lab's reference range\n- functionalMin/functionalMax: The optimal functional medicine range\n- status: "optimal", "normal", "suboptimal", or "critical"\n\nAlso provide:\n- supplements: Recommended supplements with dose, timing, reason, mechanism\n- herbs: Recommended herbs with dose, timing, reason, mechanism\n- priorityActions: Top 3-5 priority actions\n\nDeduplicate biomarkers across pages. Be thorough.`;

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

  return useMemo(() => ({
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
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
