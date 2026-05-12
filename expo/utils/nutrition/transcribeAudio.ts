import { Platform } from 'react-native';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

export async function transcribeAudio(uri: string): Promise<string> {
  console.log('[transcribeAudio] Transcribing:', uri);

  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured. Add EXPO_PUBLIC_OPENAI_API_KEY to your .env file.');
  }

  const form = new FormData();
  form.append('model', 'whisper-1');

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

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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
