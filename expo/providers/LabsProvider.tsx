import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { generateText, generateObject } from '@rork-ai/toolkit-sdk';
import { createGateway, generateText as aiGenerateText, generateObject as aiGenerateObject } from 'ai';
import { z } from 'zod';
import axios from "axios";

const TOOLKIT_URL = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
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

    console.log('[Labs] Reading file for upload (mobile)...', fileUri,fileName);
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
    console.log('[Labs] OpenAI upload response:', result.body);
    const json = JSON.parse(result.body) as { id: string };
    console.log('[Labs] OpenAI file uploaded, id:', json.id);
    return json.id;
    // const formData = new FormData();

    // formData.append('file', {
    //   uri: fileUri,
    //   name: 'file.pdf',
    //   type: 'application/pdf',
    // });

    // formData.append('purpose', 'user_data');

    // const response = await fetch('https://api.openai.com/v1/files', {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Bearer ${OPENAI_API_KEY}`,
    //     // 'Content-Type': 'multipart/form-data',
    //   },
    //   body: formData,
    // });

    // const result = await response.json();

    // if (!response.ok) {
    //   console.log('Upload failed:', result);
    //   throw new Error('Upload failed');
    // }

    // console.log('Uploaded file ID:', result.id);
    // return result.id;

    // try {

    //   const info = await FileSystem.getInfoAsync(fileUri);
    //   console.log("✅ File exists. Size:", info.exists, "bytes");
    //   // STEP 1: Convert file → blob (CRITICAL FIX)


    //   // STEP 2: Create form data

    //   console.log(fileUri)
    //   const formdata = new FormData();
    //   formdata.append('file', {
    //     uri: fileUri,
    //     name: 'file.pdf',
    //     type: 'application/pdf',
    //   });


    //   formdata.append("purpose", "user_data");

    //   // STEP 3: Upload
    //   const response = await fetch("https://api.openai.com/v1/files", {
    //     method: "POST",
    //     headers: {
          
    //       Authorization: `Bearer ${OPENAI_API_KEY}`,
    //       "Content-Type": 'multipart/form-data',
    //     },
    //     body: formdata,
    //   });

    //   const result = await response.json();

    //   if (!response.ok) {
    //     console.log("Upload failed:", result);
    //     throw new Error("Upload failed");
    //   }

    //   console.log("Uploaded file ID:", result.id);
    //   return result.id;
    // } catch (err) {
    //   console.log("ERROR:", err);
    //   console.log("❌ UPLOAD FAILED FULL ERROR:");
    //   console.log("Message:", err?.message);
    //   console.log("Stack:", err?.stack);
    //   console.log("Raw:", err);
    //   throw err;
    // }



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

// async function callOpenAIWithFile(fileId: string, prompt: string, expectJson: boolean): Promise<string> {
//   if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');
//   const body: Record<string, unknown> = {
//     model: OPENAI_DIRECT_MODEL,
//     messages: [
//       {
//         role: 'user',
//         content: [
//           { type: 'file', file: { file_id: fileId } },
//           { type: 'text', text: prompt },
//         ],
//       },
//     ],
//   };
//   if (expectJson) {
//     body.response_format = { type: 'json_object' };
//   }
//   const res = await fetch('https://api.openai.com/v1/chat/completions', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${OPENAI_API_KEY}`,
//     },
//     body: JSON.stringify(body),
//   });
//   if (!res.ok) {
//     const t = await res.text();
//     console.log('[Labs] OpenAI chat call failed:', res.status, t);
//     throw new Error(`OpenAI request failed (${res.status}).`);
//   }
//   const json = (await res.json()) as { choices: { message: { content: string } }[] };
//   return json.choices[0]?.message?.content ?? '';
// }

// async function callOpenAIWithFile(fileId: string, prompt: string) {
//   const res = await fetch('https://api.openai.com/v1/responses', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${OPENAI_API_KEY}`,
//     },
//     body: JSON.stringify({
//       model: 'gpt-4.1',
//       input: [
//         {
//           role: 'user',
//           content: [
//             { type: 'input_file', file_id: fileId },
//             { type: 'input_text', text: prompt },
//           ],
//         },
//       ],
//     }),
//   });

//   const json = await res.json();

//   if (!res.ok) {
//     throw new Error(json.error?.message || 'OpenAI request failed');
//   }

//   return json.output?.[0]?.content?.[0]?.text ?? '';
// }

