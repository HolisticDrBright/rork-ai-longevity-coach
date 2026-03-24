import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

export default function NutritionLayout() {
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
          title: 'Nutrition',
          headerLargeTitle: true,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Diet Settings',
        }}
      />
      <Stack.Screen
        name="new"
        options={{
          title: 'Log Meal',
        }}
      />
      <Stack.Screen
        name="confirm"
        options={{
          title: 'Confirm Foods',
        }}
      />
      <Stack.Screen
        name="[logId]"
        options={{
          title: 'Meal Details',
        }}
      />
    </Stack>
  );
}
