import { Tabs, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Home, ClipboardList, CheckSquare, User, Stethoscope, Activity } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Colors from '@/constants/colors';
import { useUser } from '@/providers/UserProvider';
import { PRACTITIONER_INTENT_KEY } from '@/app/signin';

export default function TabLayout() {
  const { isClinician, userProfile, isLoading: userLoading } = useUser();
  const redirectedRef = useRef(false);

  // Gate the whole tab group: whichever tab the app enters on, users who have
  // not finished onboarding are sent to it (previously only the Today tab
  // performed this check). Guarded by the provider loading state and a ref so
  // it fires at most once and cannot loop.
  useEffect(() => {
    if (userLoading || redirectedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const practitionerIntent = await AsyncStorage.getItem(PRACTITIONER_INTENT_KEY);
        if (cancelled) return;
        if (practitionerIntent && !isClinician) {
          redirectedRef.current = true;
          await AsyncStorage.removeItem(PRACTITIONER_INTENT_KEY);
          router.replace('/practitioner' as any);
          return;
        }
      } catch (e) {
        console.log('[TabLayout] practitioner intent check failed', e);
      }
      if (cancelled) return;
      if (!isClinician && !userProfile.onboardingCompleted) {
        redirectedRef.current = true;
        router.replace('/onboarding' as any);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userLoading, isClinician, userProfile.onboardingCompleted]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.borderLight,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="(health)"
        options={{
          title: 'Health',
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="(log)"
        options={{
          title: 'Log',
          tabBarIcon: ({ color, size }) => <CheckSquare color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="protocol"
        options={{
          title: 'Protocol',
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="(clinic)"
        options={{
          title: 'Clinic',
          tabBarIcon: ({ color, size }) => <Stethoscope color={color} size={size} />,
          href: isClinician ? '/(tabs)/(clinic)' as any : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
