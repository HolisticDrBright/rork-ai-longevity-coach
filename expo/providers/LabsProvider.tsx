import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { generateText, generateObject } from '@rork-ai/toolkit-sdk';
import { z } from 'zod';
import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordAccessPattern } from '@/lib/breachDetection';
import { sendLabsAnalyzed, sendLabUploadStarted } from '@/lib/webhooks';
import { labPanelService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import { LabPanel, Biomarker, LabAnalysis } from '@/types';
import { findAffiliateLink, AffiliateLink } from '@/constants/affiliateLinks';
import { sampleLabPanel, previousLabPanel } from '@/mocks/labs';

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

export const [LabsProvider, useLabs] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [labPanels, setLabPanels] = useState<LabPanel[]>([previousLabPanel, sampleLabPanel]);

  const labsQuery = useQuery({
    queryKey: ['labPanels'],
    queryFn: async () => {
      const stored = await secureGetJSON<LabPanel[]>(STORAGE_KEY);
      await recordAccessPattern('lab_panels', 'read');
      return stored ?? [previousLabPanel, sampleLabPanel];
    },
  });

  useEffect(() => {
    if (labsQuery.data) setLabPanels(labsQuery.data);
  }, [labsQuery.data]);

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
    mutationFn: async (params: { fileUri: string; mimeType: string; panelId?: string }): Promise<LabAnalysisResult> => {
      const { fileUri, mimeType, panelId } = params;
      console.log('[Labs] Starting lab analysis');
      
      let base64Content = '';
      
      if (Platform.OS !== 'web') {
        try {
          base64Content = await FileSystem.readAsStringAsync(fileUri, {
            encoding: 'base64',
          });
          console.log('[Labs] File read successfully');
        } catch {
          console.log('[Labs] Error reading file');
          throw new Error('Could not read the uploaded file. Please try again.');
        }
      } else {
        try {
          const response = await fetch(fileUri);
          const blob = await response.blob();
          base64Content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64 = result.split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          console.log('[Labs] Web file read successfully');
        } catch {
          console.log('[Labs] Error reading web file');
          throw new Error('Could not read the uploaded file. Please try again.');
        }
      }

      const isImage = mimeType.startsWith('image/');
      const isPdf = mimeType === 'application/pdf';
      
      if (!isImage && !isPdf) {
        throw new Error('Please upload an image or PDF file of your lab results.');
      }

      const imageDataUrl = `data:${mimeType};base64,${base64Content}`;

      const extractionPrompt = `You are analyzing a lab report image/document. Extract ALL biomarker values you can see.

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

      console.log('[Labs] Extracting biomarkers...');
      
      let extractedData = { biomarkers: [], supplements: [], herbs: [], priorityActions: [] } as z.infer<typeof labExtractionSchema>;
      let analysisText = '';
      let extractionError: string | null = null;
      
      try {
        console.log('[Labs] Starting biomarker extraction...');
        extractedData = await generateObject({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: extractionPrompt },
                { type: 'image', image: imageDataUrl },
              ],
            },
          ],
          schema: labExtractionSchema,
        });
        console.log('[Labs] Extraction complete');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log('[Labs] Extraction error occurred');
        extractionError = errorMessage;
        
        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
          console.log('[Labs] Network error detected, will try text analysis...');
        }
      }

      if (extractedData.biomarkers.length === 0 && extractionError) {
        console.log('[Labs] No biomarkers extracted and had error, throwing...');
        throw new Error('Unable to read lab results from the document. Please try uploading a clearer image or PDF.');
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

      console.log('[Labs] Generating analysis...');
      
      try {
        analysisText = await generateText({
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

  return useMemo(() => ({
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    biomarkersByCategory,
    isLoading: labsQuery.isLoading,
    getBiomarkerTrend,
    addLabPanel,
    pickLabDocument,
    createManualLabPanel,
    analyzeLab: analyzeLabMutation.mutateAsync,
    isAnalyzing: analyzeLabMutation.isPending,
    analysisError: analyzeLabMutation.error,
    updateLabPanelBiomarkers,
    sendLabsWebhook,
    sendLabUploadStartedWebhook,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    biomarkersByCategory,
    labsQuery.isLoading,
    getBiomarkerTrend,
    addLabPanel,
    pickLabDocument,
    createManualLabPanel,
    analyzeLabMutation.mutateAsync,
    analyzeLabMutation.isPending,
    analyzeLabMutation.error,
    updateLabPanelBiomarkers,
    sendLabUploadStartedWebhook,
  ]);
});
