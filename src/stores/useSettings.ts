import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from '@/utils/mmkv';
import type { Register, JlptLevel } from '@/data/scenarios';

type Goal = 'travel' | 'anime' | 'work' | 'jlpt' | 'just-because';
type Level = 'beginner' | 'n5' | 'n4' | 'n3' | 'n2plus';
type FuriganaMode = 'always' | 'never' | 'known-hidden';

type SettingsState = {
  onboardingDone: boolean;
  kanaKnown: boolean;
  goal: Goal;
  selfLevel: Level;
  jlptTarget: JlptLevel;
  registerTarget: Register;
  furiganaMode: FuriganaMode;
  showPitch: boolean;
  showPitchNumbers: boolean;
  voice: 'ja-female-1' | 'ja-female-2' | 'ja-male-1';
  darkMode: 'system' | 'light' | 'dark';

  complete: (patch: Partial<SettingsState>) => void;
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
};

const DEFAULTS = {
  onboardingDone: false,
  kanaKnown: false,
  goal: 'just-because' as Goal,
  selfLevel: 'beginner' as Level,
  jlptTarget: 5 as JlptLevel,
  registerTarget: 'teineigo' as Register,
  furiganaMode: 'always' as FuriganaMode,
  showPitch: true,
  showPitchNumbers: true,
  voice: 'ja-female-1' as const,
  darkMode: 'system' as const,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      complete: (patch) => set((s) => ({ ...s, ...patch, onboardingDone: true })),
      set: (key, value) => set((s) => ({ ...s, [key]: value })),
      reset: () => set(DEFAULTS),
    }),
    {
      name: 'koe-settings',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);