// async function callOpenAIWithFile(fileId: string, prompt: string, expectJson: boolean): Promise<string> {
//   const body: Record<string, unknown> = {
//     model: OPENAI_DIRECT_MODEL,
//     messages: [
//       {
//         role: "user",
//         content: `File ID: ${fileId}\n\n${prompt}`

//       }
//     ],
//   };

//   if (expectJson) {
//     body.response_format = { type: "json_object" };
//   }

//   const res = await fetch("https://api.openai.com/v1/chat/completions", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${OPENAI_API_KEY}`,
//     },
//     body: JSON.stringify(body),
//   });

//   if (!res.ok) {
//     const t = await res.text();
//     console.log("[Labs] OpenAI chat call failed:", res.status, t);
//     throw new Error(`OpenAI request failed (${res.status}).`);
//   }

//   const json = await res.json();
//   return json.choices?.[0]?.message?.content ?? "";
// }

async function callOpenAIWithFile(fileId: string, prompt: string, expectJson: boolean): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');
  const body: Record<string, unknown> = {
    model: OPENAI_DIRECT_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a meticulous medical data extractor. When reading lab PDFs you transcribe numbers VERBATIM from the document. Never round, never infer, never substitute. If a value is unclear, omit it rather than guess. Match each numeric value to the row label and unit it appears on in the PDF.',
      },
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

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
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
import { trpcClient } from '@/lib/trpc';

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

interface ServerExtractionResult {
  duplicate: false;
  documentId: string;
  reportDate: string | null | undefined;
  biomarkers: {
    name: string;
    value: number;
    unit: string;
    referenceMin?: number | null;
    referenceMax?: number | null;
    functionalMin?: number | null;
    functionalMax?: number | null;
    status: 'optimal' | 'normal' | 'suboptimal' | 'critical';
  }[];
  analysisText: string;
  supplements: { name: string; dose: string; timing: string; reason: string; mechanism: string }[];
  herbs: { name: string; dose: string; timing: string; reason: string; mechanism: string }[];
  priorityActions: string[];
  pipelineRan: boolean;
}

/** Maps the server-routed extraction (PHI-safe path) to the client result shape. */
function mapServerLabResult(result: ServerExtractionResult, panelId?: string): LabAnalysisResult {
  // Observation date = the report's collection date, NOT the upload date.
  const observedAt = result.reportDate
    ? new Date(result.reportDate.length === 10 ? `${result.reportDate}T12:00:00Z` : result.reportDate).toISOString()
    : new Date().toISOString();
  return {
    analysis: {
      id: `analysis_${Date.now()}`,
      panelId: panelId || '',
      date: new Date().toISOString(),
      summary: result.analysisText,
      status: 'completed',
    },
    biomarkers: result.biomarkers.map((b, index) => ({
      id: `bio_${Date.now()}_${index}`,
      name: b.name,
      value: b.value,
      unit: b.unit,
      referenceRange: { min: b.referenceMin ?? 0, max: b.referenceMax ?? 0 },
      functionalRange: { min: b.functionalMin ?? 0, max: b.functionalMax ?? 0 },
      status: b.status,
      date: observedAt,
    })),
    supplements: result.supplements.map((s) => ({ ...s, affiliateLink: findAffiliateLink(s.name) })),
    herbs: result.herbs.map((h) => ({ ...h, affiliateLink: findAffiliateLink(h.name) })),
    priorityActions: result.priorityActions,
  };
}

const DUPLICATE_LAB_MESSAGE = 'This lab report appears to be a duplicate of one already uploaded, so it was not imported again.';

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

export interface CrossLabSynthesis {
  patterns: string[];
  narrative: string;
  panelCount: number;
  generatedAt: string;
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

  useEffect(() => {
    if (labsQuery.data) setLabPanels(labsQuery.data);
  }, [labsQuery.data]);

  useEffect(() => {
    if (latestAnalysisQuery.data !== undefined) setLatestAnalysis(latestAnalysisQuery.data);
  }, [latestAnalysisQuery.data]);

  const crossLabSynthesisQuery = useQuery({
    queryKey: ['crossLabSynthesis'],
    queryFn: async () => {
      const stored = await secureGetJSON<CrossLabSynthesis>(CROSS_LAB_SYNTHESIS_KEY);
      return stored ?? null;
    },
  });

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

