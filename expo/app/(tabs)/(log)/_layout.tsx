import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'tracking',
};

export default function LogLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="tracking" />
      <Stack.Screen name="(nutrition)" />
    </Stack>
  );
}
