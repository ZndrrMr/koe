import "../global.css";
import React, { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { openDb } from "@/db";
import { useSettings } from "@/stores/useSettings";
import { log } from "@/utils/log";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const firstExchangeReviewApplied = useRef(false);
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const reviewStatusBarStyle =
    __DEV__ && process.env.EXPO_PUBLIC_KOE_REVIEW_SCHEME === "dark"
      ? "light"
      : "auto";

  useEffect(() => {
    (async () => {
      try {
        await openDb();
      } catch (e) {
        log.error("DB open failed", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const first = segments[0];
    const firstRoute = String(first ?? "");
    const secondRoute = String(Array.from(segments)[1] ?? "");
    const reviewRoute = __DEV__
      ? process.env.EXPO_PUBLIC_KOE_REVIEW_ROUTE
      : undefined;
    if (
      reviewRoute === "first-exchange" &&
      !firstExchangeReviewApplied.current
    ) {
      firstExchangeReviewApplied.current = true;
      if (first === "session") return;
      router.replace({
        pathname: "/session/[id]",
        params: {
          id:
            process.env.EXPO_PUBLIC_KOE_REVIEW_SESSION_ID ??
            "zan-852-first-exchange",
          intro: "1",
        },
      });
      return;
    }
    if (reviewRoute === "visual-study" && first !== "visual-study") {
      router.replace("/visual-study");
      return;
    }
    if (
      reviewRoute === "marketing-capture" &&
      firstRoute !== "marketing-capture"
    ) {
      router.replace("/marketing-capture" as never);
      return;
    }
    if (reviewRoute === "landing" && firstRoute !== "landing") {
      router.replace("/landing" as never);
      return;
    }
    if (reviewRoute === "session" && first !== "session") {
      router.replace({
        pathname: "/session/[id]",
        params: {
          id:
            process.env.EXPO_PUBLIC_KOE_REVIEW_SESSION_ID ??
            "zan-849-simulator-review",
        },
      });
      return;
    }
    if (
      reviewRoute === "session-history-proof" &&
      firstRoute !== "session-history-proof"
    ) {
      router.replace("/session-history-proof" as never);
      return;
    }
    if (
      reviewRoute === "song-pronunciation-proof" &&
      firstRoute !== "song-pronunciation-proof"
    ) {
      router.replace("/song-pronunciation-proof" as never);
      return;
    }
    if (
      reviewRoute === "handwriting-practice" &&
      firstRoute !== "handwriting-practice"
    ) {
      router.replace("/handwriting-practice" as never);
      return;
    }
    if (
      reviewRoute === "library" &&
      (first !== "(tabs)" || secondRoute !== "library")
    ) {
      router.replace("/(tabs)/library");
      return;
    }
    const isPublicOrDevelopmentSurface =
      first === "landing" ||
      (__DEV__ && (first === "visual-study" || first === "marketing-capture"));
    if (
      !onboardingDone &&
      first !== "onboarding" &&
      !isPublicOrDevelopmentSurface
    ) {
      router.replace("/onboarding/welcome");
    }
  }, [ready, onboardingDone, segments]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style={reviewStatusBarStyle} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen
              name="preferences"
              options={{ presentation: "modal" }}
            />
            <Stack.Screen
              name="session/[id]"
              options={{ presentation: "fullScreenModal" }}
            />
            <Stack.Screen name="about" options={{ presentation: "modal" }} />
            <Stack.Screen name="visual-study" />
            <Stack.Screen name="marketing-capture" />
            <Stack.Screen name="landing" />
            <Stack.Screen name="session-history-proof" />
            <Stack.Screen name="song-pronunciation-proof" />
            <Stack.Screen name="handwriting-practice" />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
