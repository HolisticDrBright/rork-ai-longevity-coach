import { Platform } from 'react-native';

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? 'https://toolkit.rork.com';
const TOOLKIT_SECRET = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? '';

export async function transcribeAudio(uri: string): Promise<string> {
  console.log('[transcribeAudio] Transcribing:', uri);

  if (!TOOLKIT_SECRET) {
    throw new Error('Toolkit secret key not configured');
  }

  const form = new FormData();
  form.append('model_id', 'scribe_v2');

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, 'recording.m4a');
  } else {
    form.append('file', {
      uri,
      name: 'recording.m4a',
      type: 'audio/m4a',
    } as unknown as Blob);
  }

  const response = await fetch(`${TOOLKIT_URL}/v2/elevenlabs/v1/speech-to-text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOOLKIT_SECRET}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[transcribeAudio] Error:', response.status, errText);
    throw new Error(`Transcription failed: ${response.status}`);
  }

  const data = await response.json();
  const text: string = data.text ?? '';
  console.log('[transcribeAudio] Got transcript:', text);
  return text;
}
