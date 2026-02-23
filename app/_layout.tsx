import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { HIPAAProvider, useHIPAA } from '@/providers/HIPAAProvider';
import { UserProvider } from '@/providers/UserProvider';
import { ProtocolProvider } from '@/providers/ProtocolProvider';
import { LabsProvider } from '@/providers/LabsProvider';
import { HormoneProvider } from '@/providers/HormoneProvider';
import { NutritionProvider } from '@/providers/NutritionProvider';
import { SupplementsProvider } from '@/providers/SupplementsProvider';
import { trpc, trpcClient } from '@/lib/trpc';
import { HIPAAConsentBanner, BreachAlertBanner } from '@/components/HIPAABanner';
import AuthScreen from '@/app/auth';
import Colors from '@/constants/colors';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: 'Back',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  if (authLoading) return null;

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <>{children}</>;
}

function ConsentGate({ children }: { children: React.ReactNode }) {
  const { consentAccepted, consentLoading, acceptConsent, unacknowledgedBreaches } = useHIPAA();

  if (consentLoading) return null;

  return (
    <>
      {!consentAccepted && <HIPAAConsentBanner onAccept={acceptConsent} />}
      {consentAccepted && (
        <>
          <BreachAlertBanner count={unacknowledgedBreaches.length} onPress={() => {}} />
          {children}
        </>
      )}
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AuthProvider>
            <AuthGate>
              <HIPAAProvider>
                <ConsentGate>
                  <UserProvider>
                    <ProtocolProvider>
                      <LabsProvider>
                        <HormoneProvider>
                          <NutritionProvider>
                            <SupplementsProvider>
                              <StatusBar style="light" />
                              <RootLayoutNav />
                            </SupplementsProvider>
                          </NutritionProvider>
                        </HormoneProvider>
                      </LabsProvider>
                    </ProtocolProvider>
                  </UserProvider>
                </ConsentGate>
              </HIPAAProvider>
            </AuthGate>
          </AuthProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
