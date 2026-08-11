import { Redirect } from "expo-router";
import { useSettings } from "@/stores/useSettings";

export default function Index() {
  const done = useSettings((state) => state.onboardingDone);
  if (__DEV__ && process.env.EXPO_PUBLIC_KOE_PRONUNCIATION_PROOF === "1") {
    return <Redirect href="/pitch-drill/shadow?proof=1" />;
  }
  return done ? (
    <Redirect href="/(tabs)/speak" />
  ) : (
    <Redirect href="/onboarding/welcome" />
  );
}
