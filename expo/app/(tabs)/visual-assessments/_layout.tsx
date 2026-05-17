import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

export default function VisualAssessmentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '600' as const },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Visual Assessments', headerLargeTitle: true }} />
      <Stack.Screen name="new-session" options={{ title: 'New Assessment' }} />
      <Stack.Screen name="capture/[modality]" options={{ title: 'Capture' }} />
      <Stack.Screen name="session/[sessionId]" options={{ title: 'Assessment Report' }} />
    </Stack>
  );
}