  // Unique biomarkers across ALL panels — the most recent value per marker name wins.
  const allBiomarkers = useMemo(() => {
    const byName = new Map<string, Biomarker>();
    const sortedPanels = [...labPanels].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    for (const panel of sortedPanels) {
      for (const bio of panel.biomarkers) {
        byName.set(bio.name.toLowerCase().trim(), bio);
      }
    }
    return Array.from(byName.values());
  }, [labPanels]);

  // Deterministic cross-panel pattern detection (rule-based, no AI call).
  const runCrossLabSynthesis = useCallback(async (): Promise<CrossLabSynthesis> => {
    const sortedPanels = [...labPanels].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const series = new Map<string, { panelDate: string; bio: Biomarker }[]>();
    for (const panel of sortedPanels) {
      for (const bio of panel.biomarkers) {
        const key = bio.name.toLowerCase().trim();
        const list = series.get(key) ?? [];
        list.push({ panelDate: panel.date, bio });
        series.set(key, list);
      }
    }

    const patterns: string[] = [];
    let persistentCount = 0;
    let shiftCount = 0;

    for (const points of series.values()) {
      const name = points[points.length - 1].bio.name;
      const flaggedPoints = points.filter(
        (p) => p.bio.status === 'suboptimal' || p.bio.status === 'critical'
      );
      if (flaggedPoints.length >= 2) {
        persistentCount += 1;
        patterns.push(
          `${name} has stayed outside the optimal range across ${flaggedPoints.length} panels — a persistent finding, not a one-off.`
        );
        continue;
      }
      if (points.length >= 2) {
        const first = points[0].bio.value;
        const last = points[points.length - 1].bio.value;
        if (first !== 0 && Number.isFinite(first) && Number.isFinite(last)) {
          const pct = ((last - first) / Math.abs(first)) * 100;
          if (Math.abs(pct) >= 15) {
            shiftCount += 1;
            patterns.push(
              `${name} ${pct > 0 ? 'increased' : 'decreased'} ${Math.abs(Math.round(pct))}% between ${new Date(points[0].panelDate).toLocaleDateString()} and ${new Date(points[points.length - 1].panelDate).toLocaleDateString()}.`
            );
          }
        }
      }
    }

    const latestFlagged = allBiomarkers.filter(
      (b) => b.status === 'suboptimal' || b.status === 'critical'
    );
    if (latestFlagged.length >= 3) {
      patterns.unshift(
        `${latestFlagged.length} markers are currently outside optimal range: ${latestFlagged.slice(0, 5).map((b) => b.name).join(', ')}${latestFlagged.length > 5 ? '…' : ''}.`
      );
    }

    const synthesis: CrossLabSynthesis = {
      patterns: patterns.slice(0, 8),
      narrative:
        patterns.length === 0
          ? 'No recurring cross-lab patterns detected yet. Patterns emerge as more panels accumulate.'
          : `Rule-based comparison of ${sortedPanels.length} panels found ${persistentCount} persistent finding(s) and ${shiftCount} meaningful shift(s). These are observations for review — not diagnoses.`,
      panelCount: sortedPanels.length,
      generatedAt: new Date().toISOString(),
    };

    await secureSetJSON(CROSS_LAB_SYNTHESIS_KEY, synthesis);
    setCrossLabSynthesis(synthesis);
    void queryClient.invalidateQueries({ queryKey: ['crossLabSynthesis'] });
    return synthesis;
  }, [labPanels, allBiomarkers, queryClient]);

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

