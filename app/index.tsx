import { Redirect } from 'expo-router';
import { useSettings } from '@/stores/useSettings';

export default function Index() {
  const done = useSettings((s) => s.onboardingDone);
  return done ? <Redirect href="/(tabs)/learn" /> : <Redirect href="/onboarding/welcome" />;
}
