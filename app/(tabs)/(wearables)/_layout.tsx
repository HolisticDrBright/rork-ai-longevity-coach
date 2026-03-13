import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

export default function WearablesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '600' as const },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen
        name="dashboard"
        options={{
          title: 'Wearables Intelligence',
          headerLargeTitle: true,
        }}
      />
      <Stack.Screen
        name="trends"
        options={{
          title: 'Trends',
        }}
      />
      <Stack.Screen
        name="plan"
        options={{
          title: "Today's Plan",
        }}
      />
      <Stack.Screen
        name="insights-detail"
        options={{
          title: 'Health Insights',
        }}
      />
      <Stack.Screen
        name="connections"
        options={{
          title: 'Device Connections',
        }}
      />
    </Stack>
  );
}