      const readAsBase64 = async (): Promise<string> => {
        if (Platform.OS !== 'web') {
          try {
            return await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
          } catch {
            throw new Error('Could not read the uploaded file. Please try again.');
          }
        }
        try {
          const response = await fetch(fileUri);
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
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
      };

      // Server-routed extraction (PHI-safe): used whenever the org configured it.
      // Deliberately no client-side fallback after a server attempt fails —
      // once an org routes PHI through the server, we never re-route to
      // client-held keys (ADR 0002).
      const serverCaps = await trpcClient.labs.capabilities.query().catch(() => null);
      if (serverCaps?.serverAiConfigured) {
        console.log('[Labs] Using server-side extraction');
        const b64 = await readAsBase64();
        const serverResult = await trpcClient.labs.extract.mutate({
          files: [
            {
              base64: b64,
              mimeType: (isPdf ? 'application/pdf' : mimeType === 'image/png' ? 'image/png' : mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg') as 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp',
              fileName: fileName ?? (isPdf ? 'lab-results.pdf' : 'lab-results.jpg'),
            },
          ],
        });
        if (serverResult.duplicate) {
          throw new Error(DUPLICATE_LAB_MESSAGE);
        }
        return mapServerLabResult(serverResult as ServerExtractionResult, panelId);
      }

      let base64Content = '';
      if (isImage) {
        base64Content = await readAsBase64();
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

      let openaiFileId: string | null = null;

      if (isPdf) {
        console.log('[Labs] PDF detected — uploading directly to OpenAI Files API');
        try {
          openaiFileId = await uploadPdfToOpenAI(fileUri, fileName ?? 'lab-results.pdf');
        } catch (uploadErr) {
          console.log(uploadErr)
          const msg = uploadErr instanceof Error ? uploadErr.message : '';
          console.log('[Labs] OpenAI PDF upload failed:', msg);
          throw new Error(
            'Could not upload this PDF for analysis. Please check your connection and try again.'
          );
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

          const verbatimJson = await callOpenAIWithFile(openaiFileId, verbatimExtractionPrompt, true);
          console.log('[Labs] Verbatim extraction raw:', verbatimJson.slice(0, 500));
          const verbatimParsed = JSON.parse(verbatimJson) as {
            biomarkers?: { name: string; value: number; unit: string; referenceMin: number | null; referenceMax: number | null }[];
          };
          const verbatimBiomarkers = (verbatimParsed.biomarkers ?? []).filter(
            (b) => typeof b?.value === 'number' && Number.isFinite(b.value) && typeof b?.name === 'string' && b.name.trim().length > 0
          );

          if (verbatimBiomarkers.length === 0) {
            throw new Error('PDF_UNREADABLE');
          }

          // PASS 2 — enrich the verbatim values with functional ranges, status, supplements, herbs.
          // The model MUST NOT change the numeric values or reference ranges from pass 1.
          const enrichmentPrompt = `${extractionPrompt}

The biomarker values below were transcribed VERBATIM from the patient's lab PDF. You MUST preserve every value, unit, and reference range EXACTLY as given. Do not change, round, or replace any number. Only add functionalMin, functionalMax, and status — and produce the supplements / herbs / priorityActions arrays based on these values.

VERBATIM BIOMARKERS (do not modify):
${JSON.stringify(verbatimBiomarkers, null, 2)}

Return ONLY valid JSON with this exact shape:
{
  "biomarkers": [{"name": string, "value": number, "unit": string, "referenceMin": number|null, "referenceMax": number|null, "functionalMin": number|null, "functionalMax": number|null, "status": "optimal"|"normal"|"suboptimal"|"critical"}],
  "supplements": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "herbs": [{"name": string, "dose": string, "timing": string, "reason": string, "mechanism": string}],
  "priorityActions": [string]
}

The "biomarkers" array MUST contain exactly the same entries (same name/value/unit/referenceMin/referenceMax) as the verbatim list above, in the same order, only with functionalMin/functionalMax/status added.`;

          const jsonText = await callOpenAIWithFile(openaiFileId, enrichmentPrompt, true);
          console.log('[Labs] Enrichment raw length:', jsonText.length);
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

      // Server-routed extraction (PHI-safe): used whenever the org configured it.
      const serverCaps = await trpcClient.labs.capabilities.query().catch(() => null);
      if (serverCaps?.serverAiConfigured) {
        onProgress?.('Analyzing on secure server...');
        console.log('[Labs] Using server-side extraction for', dataUrls.length, 'images');
        const files = dataUrls.slice(0, 8).map((url, i) => {
          const [head, b64] = url.split(',');
          const rawMime = head.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
          const mime = rawMime === 'image/png' ? 'image/png' : rawMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
          return {
            base64: b64,
            mimeType: mime as 'image/png' | 'image/jpeg' | 'image/webp',
            fileName: `page-${i + 1}`,
          };
        });
        const serverResult = await trpcClient.labs.extract.mutate({ files });
        if (serverResult.duplicate) {
          throw new Error(DUPLICATE_LAB_MESSAGE);
        }
        return mapServerLabResult(serverResult as ServerExtractionResult, panelId);
      }

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

  return useMemo(() => ({
    labPanels,
    latestPanel,
    previousPanel,
    flaggedBiomarkers,
    optimalBiomarkers,
    allBiomarkers,
    crossLabSynthesis,
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
