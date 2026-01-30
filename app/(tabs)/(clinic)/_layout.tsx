import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

export default function ClinicLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '600' as const },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Clinic Dashboard',
          headerLargeTitle: true,
        }}
      />
      <Stack.Screen
        name="patients"
        options={{
          title: 'Patients',
        }}
      />
      <Stack.Screen
        name="alerts"
        options={{
          title: 'Alerts',
        }}
      />
      <Stack.Screen
        name="patient/[id]"
        options={{
          title: 'Patient Details',
        }}
      />
      <Stack.Screen
        name="supplements-admin"
        options={{
          title: 'Supplements Admin',
        }}
      />
    </Stack>
  );
}
