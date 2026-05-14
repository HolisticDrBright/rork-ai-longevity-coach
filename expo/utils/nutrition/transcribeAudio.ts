import { Platform } from 'react-native';

const OPENAI_API_KEY =
  process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

export async function transcribeAudio(
  uri: string
): Promise<string> {
  try {
    console.log('[transcribeAudio] Transcribing:', uri);

    if (!OPENAI_API_KEY) {
      throw new Error(
        'EXPO_PUBLIC_OPENAI_API_KEY is missing'
      );
    }

    const formData = new FormData();

    // OpenAI transcription model
    formData.append(
      'model',
      'gpt-4o-mini-transcribe'
    );

    const fileName =
      uri.split('/').pop() || 'recording.m4a';

    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();

      formData.append(
        'file',
        blob,
        fileName
      );
    } else {
      formData.append('file', {
        uri,
        name: fileName,
        type: 'audio/mp4',
      } as any);
    }

    console.log(
      '[transcribeAudio] Uploading to OpenAI...'
    );

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          Accept: 'application/json',
        },
        body: formData,
      }
    );

    const responseText =
      await response.text();

    console.log(
      '[transcribeAudio] Status:',
      response.status
    );

    console.log(
      '[transcribeAudio] Response:',
      responseText
    );

    if (!response.ok) {
      throw new Error(
        `OpenAI transcription failed: ${response.status} ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    const text: string =
      data.text ?? '';

    console.log(
      '[transcribeAudio] Transcript:',
      text
    );

    return text;
  } catch (error) {
    console.error(
      '[transcribeAudio] ERROR:',
      error
    );

    throw error;
  }
}