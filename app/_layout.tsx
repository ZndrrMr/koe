import '../global.css';
import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openDb } from '@/db';
import { useSettings } from '@/stores/useSettings';
import { log } from '@/utils/log';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const onboardingDone = useSettings((s) => s.onboardingDone);

  useEffect(() => {
    (async () => {
      try {
        await openDb();
      } catch (e) {
        log.error('DB open failed', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const first = segments[0];
    if (!onboardingDone && first !== 'onboarding') {
      router.replace('/onboarding/welcome');
    } else if (onboardingDone && first === 'onboarding') {
      router.replace('/(tabs)/learn');
    }
  }, [ready, onboardingDone, segments]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="session/[id]" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="about" options={{ presentation: 'modal' }} />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
