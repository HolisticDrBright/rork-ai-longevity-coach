import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { trpcClient } from '@/lib/trpc';

/**
 * Transcribe a voice memo via the authenticated server-side AI proxy
 * (backend/trpc/routes/ai.ts). No API keys ship in the client bundle and
 * the transcript (PHI) is never logged.
 */
export async function transcribeAudio(uri: string): Promise<string> {
  const startedAt = Date.now();

  try {
    const fileName = uri.split('/').pop() || 'recording.m4a';

    let base64: string;
    let mimeType: string;

    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      mimeType = blob.type || 'audio/mp4';
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? '');
        };
        reader.onerror = () => reject(new Error('Could not read audio file.'));
        reader.readAsDataURL(blob);
      });
    } else {
      mimeType = 'audio/mp4';
      base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    }

    const { text } = await trpcClient.ai.transcribeAudio.mutate({
      base64,
      mimeType,
      fileName,
    });

    console.log(`[transcribeAudio] Success in ${Date.now() - startedAt}ms`);
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.log(`[transcribeAudio] Failed after ${Date.now() - startedAt}ms: ${message}`);
    throw error;
  }
}
