import "../global.css";
import React, { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { openDb } from "@/db";
import { useFirstUse } from "@/stores/useFirstUse";
import { useConversationPalette } from "@/theme/conversation";
import { log } from "@/utils/log";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const palette = useConversationPalette();
  const segments = useSegments();
  const firstSegment = segments[0];
  const reviewNavigationApplied = useRef(false);
  const firstExchangeReviewApplied = useRef(false);
  const onboardingDone = useFirstUse((s) => s.onboardingDone);
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
    const reviewRoute = __DEV__
      ? process.env.EXPO_PUBLIC_KOE_REVIEW_ROUTE
      : undefined;
    if (reviewRoute === "microphone-education") {
      if (firstSegment !== "onboarding" && !reviewNavigationApplied.current) {
        reviewNavigationApplied.current = true;
        router.replace("/onboarding/welcome");
      }
      return;
    }
    if (
      reviewRoute === "first-exchange" &&
      !firstExchangeReviewApplied.current
    ) {
      firstExchangeReviewApplied.current = true;
      if (firstSegment === "session") return;
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
    if (reviewRoute === "session") {
      if (firstSegment !== "session" && !reviewNavigationApplied.current) {
        reviewNavigationApplied.current = true;
        router.replace({
          pathname: "/session/[id]",
          params: {
            id:
              process.env.EXPO_PUBLIC_KOE_REVIEW_SESSION_ID ??
              "zan-849-simulator-review",
          },
        });
      }
      return;
    }
    if (reviewRoute === "art-family") return;
    if (!onboardingDone && firstSegment !== "onboarding") {
      router.replace("/onboarding/welcome");
    }
  }, [ready, onboardingDone, firstSegment, router]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style={reviewStatusBarStyle} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.canvas },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen
            name="session/[id]"
            options={{ presentation: "fullScreenModal" }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
