import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

export default function PractitionerPortalLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '600' as const },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="apply"
        options={{
          title: 'Apply for Access',
          presentation: 'modal',
        }}
      />
    </Stack>
  );
}
