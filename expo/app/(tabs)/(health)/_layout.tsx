import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'insights',
};

export default function HealthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="insights" />
      <Stack.Screen name="analysis" />
      <Stack.Screen name="labs" />
      <Stack.Screen name="(wearables)" />
    </Stack>
  );
}
