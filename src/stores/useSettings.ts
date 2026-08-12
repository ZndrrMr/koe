import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStorage } from "@/utils/mmkv";

export type Goal = "travel" | "media" | "work" | "just-because";
export type ResponseLevel =
  | "starting"
  | "basic"
  | "everyday"
  | "broad"
  | "full-speed";
export type CorrectionStyle = "essential" | "balanced" | "detailed";

type SettingsValues = {
  onboardingDone: boolean;
  goal: Goal;
  responseLevel: ResponseLevel;
  voice: "ja-female-1" | "ja-female-2" | "ja-male-1";
  correctionStyle: CorrectionStyle;
};

type SettingsState = SettingsValues & {
  complete: (patch: Partial<SettingsValues>) => void;
  set: <K extends keyof SettingsValues>(
    key: K,
    value: SettingsValues[K],
  ) => void;
  reset: () => void;
};

const DEFAULTS: SettingsValues = {
  onboardingDone: false,
  goal: "just-because",
  responseLevel: "starting",
  voice: "ja-female-1",
  correctionStyle: "essential",
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      complete: (patch) =>
        set((s) => ({ ...s, ...patch, onboardingDone: true })),
      set: (key, value) => set((s) => ({ ...s, [key]: value })),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "koe-voice-settings",
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);
